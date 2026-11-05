/**
 * DashboardView is a page widget that arranges "blocks" on a grid, a bit like a Notion page:
 *  - key figures (a number computed from a table, with an optional trend),
 *  - charts computed from a table's metadata ("sum of Amount by Region"),
 *  - existing chart widgets of the document, embedded as they are,
 *  - text, for headings and notes.
 *
 * Blocks are described in the section's options (see DashboardData.ts), and edited with
 * DashboardEditor. They can be reordered by dragging, and resized from their menu.
 */
import BaseView from "app/client/components/BaseView";
import {
  buildEChartsOption, EChartsHost, getChartColors, getPaletteColors,
} from "app/client/components/ChartRenderer";
import { ChartView } from "app/client/components/ChartView";
import {
  autoTitle, computeGroups, computeKpi, DashboardBlock, DashboardSpec, defaultGroupBy, fetchBlockTables, generateBlocks,
  getChartSections, getValueFormatter, GRID_COLUMNS, groupsToTraces, newBlockId,
} from "app/client/components/DashboardData";
import { openBlockEditor } from "app/client/components/DashboardEditor";
import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { ViewSectionRec } from "app/client/models/DocModel";
import { reportError } from "app/client/models/errors";
import { cssGroupLabel, cssRow } from "app/client/ui/RightPanelStyles";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { menu, menuDivider, menuItem, menuText } from "app/client/ui2018/menus";
import { gristThemeObs } from "app/client/ui2018/theme";
import { unstyledButton } from "app/client/ui2018/unstyled";

import {
  Computed, Disposable, dom, DomContents, Emitter, fromKo, makeTestId, MultiHolder, Observable, styled,
} from "grainjs";
import debounce from "lodash/debounce";

const t = makeT("DashboardView");
const testId = makeTestId("test-dashboard-");

const DEFAULT_CHART_HEIGHT = 300;

export class DashboardView extends BaseView {
  // The blocks, as saved in the section's options.
  public readonly blocks: Computed<DashboardBlock[]>;
  // Bumped whenever the data of a table used by the dashboard changes.
  public readonly dataVersion = Observable.create(this, 0);
  // Number of columns the grid currently has room for.
  public readonly columns = Observable.create(this, GRID_COLUMNS);
  public readonly canEdit: Computed<boolean>;
  // Id of the block being dragged.
  public readonly dragging = Observable.create<string | null>(this, null);
  // Emits when blocks should resize their charts.
  public readonly resizeEmitter = this.autoDispose(new Emitter());

  private _watchedTables = new Set<string>();
  private _bumpData = debounce(() => {
    if (!this.isDisposed()) { this.dataVersion.set(this.dataVersion.get() + 1); }
  }, 150);

  private _bumpResize = debounce(() => {
    if (this.isDisposed()) { return; }
    this.resizeEmitter.emit();
  }, 50);

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel);
    const optionsDashboard = fromKo(this.viewSection.optionsObj.prop("dashboard"));
    this.blocks = Computed.create(this, use => (use(optionsDashboard)?.blocks || []) as DashboardBlock[]);
    this.canEdit = Computed.create(this, use => !use(gristDoc.isReadonly));

    this.viewPane = this._buildDom();
    this.onDispose(() => {
      this._bumpData.cancel();
      dom.domDispose(this.viewPane);
      this.viewPane.remove();
    });

    // Make sure the data of every table we use is loaded, and watched for changes.
    this.autoDispose(this.blocks.addListener(blocks => this._watchTables(blocks)));
    this._watchTables(this.blocks.get());
    this.autoDispose(gristThemeObs().addListener(() => this._bumpData()));

    const resizeObserver = new ResizeObserver(() => this.onResize());
    resizeObserver.observe(this.viewPane);
    this.onDispose(() => resizeObserver.disconnect());
  }

  public onResize() {
    const width = this.viewPane.clientWidth;
    this.columns.set(width < 480 ? 1 : (width < 820 ? 2 : GRID_COLUMNS));
    this._bumpResize();
  }

  public async saveBlocks(blocks: DashboardBlock[]) {
    const spec: DashboardSpec = { blocks };
    await this.viewSection.optionsObj.prop("dashboard").setAndSave(spec);
  }

  public async updateBlock(id: string, changes: Partial<DashboardBlock> | null) {
    const blocks = this.blocks.get().slice();
    const index = blocks.findIndex(b => b.id === id);
    if (index < 0) { return; }
    if (changes === null) {
      blocks.splice(index, 1);
    } else {
      blocks[index] = { ...blocks[index], ...changes };
    }
    await this.saveBlocks(blocks);
  }

  public async duplicateBlock(id: string) {
    const blocks = this.blocks.get().slice();
    const index = blocks.findIndex(b => b.id === id);
    if (index < 0) { return; }
    blocks.splice(index + 1, 0, { ...blocks[index], id: newBlockId() });
    await this.saveBlocks(blocks);
  }

  public async moveBlock(id: string, beforeId: string | null) {
    if (id === beforeId) { return; }
    const blocks = this.blocks.get().slice();
    const index = blocks.findIndex(b => b.id === id);
    if (index < 0) { return; }
    const [block] = blocks.splice(index, 1);
    const target = beforeId ? blocks.findIndex(b => b.id === beforeId) : -1;
    blocks.splice(target < 0 ? blocks.length : target, 0, block);
    await this.saveBlocks(blocks);
  }

  public addBlock(initial?: Partial<DashboardBlock>) {
    const tableId = this.viewSection.table.peek().tableId.peek();
    openBlockEditor(this.gristDoc, {
      id: newBlockId(), kind: "chart", tableId, agg: "count", chartType: "bar", width: 2,
      groupBy: defaultGroupBy(this.gristDoc.docModel, tableId), limit: 10, ...initial,
    }, async (block) => {
      await this._ensureLoaded([block]);
      await this.saveBlocks([...this.blocks.get(), block]);
    }, { isNew: true });
  }

  public editBlock(block: DashboardBlock) {
    openBlockEditor(this.gristDoc, block, async (updated) => {
      await this._ensureLoaded([updated]);
      await this.updateBlock(block.id, updated);
    });
  }

  public async generate() {
    const tableId = this.viewSection.table.peek().tableId.peek();
    await this._ensureLoaded([{ id: "", kind: "kpi", tableId }]);
    const blocks = generateBlocks(this.gristDoc.docModel, tableId);
    // Add the charts that already exist in the document.
    const charts = getChartSections(this.gristDoc.docModel);
    for (const chart of charts.slice(0, 2)) {
      blocks.push({ id: newBlockId(), kind: "embed", sectionRef: chart.getRowId(), width: 2 });
    }
    await this.saveBlocks([...this.blocks.get(), ...blocks]);
  }

  // Handlers that let a dragged block be dropped before the given block (or at the end).
  public dropTarget(beforeId: string | null) {
    return [
      dom.on("dragover", (ev) => {
        if (!this.dragging.get()) { return; }
        ev.preventDefault();
        (ev.currentTarget as HTMLElement).classList.add(cssDropHint.className);
      }),
      dom.on("dragleave", (ev) => {
        (ev.currentTarget as HTMLElement).classList.remove(cssDropHint.className);
      }),
      dom.on("drop", (ev) => {
        (ev.currentTarget as HTMLElement).classList.remove(cssDropHint.className);
        const id = this.dragging.get();
        if (!id) { return; }
        ev.preventDefault();
        this.dragging.set(null);
        this.moveBlock(id, beforeId).catch(reportError);
      }),
    ];
  }

  private async _ensureLoaded(blocks: DashboardBlock[]) {
    await fetchBlockTables(this.gristDoc.docModel, blocks);
    this._watchTables(blocks);
  }

  private _watchTables(blocks: DashboardBlock[]) {
    const docModel = this.gristDoc.docModel;
    for (const block of blocks) {
      const tableId = block.tableId;
      if (!tableId || this._watchedTables.has(tableId)) { continue; }
      const tableData = docModel.docData.getTable(tableId);
      if (!tableData) { continue; }
      this._watchedTables.add(tableId);
      this.autoDispose(tableData.tableActionEmitter.addListener(() => this._bumpData()));
      this.autoDispose(tableData.dataLoadedEmitter.addListener(() => this._bumpData()));
    }
    fetchBlockTables(docModel, blocks).then(() => this._bumpData()).catch(reportError);
  }

  private _buildDom() {
    return cssDashboard(
      dom.domComputed(this.blocks, blocks => blocks.length ? null : this._buildEmptyState()),
      cssGrid(
        dom.style("grid-template-columns", use => `repeat(${use(this.columns)}, minmax(0, 1fr))`),
        dom.forEach(this.blocks, (block) => {
          const component = BlockComponent.create(null, this, block);
          return dom.update(component.buildDom(), dom.autoDispose(component));
        }),
        dom.maybe(use => use(this.canEdit) && use(this.blocks).length > 0, () =>
          cssAddBlock(
            icon("Plus"), t("Add a block"),
            dom.on("click", () => this.addBlock()),
            this.dropTarget(null),
            testId("add-block"),
          ),
        ),
      ),
      testId("container"),
    );
  }

  private _buildEmptyState() {
    const tableName = this.viewSection.table.peek().tableNameDef.peek();
    return cssEmpty(
      cssEmptyArt(
        cssEmptyArtTile(cssEmptyArtTile.cls("-kpi")), cssEmptyArtTile(cssEmptyArtTile.cls("-kpi")),
        cssEmptyArtTile(cssEmptyArtTile.cls("-wide")),
      ),
      cssEmptyTitle(t("Build your dashboard")),
      cssEmptyText(
        t("Key figures and charts in one place. Generate a dashboard from the table {{table}}, or add blocks.",
          { table: tableName }),
      ),
      dom.maybe(this.canEdit, () => cssEmptyButtons(
        cssPrimaryBtn(icon("Sparks"), t("Generate a dashboard"),
          dom.on("click", () => this.generate().catch(reportError)), testId("generate")),
        cssSecondaryBtn(icon("Plus"), t("Add a block"),
          dom.on("click", () => this.addBlock()), testId("empty-add")),
      )),
      testId("empty"),
    );
  }
}

/**
 * One block of the dashboard: the card, its toolbar, and its content.
 */
class BlockComponent extends Disposable {
  constructor(private _view: DashboardView, private _block: DashboardBlock) {
    super();
  }

  public buildDom() {
    const view = this._view;
    const block = this._block;
    const width = Computed.create(this, view.columns, (_use, cols) => Math.min(block.width || 1, cols));
    const docModel = view.gristDoc.docModel;
    const title = block.title || autoTitle(docModel, block);
    return cssBlock(
      cssBlock.cls(`-${block.kind}`),
      dom.style("grid-column", use => `span ${use(width)}`),
      cssBlock.cls("-dragging", use => use(view.dragging) === block.id),
      block.kind === "text" ? null : cssBlockHeader(
        cssBlockTitle(title, { title }),
      ),
      dom.maybe(view.canEdit, () => cssBlockTools(
        cssToolBtn(icon("DragDrop"), { title: t("Drag to move") },
          dom.attr("draggable", "true"),
          dom.on("dragstart", (ev) => {
            view.dragging.set(block.id);
            ev.dataTransfer?.setData("text/plain", block.id);
            const card = (ev.target as HTMLElement).closest(`.${cssBlock.className}`);
            if (card && ev.dataTransfer) { ev.dataTransfer.setDragImage(card, 20, 20); }
          }),
          dom.on("dragend", () => view.dragging.set(null)),
          testId("block-drag"),
        ),
        cssToolBtn(icon("Pencil"), { title: t("Edit") },
          dom.on("click", () => view.editBlock(block)), testId("block-edit")),
        cssToolBtn(icon("Dots"), { title: t("More") },
          menu(() => [
            menuText(t("Width")),
            ...[1, 2, 3, 4].map(w => menuItem(() => view.updateBlock(block.id, { width: w }),
              cssMenuCheck(icon("Tick"), dom.style("visibility", (block.width || 1) === w ? "visible" : "hidden")),
              widthLabel(w), testId(`block-width-${w}`))),
            ...(block.kind === "chart" || block.kind === "embed" ? [
              menuDivider(),
              menuText(t("Height")),
              ...[[220, t("Small")], [300, t("Medium")], [420, t("Large")]].map(([h, label]) =>
                menuItem(() => view.updateBlock(block.id, { height: h as number }),
                  cssMenuCheck(icon("Tick"), dom.style("visibility",
                    (block.height || DEFAULT_CHART_HEIGHT) === h ? "visible" : "hidden")),
                  label as string)),
            ] : []),
            menuDivider(),
            menuItem(() => view.duplicateBlock(block.id), t("Duplicate"), testId("block-duplicate")),
            menuItem(() => view.updateBlock(block.id, null), t("Delete"), testId("block-delete")),
          ]),
          testId("block-menu"),
        ),
      )),
      this._buildContent(),
      view.dropTarget(block.id),
      dom.on("dblclick", (ev) => {
        if (view.canEdit.get() && block.kind !== "text") { view.editBlock(block); }
      }),
      testId("block"),
      testId(`block-${block.kind}`),
    );
  }

  private _buildContent(): DomContents | null {
    switch (this._block.kind) {
      case "kpi": return this._buildKpi();
      case "chart": return this._buildChart();
      case "embed": return this._buildEmbed();
      case "text": return this._buildText();
    }
  }

  private _buildKpi() {
    const view = this._view;
    const block = this._block;
    const docModel = view.gristDoc.docModel;
    return dom.domComputed(view.dataVersion, () => {
      const result = computeKpi(docModel, block);
      const colors = getChartColors(block.palette);
      const accent = getPaletteColors(block.palette, colors.dark)[0];
      const fmt = getValueFormatter(docModel, block);
      return cssKpi(
        cssKpiValue(result.text, testId("kpi-value")),
        result.delta !== undefined && result.delta !== null ? cssKpiDelta(
          cssKpiDelta.cls(result.delta >= 0 ? "-up" : "-down"),
          `${result.delta >= 0 ? "▲" : "▼"} ${Math.abs(result.delta * 100).toFixed(1)} %`,
          cssKpiDeltaHint(t("vs previous period")),
        ) : null,
        result.trend ? buildSparkline(result.trend.values, accent, result.trend.labels, fmt) : null,
      );
    });
  }

  private _buildChart() {
    const view = this._view;
    const block = this._block;
    const docModel = view.gristDoc.docModel;
    const holder = cssChartHolder(dom.style("height", `${block.height || DEFAULT_CHART_HEIGHT}px`));
    const host = new EChartsHost(holder);
    this.onDispose(() => host.dispose());
    const empty = Observable.create(this, false);
    const render = () => {
      const groups = computeGroups(docModel, block);
      empty.set(!groups || groups.labels.length === 0);
      if (!groups) { host.clear(); return; }
      const fmt = getValueFormatter(docModel, block);
      const name = block.title || autoTitle(docModel, block);
      const traces = groupsToTraces(block, groups, name);
      const chartType = block.chartType === "hbar" ? "bar" : (block.chartType || "bar");
      const option = buildEChartsOption(traces, {
        chartType,
        options: { palette: block.palette, showValues: block.showValues ?? (groups.labels.length <= 12),
          legendPosition: undefined },
        formatValue: (v: any) => fmt(v),
        compact: true,
      }, getChartColors(block.palette));
      host.render(option, String(block.chartType)).then(() => host.resize()).catch(reportError);
    };
    this.autoDispose(view.dataVersion.addListener(render));
    this.autoDispose(view.resizeEmitter.addListener(() => host.resize()));
    setTimeout(() => { if (!this.isDisposed()) { render(); } }, 0);
    return [
      holder,
      dom.maybe(empty, () => cssBlockMessage(t("No data to show. Check the columns of this block."))),
    ];
  }

  private _buildEmbed() {
    const view = this._view;
    const block = this._block;
    const docModel = view.gristDoc.docModel;
    const section = docModel.viewSections.getRowModel(block.sectionRef || 0);
    if (!section?.getRowId() || section.parentKey.peek() !== "chart") {
      return cssBlockMessage(t("This chart no longer exists."));
    }
    const holder = cssChartHolder(dom.style("height", `${block.height || DEFAULT_CHART_HEIGHT}px`));
    // Show the very same chart widget, with its own settings, sorting and filters.
    const owner = MultiHolder.create(this);
    (async () => {
      await docModel.getTableModel(section.table.peek().tableId.peek())?.fetch();
      if (owner.isDisposed()) { return; }
      const chart = ChartView.create(owner, view.gristDoc, section);
      holder.appendChild(chart.viewPane);
      owner.autoDispose(view.resizeEmitter.addListener(() => chart.onResize()));
      setTimeout(() => chart.onResize(), 50);
    })().catch(reportError);
    return holder;
  }

  private _buildText() {
    const view = this._view;
    const block = this._block;
    const editing = Observable.create(this, !block.text && view.canEdit.get());
    return dom.domComputed(editing, isEditing => isEditing ?
      cssTextEditor(
        { placeholder: t("Type a title, or some notes... (# Title, ## Subtitle, - list)") },
        dom.prop("value", block.text || ""),
        (elem: HTMLTextAreaElement) => {
          const grow = () => { elem.style.height = "auto"; elem.style.height = `${elem.scrollHeight + 2}px`; };
          setTimeout(() => { grow(); elem.focus(); }, 0);
          return dom.on("input", grow);
        },
        dom.on("blur", (_ev, elem) => {
          editing.set(false);
          if (elem.value !== (block.text || "")) {
            view.updateBlock(block.id, { text: elem.value }).catch(reportError);
          }
        }),
        dom.onKeyDown({ Escape: (_ev, elem) => elem.blur() }),
        testId("text-editor"),
      ) :
      cssText(
        block.text ? renderSimpleMarkdown(block.text) : cssTextPlaceholder(t("Empty text block")),
        dom.on("click", () => { if (view.canEdit.get()) { editing.set(true); } }),
        testId("text"),
      ),
    );
  }
}

/**
 * The dashboard's part of the right panel: a few words on how it works, and the main actions.
 */
export function buildDashboardConfig(section: ViewSectionRec) {
  const getView = () => {
    const view = section.viewInstance.peek();
    return view instanceof DashboardView ? view : null;
  };
  const count = Computed.create(null, fromKo(section.optionsObj.prop("dashboard")),
    (_use, spec) => spec?.blocks?.length || 0);
  return [
    dom.autoDispose(count),
    cssGroupLabel(t("Dashboard")),
    cssConfigHint(t("A dashboard gathers key figures, charts and notes. Hover a block to move, edit or resize it."),
    ),
    cssConfigHint(dom.text(use => t("{{count}} blocks", { count: use(count) }))),
    cssRow(
      cssConfigBtn(icon("Plus"), t("Add a block"), dom.on("click", () => getView()?.addBlock()),
        testId("config-add")),
    ),
    cssRow(
      cssConfigBtn(icon("Sparks"), t("Generate from the data"),
        dom.on("click", () => getView()?.generate().catch(reportError)), testId("config-generate")),
    ),
  ];
}

function widthLabel(w: number) {
  switch (w) {
    case 1: return t("Small (1/4)");
    case 2: return t("Medium (1/2)");
    case 3: return t("Large (3/4)");
    default: return t("Full width");
  }
}

/**
 * Renders a small subset of Markdown, without HTML: "# " and "## " headings, "- " lists, and
 * **bold** text.
 */
function renderSimpleMarkdown(text: string): DomContents {
  const inline = (line: string) => line.split(/(\*\*[^*]+\*\*)/).map(part =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? dom("strong", part.slice(2, -2)) : part);
  const out: HTMLElement[] = [];
  let list: HTMLElement | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (/^[-*] /.test(line)) {
      if (!list) { out.push(list = cssTextList()); }
      list.appendChild(dom("li", inline(line.slice(2))));
      continue;
    }
    list = null;
    if (line.startsWith("## ")) {
      out.push(cssTextH3(inline(line.slice(3))));
    } else if (line.startsWith("# ")) {
      out.push(cssTextH2(inline(line.slice(2))));
    } else if (line) {
      out.push(cssTextP(inline(line)));
    }
  }
  return out;
}

/** A tiny trend line under key figures. */
function buildSparkline(values: (number | null)[], color: string, labels: string[], fmt: (v: any) => string) {
  const w = 200; const h = 40; const pad = 3;
  const nums = values.map(v => (typeof v === "number" ? v : 0));
  const min = Math.min(...nums, 0);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const points = nums.map((v, i) => [
    pad + (i * (w - 2 * pad)) / Math.max(1, nums.length - 1),
    h - pad - ((v - min) * (h - 2 * pad)) / span,
  ]);
  const line = points.map(p => p.join(",")).join(" ");
  const area = `M${points[0][0]},${h} L` + points.map(p => p.join(",")).join(" L") + ` L${points[points.length - 1][0]},${h} Z`;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  const gradId = `spark-${Math.random().toString(36).slice(2, 8)}`;
  svg.innerHTML = `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>` +
    `</linearGradient></defs>` +
    `<path d="${area}" fill="url(#${gradId})"/>` +
    `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" ` +
    `stroke-linejoin="round" stroke-linecap="round"/>`;
  const last = labels.length - 1;
  return cssSparkline(svg, { title: `${labels[last]} : ${fmt(values[last])}` }, testId("sparkline"));
}

const cssDashboard = styled("div", `
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 4px 2px 16px 2px;
  background-color: ${theme.mainPanelBg};
`);

const cssGrid = styled("div", `
  display: grid;
  gap: 16px;
  grid-auto-flow: row dense;
  align-items: stretch;
`);

const cssBlock = styled("div", `
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid ${theme.pagePanelsBorder};
  background-color: ${theme.mainPanelBg};
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.2s, border-color 0.2s, opacity 0.2s;
  &:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  }
  &-text {
    border-color: transparent;
    box-shadow: none;
    background-color: transparent;
    padding: 4px 8px;
  }
  &-text:hover {
    border-color: ${theme.pagePanelsBorder};
    box-shadow: none;
  }
  &-dragging {
    opacity: 0.4;
  }
`);

const cssDropHint = styled("div", `
  outline: 2px dashed ${theme.controlFg};
  outline-offset: 2px;
`);

const cssBlockHeader = styled("div", `
  display: flex;
  align-items: center;
  min-height: 20px;
  padding-right: 72px;
  margin-bottom: 6px;
`);

const cssBlockTitle = styled("div", `
  font-size: ${vars.mediumFontSize};
  font-weight: 600;
  color: ${theme.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  .${cssBlock.className}-kpi & {
    font-size: ${vars.smallFontSize};
    font-weight: 500;
    color: ${theme.lightText};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
`);

const cssBlockTools = styled("div", `
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 2;
  .${cssBlock.className}:hover &, &:focus-within {
    opacity: 1;
  }
`);

const cssToolBtn = styled(unstyledButton, `
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
  background-color: ${theme.mainPanelBg};
  --icon-color: ${theme.lightText};
  &:hover {
    background-color: ${theme.hover};
    --icon-color: ${theme.text};
  }
  &[draggable=true] {
    cursor: grab;
  }
`);

const cssMenuCheck = styled("div", `
  display: flex;
  margin-right: 8px;
`);

const cssKpi = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
`);

const cssKpiValue = styled("div", `
  font-size: 30px;
  line-height: 36px;
  font-weight: 700;
  color: ${theme.text};
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

const cssKpiDelta = styled("div", `
  font-size: ${vars.smallFontSize};
  font-weight: 600;
  &-up { color: #1a9d5a; }
  &-down { color: #d64545; }
`);

const cssKpiDeltaHint = styled("span", `
  font-weight: 400;
  color: ${theme.lightText};
  margin-left: 6px;
`);

const cssSparkline = styled("div", `
  margin-top: auto;
  height: 40px;
  & > svg { width: 100%; height: 40px; display: block; overflow: visible; }
`);

const cssChartHolder = styled("div", `
  position: relative;
  width: 100%;
  .${cssBlock.className}-embed & .chart_container {
    position: absolute;
  }
`);

const cssBlockMessage = styled("div", `
  padding: 24px 8px;
  text-align: center;
  color: ${theme.lightText};
`);

const cssText = styled("div", `
  min-height: 24px;
  color: ${theme.text};
  cursor: text;
  line-height: 1.5;
`);

const cssTextPlaceholder = styled("div", `
  color: ${theme.lightText};
  font-style: italic;
`);

const cssTextH2 = styled("div", `
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  margin: 4px 0 2px 0;
`);

const cssTextH3 = styled("div", `
  font-size: 16px;
  font-weight: 600;
  margin: 4px 0 2px 0;
`);

const cssTextP = styled("div", `
  color: ${theme.lightText};
  font-size: ${vars.mediumFontSize};
`);

const cssTextList = styled("ul", `
  margin: 2px 0;
  padding-left: 20px;
  color: ${theme.lightText};
`);

const cssTextEditor = styled("textarea", `
  width: 100%;
  min-height: 60px;
  resize: none;
  border: 1px solid ${theme.controlFg};
  border-radius: 8px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: ${vars.mediumFontSize};
  line-height: 1.5;
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  outline: none;
`);

const cssAddBlock = styled(unstyledButton, `
  grid-column: span 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 96px;
  border: 1.5px dashed ${theme.pagePanelsBorder};
  border-radius: 12px;
  color: ${theme.lightText};
  --icon-color: ${theme.lightText};
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  &:hover {
    border-color: ${theme.controlFg};
    color: ${theme.controlFg};
    --icon-color: ${theme.controlFg};
  }
`);

const cssEmpty = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  max-width: 460px;
  margin: 48px auto 24px auto;
  padding: 0 16px;
`);

const cssEmptyArt = styled("div", `
  display: grid;
  grid-template-columns: 56px 56px;
  grid-template-rows: 32px 40px;
  gap: 6px;
  margin-bottom: 8px;
`);

const cssEmptyArtTile = styled("div", `
  border-radius: 6px;
  border: 1.5px solid ${theme.controlFg};
  background-color: ${theme.lightHover};
  &-wide {
    grid-column: span 2;
    background: linear-gradient(180deg, transparent 40%, ${theme.controlFg} 40%, ${theme.controlFg} 48%,
      transparent 48%);
    opacity: 0.7;
  }
`);

const cssEmptyTitle = styled("div", `
  font-size: 20px;
  font-weight: 700;
  color: ${theme.text};
`);

const cssEmptyText = styled("div", `
  color: ${theme.lightText};
  line-height: 1.55;
`);

const cssEmptyButtons = styled("div", `
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
`);

const cssPrimaryBtn = styled(unstyledButton, `
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  color: ${theme.controlPrimaryFg};
  background-color: ${theme.controlPrimaryBg};
  --icon-color: ${theme.controlPrimaryFg};
  &:hover { background-color: ${theme.controlPrimaryHoverBg}; }
`);

const cssSecondaryBtn = styled(cssPrimaryBtn, `
  color: ${theme.controlFg};
  background-color: transparent;
  border: 1px solid ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  &:hover { background-color: ${theme.lightHover}; }
`);

const cssConfigHint = styled("div", `
  margin: 0 16px 12px 16px;
  color: ${theme.lightText};
  line-height: 1.5;
`);

const cssConfigBtn = styled(unstyledButton, `
  display: flex;
  align-items: center;
  gap: 6px;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  cursor: pointer;
  &:hover {
    color: ${theme.controlHoverFg};
    --icon-color: ${theme.controlHoverFg};
  }
`);
