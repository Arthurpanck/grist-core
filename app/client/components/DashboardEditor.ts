/**
 * The dialog to add or edit a block of a dashboard. It's built for people who don't know (or care)
 * about summary tables: pick a table, what to count or add up, and how to split it, and see the
 * result right away in the preview.
 */
import { buildEChartsOption, CHART_PALETTES, DEFAULT_PALETTE, EChartsHost, getChartColors,
  getPaletteColors } from "app/client/components/ChartRenderer";
import { buildThumbnail } from "app/client/components/ChartView";
import {
  aggLabel, autoTitle, BlockChartType, BlockKind, bucketLabel, computeGroups, computeKpi, DashboardBlock,
  DateBucket,
  defaultGroupBy, fetchBlockTables, getChartSections, getDashboardTables, getTable, getUserColumns, getValueFormatter,
  groupsToTraces,
  isDateType, isNumericType, shownType,
} from "app/client/components/DashboardData";
import { GristDoc } from "app/client/components/GristDoc";
import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { squareCheckbox } from "app/client/ui2018/checkbox";
import { theme, vars } from "app/client/ui2018/cssVars";
import { IconName } from "app/client/ui2018/IconList";
import { icon } from "app/client/ui2018/icons";
import { IOptionFull, select } from "app/client/ui2018/menus";
import { saveModal } from "app/client/ui2018/modals";

import { Computed, dom, IDisposableOwner, makeTestId, Observable, styled } from "grainjs";
import debounce from "lodash/debounce";

const t = makeT("DashboardEditor");
const testId = makeTestId("test-dashboard-editor-");

interface KindInfo { kind: BlockKind; icon: IconName; label: () => string; help: () => string; }

const KINDS: KindInfo[] = [
  { kind: "kpi", icon: "FieldNumeric", label: () => t("Key figure"),
    help: () => t("A number: total, count, average...") },
  { kind: "chart", icon: "TypeChart", label: () => t("Chart"), help: () => t("Values split by a column") },
  { kind: "embed", icon: "Widget", label: () => t("Existing chart"), help: () => t("A chart widget of this document") },
  { kind: "text", icon: "Paragraph", label: () => t("Text"), help: () => t("A title or some notes") },
];

const CHART_TYPES: { type: BlockChartType, thumb: string, label: () => string }[] = [
  { type: "bar", thumb: "column", label: () => t("Columns") },
  { type: "hbar", thumb: "hbar", label: () => t("Bars") },
  { type: "line", thumb: "line", label: () => t("Line") },
  { type: "area", thumb: "area", label: () => t("Area") },
  { type: "donut", thumb: "donut", label: () => t("Donut") },
  { type: "pie", thumb: "pie", label: () => t("Pie") },
  { type: "funnel", thumb: "funnel", label: () => t("Funnel") },
  { type: "treemap", thumb: "treemap", label: () => t("Treemap") },
];

export function openBlockEditor(gristDoc: GristDoc, initial: DashboardBlock,
  onSave: (block: DashboardBlock) => Promise<void>, options: { isNew?: boolean } = {}) {
  const docModel = gristDoc.docModel;
  saveModal((_ctl, owner) => {
    const draft = Observable.create<DashboardBlock>(owner, { ...initial });
    const prop = <K extends keyof DashboardBlock>(key: K) => Computed.create(owner, use => use(draft)[key])
      .onWrite(val => draft.set({ ...draft.get(), [key]: val }));

    const kind = prop("kind");
    const tableId = prop("tableId");
    const agg = Computed.create(owner, use => use(draft).agg || "count")
      .onWrite(val => draft.set({ ...draft.get(), agg: val }));
    const measure = prop("measure");
    const groupBy = prop("groupBy");
    const chartType = Computed.create(owner, use => use(draft).chartType || "bar")
      .onWrite(val => draft.set({ ...draft.get(), chartType: val }));
    const title = Computed.create(owner, use => use(draft).title || "")
      .onWrite(val => draft.set({ ...draft.get(), title: val || undefined }));
    const palette = Computed.create(owner, use => use(draft).palette || DEFAULT_PALETTE)
      .onWrite(val => draft.set({ ...draft.get(), palette: val }));
    const dateBucket = Computed.create(owner, use => use(draft).dateBucket || "month")
      .onWrite(val => draft.set({ ...draft.get(), dateBucket: val }));
    const limit = Computed.create(owner, use => use(draft).limit || 0)
      .onWrite(val => draft.set({ ...draft.get(), limit: val || undefined }));
    const showTrend = Computed.create(owner, use => Boolean(use(draft).trendDate))
      .onWrite((val) => {
        const firstDate = getUserColumns(getTable(docModel, draft.get().tableId))
          .find(c => isDateType(c.pureType.peek()))?.colId.peek();
        draft.set({ ...draft.get(), trendDate: val ? firstDate : undefined });
      });
    const sectionRef = Computed.create(owner, use => use(draft).sectionRef || 0)
      .onWrite(val => draft.set({ ...draft.get(), sectionRef: val }));

    // When the table changes, columns of the old table make no sense anymore.
    owner.autoDispose(tableId.addListener((tid) => {
      draft.set({ ...draft.get(), measure: undefined, groupBy: defaultGroupBy(docModel, tid), trendDate: undefined,
        agg: "count" });
    }));
    // Counting doesn't need a column; other aggregations need a suitable one.
    owner.autoDispose(agg.addListener((val) => {
      const cols = measureOptions(val);
      const current = draft.get().measure;
      if (val === "count") {
        draft.set({ ...draft.get(), measure: undefined });
      } else if (!cols.some(c => c.value === current)) {
        draft.set({ ...draft.get(), measure: cols[0]?.value });
      }
    }));

    const tableOptions: IOptionFull<string>[] = getDashboardTables(docModel).map(tbl => ({
      value: tbl.tableId.peek(), label: tbl.tableNameDef.peek(), icon: "TypeTable",
    }));

    function columnsOf(tid: string | undefined) {
      return getUserColumns(getTable(docModel, tid));
    }
    function measureOptions(aggVal: string): IOptionFull<string>[] {
      return columnsOf(draft.get().tableId)
        .filter(c => aggVal === "distinct" || isNumericType(c.pureType.peek()))
        .map(c => ({ value: c.colId.peek(), label: c.label.peek(), icon: "FieldColumn" as IconName }));
    }
    const groupOptions = Computed.create(owner, (use) => {
      use(tableId);
      return columnsOf(use(draft).tableId).map(c => ({
        value: c.colId.peek(), label: c.label.peek(),
        icon: (isDateType(c.pureType.peek()) ? "FieldDate" : "FieldColumn") as IconName,
      }));
    });
    const measureOpts = Computed.create(owner, (use) => { use(tableId); return measureOptions(use(agg)); });
    const groupIsDate = Computed.create(owner, (use) => {
      const col = columnsOf(use(tableId)).find(c => c.colId.peek() === use(groupBy));
      return col ? isDateType(shownType(col)) : false;
    });
    const chartSections = getChartSections(docModel)
      .map(s => ({ value: s.getRowId(), label: `${s.view.peek().name.peek()} › ${s.titleDef.peek()}`,
        icon: "TypeChart" as IconName }));

    const aggOptions: IOptionFull<string>[] = ["count", "sum", "avg", "min", "max", "distinct"]
      .map(a => ({ value: a, label: aggLabel(a as any) }));

    const autoTitleObs = Computed.create(owner, use => autoTitle(docModel, use(draft)));
    const canSave = Computed.create(owner, (use) => {
      const b = use(draft);
      if (b.kind === "embed") { return Boolean(b.sectionRef); }
      if (b.kind === "text") { return true; }
      if (!b.tableId) { return false; }
      if ((b.agg || "count") !== "count" && !b.measure) { return false; }
      if (b.kind === "chart" && !b.groupBy) { return false; }
      return true;
    });

    return {
      title: options.isNew ? t("Add a block") : t("Edit block"),
      saveLabel: options.isNew ? t("Add") : t("Save"),
      width: "fixed-wide",
      saveDisabled: Computed.create(owner, use => !use(canSave)),
      saveFunc: async () => {
        const block = { ...draft.get() };
        if (block.kind === "text" || block.kind === "embed") {
          delete block.tableId; delete block.agg; delete block.measure; delete block.groupBy;
        }
        if (block.kind === "kpi") { block.width = initial.kind === "kpi" ? block.width : 1; }
        if (block.kind !== "kpi" && initial.kind === "kpi" && (block.width || 1) < 2) { block.width = 2; }
        if (block.kind === "text" && options.isNew) { block.width = 4; }
        await onSave(block);
      },
      body: [
        cssKinds(
          KINDS.map(k => cssKind(
            cssKind.cls("-selected", use => use(kind) === k.kind),
            cssKindIcon(icon(k.icon)),
            cssKindLabel(k.label()),
            cssKindHelp(k.help()),
            dom.on("click", () => kind.set(k.kind)),
            testId(`kind-${k.kind}`),
          )),
        ),
        dom.domComputed(kind, (k) => {
          if (k === "text") {
            return cssHint(t("The text block is added to the dashboard, and you can type in it right away."));
          }
          if (k === "embed") {
            return chartSections.length ? [
              cssField(cssLabel(t("Chart to show")),
                select(sectionRef, chartSections, { defaultLabel: t("Pick a chart") }), testId("section")),
              cssHint(t("The chart is shown as it is, with its own settings: change it on its own page.")),
            ] : cssHint(t("This document has no chart yet. Add a chart widget to a page first."));
          }
          return [
            cssRow2(
              cssField(cssLabel(t("Data from")), select(tableId, tableOptions), testId("table")),
              cssField(cssLabel(t("Calculation")), select(agg, aggOptions), testId("agg")),
            ),
            dom.maybe(use => use(agg) !== "count", () =>
              cssField(cssLabel(t("Of the column")),
                select(measure, measureOpts, { defaultLabel: t("Pick a column") }), testId("measure"),
                dom.maybe(use => use(measureOpts).length === 0, () =>
                  cssHint(t("This table has no numeric column."))),
              ),
            ),
            k === "chart" ? [
              cssRow2(
                cssField(cssLabel(t("Split by")),
                  select(groupBy, groupOptions, { defaultLabel: t("Pick a column") }), testId("group-by")),
                dom.domComputed(groupIsDate, isDate => isDate ?
                  cssField(cssLabel(t("Period")), select(dateBucket, ["day", "week", "month", "quarter", "year"]
                    .map(b => ({ value: b as DateBucket, label: bucketLabel(b as DateBucket) }))), testId("bucket")) :
                  cssField(cssLabel(t("Show")), select(limit, [
                    { value: 0, label: t("All values") },
                    { value: 5, label: t("Top 5") },
                    { value: 10, label: t("Top 10") },
                    { value: 20, label: t("Top 20") },
                  ]), testId("limit")),
                ),
              ),
              cssField(cssLabel(t("Chart type")),
                cssTypes(CHART_TYPES.map(ct => cssTypeTile(
                  cssTypeTile.cls("-selected", use => use(chartType) === ct.type),
                  dom.domComputed(palette, p => buildThumbnail(ct.thumb, getPaletteColors(p, false))),
                  cssTypeLabel(ct.label()),
                  dom.on("click", () => chartType.set(ct.type)),
                  testId(`type-${ct.type}`),
                ))),
              ),
            ] : cssCheckRow(
              squareCheckbox(showTrend), t("Show the trend over time"),
              testId("trend"),
            ),
            cssRow2(
              cssField(cssLabel(t("Title")),
                cssInput(
                  dom.prop("value", title),
                  dom.attr("placeholder", autoTitleObs),
                  dom.on("input", (_ev, elem) => title.set(elem.value)),
                  testId("title"),
                ),
              ),
              cssField(cssLabel(t("Colors")),
                cssPalettes(CHART_PALETTES.map(p => cssPalette(
                  cssPalette.cls("-selected", use => use(palette) === p.id),
                  p.light.slice(0, 4).map(c => cssSwatch(dom.style("background-color", c))),
                  dom.on("click", () => palette.set(p.id)),
                ))),
              ),
            ),
            cssLabel(t("Preview")),
            buildPreview(owner, gristDoc, draft),
          ];
        }),
      ],
    };
  });
}

function buildPreview(owner: IDisposableOwner, gristDoc: GristDoc, draft: Observable<DashboardBlock>) {
  const docModel = gristDoc.docModel;
  const holder = cssPreviewChart();
  const host = new EChartsHost(holder);
  owner.autoDispose({ dispose: () => host.dispose() });
  const kpiText = Observable.create(owner, "");
  const message = Observable.create(owner, "");
  const isKpi = Computed.create(owner, use => use(draft).kind === "kpi");

  const render = debounce(async () => {
    const block = draft.get();
    if (!block.tableId) { message.set(t("Pick a table.")); return; }
    await fetchBlockTables(docModel, [block]);
    if ((block.agg || "count") !== "count" && !block.measure) {
      message.set(t("Pick the column to compute.")); host.clear(); kpiText.set(""); return;
    }
    if (block.kind === "kpi") {
      message.set("");
      kpiText.set(computeKpi(docModel, block).text);
      return;
    }
    const groups = computeGroups(docModel, block);
    if (!groups) { message.set(t("Pick the column to split by.")); host.clear(); return; }
    if (!groups.labels.length) { message.set(t("No data to show.")); host.clear(); return; }
    message.set("");
    const fmt = getValueFormatter(docModel, block);
    const name = block.title || autoTitle(docModel, block);
    const option = buildEChartsOption(groupsToTraces(block, groups, name), {
      chartType: block.chartType === "hbar" ? "bar" : (block.chartType || "bar"),
      options: { palette: block.palette, showValues: groups.labels.length <= 12 },
      formatValue: (v: any) => fmt(v),
      compact: true,
    }, getChartColors(block.palette));
    await host.render(option, String(block.chartType));
    host.resize();
  }, 50);
  owner.autoDispose(draft.addListener(() => render()?.catch(reportError)));
  setTimeout(() => render()?.catch(reportError), 50);

  return cssPreview(
    dom.domComputed(isKpi, kpi => kpi ?
      cssPreviewKpi(
        cssPreviewKpiTitle(dom.text(use => use(draft).title || autoTitle(docModel, use(draft)))),
        cssPreviewKpiValue(dom.text(kpiText)),
      ) : null),
    dom.style("height", use => use(isKpi) ? "auto" : "240px"),
    dom.update(holder, dom.hide(isKpi)),
    dom.maybe(message, msg => cssPreviewMessage(msg)),
    testId("preview"),
  );
}

const cssKinds = styled("div", `
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 20px;
`);

const cssKind = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid ${theme.pagePanelsBorder};
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
  &:hover { border-color: ${theme.controlFg}; }
  &-selected, &-selected:hover {
    border-color: ${theme.controlFg};
    box-shadow: inset 0 0 0 1px ${theme.controlFg};
    background-color: ${theme.lightHover};
  }
`);

const cssKindIcon = styled("div", `
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  margin-bottom: 4px;
  background-color: ${theme.lightHover};
  --icon-color: ${theme.controlFg};
  .${cssKind.className}-selected & { background-color: ${theme.mainPanelBg}; }
`);

const cssKindLabel = styled("div", `
  font-weight: 600;
  color: ${theme.text};
`);

const cssKindHelp = styled("div", `
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  line-height: 1.35;
`);

const cssField = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
  min-width: 0;
  flex: 1 1 0;
`);

const cssRow2 = styled("div", `
  display: flex;
  gap: 12px;
`);

const cssLabel = styled("div", `
  font-size: ${vars.xsmallFontSize};
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: ${theme.lightText};
`);

const cssHint = styled("div", `
  color: ${theme.lightText};
  line-height: 1.5;
  margin-bottom: 12px;
`);

const cssCheckRow = styled("label", `
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  font-weight: normal;
  color: ${theme.text};
  cursor: pointer;
`);

const cssInput = styled("input", `
  height: 30px;
  padding: 0 8px;
  border-radius: 3px;
  border: 1px solid ${theme.inputBorder};
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  outline: none;
  font-size: ${vars.mediumFontSize};
  &:focus { border-color: ${theme.controlFg}; }
  &::placeholder { color: ${theme.inputPlaceholderFg}; }
`);

const cssTypes = styled("div", `
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 6px;
`);

const cssTypeTile = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px 4px 2px;
  border-radius: 8px;
  border: 1px solid ${theme.pagePanelsBorder};
  cursor: pointer;
  & > svg { width: 36px; height: 24px; }
  &:hover { border-color: ${theme.controlFg}; }
  &-selected, &-selected:hover {
    border-color: ${theme.controlFg};
    box-shadow: inset 0 0 0 1px ${theme.controlFg};
    background-color: ${theme.lightHover};
  }
`);

const cssTypeLabel = styled("div", `
  font-size: ${vars.xsmallFontSize};
  color: ${theme.text};
`);

const cssPalettes = styled("div", `
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: 30px;
`);

const cssPalette = styled("div", `
  display: flex;
  padding: 3px;
  border-radius: 6px;
  border: 1px solid ${theme.pagePanelsBorder};
  cursor: pointer;
  &:hover { border-color: ${theme.controlFg}; }
  &-selected, &-selected:hover {
    border-color: ${theme.controlFg};
    box-shadow: inset 0 0 0 1px ${theme.controlFg};
  }
`);

const cssSwatch = styled("div", `
  width: 7px;
  height: 14px;
  &:first-child { border-radius: 3px 0 0 3px; }
  &:last-child { border-radius: 0 3px 3px 0; }
`);

const cssPreview = styled("div", `
  position: relative;
  margin-top: 6px;
  border-radius: 10px;
  border: 1px solid ${theme.pagePanelsBorder};
  padding: 8px;
  overflow: hidden;
`);

const cssPreviewChart = styled("div", `
  position: absolute;
  inset: 8px;
`);

const cssPreviewKpi = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
`);

const cssPreviewKpiTitle = styled("div", `
  font-size: ${vars.smallFontSize};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: ${theme.lightText};
`);

const cssPreviewKpiValue = styled("div", `
  font-size: 30px;
  font-weight: 700;
  color: ${theme.text};
`);

const cssPreviewMessage = styled("div", `
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${theme.lightText};
  background-color: ${theme.mainPanelBg};
`);
