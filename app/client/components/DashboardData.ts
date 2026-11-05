/**
 * Data side of the dashboard widget: the description of its blocks (saved in the section's
 * options), and the aggregation of table data into the numbers and series those blocks show.
 *
 * Everything here works from the document's metadata (tables, columns and their types), so that a
 * dashboard can be described with a few words ("sum of Amount by Region") rather than by building
 * a summary table first.
 */
import { formatFull, Trace, TraceData } from "app/client/components/ChartRenderer";
import { formatChartValue } from "app/client/components/ChartView";
import { makeT } from "app/client/lib/localization";
import { ColumnRec, DocModel, TableRec, ViewSectionRec } from "app/client/models/DocModel";
import { removePrefix } from "app/common/gutil";
import { decodeObject } from "app/plugin/objtypes";

import moment from "moment-timezone";

const t = makeT("DashboardData");

export type BlockKind = "kpi" | "chart" | "embed" | "text";
export type Aggregation = "count" | "sum" | "avg" | "min" | "max" | "distinct";
export type DateBucket = "day" | "week" | "month" | "quarter" | "year";
export type BlockChartType = "bar" | "hbar" | "line" | "area" | "pie" | "donut" | "funnel" | "treemap";

export interface DashboardBlock {
  id: string;
  kind: BlockKind;
  title?: string;
  // Width, in columns of the dashboard grid (which has 4).
  width?: number;
  // Height of chart blocks, in pixels.
  height?: number;

  // For "kpi" and "chart" blocks: what to compute.
  tableId?: string;
  agg?: Aggregation;
  measure?: string;           // colId of the measured column (not needed to count rows).
  groupBy?: string;           // colId of the column to group by (charts).
  dateBucket?: DateBucket;    // When grouping by a date.
  limit?: number;             // Keep only the top N groups (others are combined).
  chartType?: BlockChartType;
  palette?: string;
  showValues?: boolean;

  // For "kpi" blocks: a trend line over time, from a date column.
  trendDate?: string;

  // For "embed" blocks: the chart widget to show.
  sectionRef?: number;

  // For "text" blocks.
  text?: string;
}

export interface DashboardSpec {
  blocks: DashboardBlock[];
}

export const GRID_COLUMNS = 4;

export function newBlockId() {
  return Math.random().toString(36).slice(2, 10);
}

export function isDateType(pureType: string) {
  return pureType === "Date" || pureType === "DateTime";
}

export function isNumericType(pureType: string) {
  return pureType === "Numeric" || pureType === "Int";
}

// Tables a dashboard can draw from: the user's tables, without summary tables or hidden ones.
export function getDashboardTables(docModel: DocModel): TableRec[] {
  return docModel.visibleTables.all().filter(tbl => !tbl.summarySourceTable.peek());
}

// The chart widgets of the document, that a dashboard can embed.
export function getChartSections(docModel: DocModel): ViewSectionRec[] {
  return docModel.viewSections.tableData.getRowIds()
    .map(id => docModel.viewSections.getRowModel(id))
    .filter(s => s.parentKey.peek() === "chart" && !s.isRaw.peek() && s.view.peek().getRowId());
}

export function getTable(docModel: DocModel, tableId?: string): TableRec | undefined {
  if (!tableId) { return undefined; }
  return docModel.allTables.all().find(tbl => tbl.tableId.peek() === tableId);
}

export function getUserColumns(table: TableRec | undefined): ColumnRec[] {
  if (!table) { return []; }
  return table.columns.peek().peek().filter(c => !c.isHiddenCol.peek());
}

export function getColumn(docModel: DocModel, tableId?: string, colId?: string): ColumnRec | undefined {
  if (!colId) { return undefined; }
  return getUserColumns(getTable(docModel, tableId)).find(c => c.colId.peek() === colId);
}

// Type of the values a column shows (the type of the shown column, for references).
export function shownType(col: ColumnRec): string {
  const pureType = col.pureType.peek();
  if (pureType === "Ref" || pureType === "RefList") {
    return col.visibleColModel.peek().pureType.peek() || "Text";
  }
  return pureType;
}

export function aggLabel(agg: Aggregation | undefined): string {
  switch (agg) {
    case "sum": return t("Sum");
    case "avg": return t("Average");
    case "min": return t("Minimum");
    case "max": return t("Maximum");
    case "distinct": return t("Distinct values");
    default: return t("Number of rows");
  }
}

export function bucketLabel(bucket: DateBucket | undefined): string {
  switch (bucket) {
    case "day": return t("By day");
    case "week": return t("By week");
    case "quarter": return t("By quarter");
    case "year": return t("By year");
    default: return t("By month");
  }
}

/**
 * A title that describes the block, used when the user didn't type one.
 */
export function autoTitle(docModel: DocModel, block: DashboardBlock): string {
  if (block.kind === "embed") {
    const section = docModel.viewSections.getRowModel(block.sectionRef || 0);
    return section?.id.peek() ? (section.titleDef.peek() || t("Chart")) : t("Chart");
  }
  if (block.kind === "text") { return ""; }
  const measureCol = getColumn(docModel, block.tableId, block.measure);
  const groupCol = getColumn(docModel, block.tableId, block.groupBy);
  const table = getTable(docModel, block.tableId);
  let what: string;
  if (!block.agg || block.agg === "count" || !measureCol) {
    what = t("Number of {{table}}", { table: table?.tableNameDef.peek() || t("rows") });
  } else if (block.agg === "distinct") {
    what = t("Distinct {{column}}", { column: measureCol.label.peek() });
  } else {
    what = `${aggLabel(block.agg)} ${t("of")} ${measureCol.label.peek()}`;
  }
  if (block.kind === "chart" && groupCol) {
    return t("{{what}} by {{column}}", { what, column: groupCol.label.peek() });
  }
  return what;
}

/**
 * Reads the values shown in a column, as plain JS values. References give the value of their shown
 * column, dates are returned as numbers of seconds.
 */
function getShownValues(docModel: DocModel, tableId: string, col: ColumnRec):
{ rowIds: readonly number[], values: any[] } {
  const tableData = docModel.docData.getTable(tableId);
  if (!tableData) { return { rowIds: [], values: [] }; }
  const rowIds = tableData.getRowIds();
  const pureType = col.pureType.peek();
  let colId = col.colId.peek();
  if (pureType === "Ref" || pureType === "RefList") {
    colId = col.displayColModel.peek().colId.peek() || colId;
  }
  const getter = tableData.getRowPropFunc(colId);
  return { rowIds, values: rowIds.map(r => getter(r)) };
}

function toList(value: any): any[] {
  if (Array.isArray(value) && value[0] === "L") {
    const decoded = decodeObject(value as any);
    return Array.isArray(decoded) ? decoded : [decoded];
  }
  return [value];
}

function aggregate(values: number[], agg: Aggregation, distinct?: Set<any>): number | null {
  switch (agg) {
    case "count": return values.length;
    case "distinct": return distinct ? distinct.size : 0;
    case "sum": return values.reduce((a, b) => a + b, 0);
    case "avg": return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    case "min": return values.length ? Math.min(...values) : null;
    case "max": return values.length ? Math.max(...values) : null;
  }
}

interface Accumulator {
  count: number;
  nums: number[];
  distinct: Set<any>;
}

function newAcc(): Accumulator { return { count: 0, nums: [], distinct: new Set() }; }

function accValue(acc: Accumulator, agg: Aggregation): number | null {
  if (agg === "count") { return acc.count; }
  return aggregate(acc.nums, agg, acc.distinct);
}

/**
 * Makes a function that gives the measured value of each row, to accumulate into groups.
 */
function makeMeasure(docModel: DocModel, block: DashboardBlock) {
  const agg = block.agg || "count";
  const measureCol = agg === "count" ? undefined : getColumn(docModel, block.tableId, block.measure);
  const measured = measureCol ? getShownValues(docModel, block.tableId!, measureCol).values : null;
  return (acc: Accumulator, index: number) => {
    acc.count++;
    if (!measured) { return; }
    const v = measured[index];
    if (agg === "distinct") {
      for (const item of toList(v)) {
        if (item !== null && item !== undefined && item !== "") { acc.distinct.add(item); }
      }
    } else if (typeof v === "number" && isFinite(v)) {
      acc.nums.push(v);
    }
  };
}

export function getValueFormatter(docModel: DocModel, block: DashboardBlock): (v: any) => string {
  const agg = block.agg || "count";
  if (agg === "count" || agg === "distinct") {
    return (v: any) => (typeof v === "number" ? formatFull(v) : String(v ?? ""));
  }
  const col = getColumn(docModel, block.tableId, block.measure);
  const formatter = col?.formatter.peek();
  return (v: any) => {
    if (typeof v !== "number") { return String(v ?? ""); }
    // Averages of whole numbers are rarely whole: keep two decimals then.
    if (agg === "avg" && !Number.isInteger(v) && col?.pureType.peek() === "Int") { return formatFull(v); }
    return formatChartValue(v, formatter);
  };
}

/** Loads the data of the tables the given blocks use. */
export async function fetchBlockTables(docModel: DocModel, blocks: DashboardBlock[]) {
  const tableIds = new Set(blocks.map(b => b.tableId).filter((id): id is string => Boolean(id)));
  await Promise.all([...tableIds].map(async (tableId) => {
    const model = docModel.getTableModel(tableId);
    if (model && !model.tableData.isLoaded) { await model.fetch(); }
  }));
}

export interface KpiResult {
  value: number | null;
  text: string;
  trend?: { labels: string[], values: (number | null)[] };
  delta?: number | null;     // Relative change between the last two periods of the trend.
}

export function computeKpi(docModel: DocModel, block: DashboardBlock): KpiResult {
  const agg = block.agg || "count";
  const fmt = getValueFormatter(docModel, block);
  const tableData = block.tableId ? docModel.docData.getTable(block.tableId) : undefined;
  if (!tableData) { return { value: null, text: "–" }; }
  const n = tableData.getRowIds().length;
  const add = makeMeasure(docModel, block);
  const acc = newAcc();
  for (let i = 0; i < n; i++) { add(acc, i); }
  const value = accValue(acc, agg);
  const result: KpiResult = { value, text: value === null ? "–" : fmt(value) };
  if (block.trendDate) {
    const series = computeGroups(docModel, {
      ...block, groupBy: block.trendDate, dateBucket: block.dateBucket || "month",
      limit: undefined });
    if (series && series.labels.length >= 2) {
      result.trend = { labels: series.labels, values: series.values };
      const last = series.values[series.values.length - 1];
      const prev = series.values[series.values.length - 2];
      result.delta = (typeof last === "number" && typeof prev === "number" && prev !== 0) ?
        (last - prev) / Math.abs(prev) : null;
    }
  }
  return result;
}

export interface GroupsResult {
  labels: string[];
  values: (number | null)[];
  isDate: boolean;
}

function bucketStart(seconds: number, tz: string, bucket: DateBucket): moment.Moment {
  const m = moment.tz(seconds * 1000, tz);
  return bucket === "week" ? m.startOf("isoWeek") : m.startOf(bucket);
}

function formatBucket(m: moment.Moment, bucket: DateBucket): string {
  const date = new Date(m.year(), m.month(), m.date());
  const locale = document.documentElement.lang || undefined;
  try {
    switch (bucket) {
      case "year": return String(m.year());
      case "quarter": return `T${m.quarter()} ${m.year()}`;
      case "month": return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(date);
      default: return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
    }
  } catch (e) {
    return m.format("YYYY-MM-DD");
  }
}

/**
 * Groups the rows of the block's table by the values of its groupBy column, and aggregates the
 * measure for each group. Dates are grouped by period and kept in chronological order; other
 * groups are sorted by decreasing value, and limited to the top N (the rest is combined into an
 * "Others" group when that makes sense).
 */
export function computeGroups(docModel: DocModel, block: DashboardBlock): GroupsResult | null {
  const agg = block.agg || "count";
  const groupCol = getColumn(docModel, block.tableId, block.groupBy);
  if (!groupCol || !block.tableId) { return null; }
  const { values: groupValues } = getShownValues(docModel, block.tableId, groupCol);
  const add = makeMeasure(docModel, block);
  const pureType = shownType(groupCol);
  const isDate = isDateType(pureType);
  const groups = new Map<string, { acc: Accumulator, sortKey: number }>();
  const bucket = block.dateBucket || "month";
  const tz = removePrefix(groupCol.type.peek(), "DateTime:") || "UTC";

  groupValues.forEach((raw, i) => {
    for (const v of toList(raw)) {
      let key: string;
      let sortKey = 0;
      if (isDate) {
        if (typeof v !== "number" || !v) { continue; }
        const m = bucketStart(v, tz, bucket);
        sortKey = m.valueOf();
        key = formatBucket(m, bucket);
      } else if (v === null || v === undefined || v === "") {
        key = t("(empty)");
      } else if (typeof v === "boolean") {
        key = v ? t("Yes") : t("No");
      } else {
        key = String(v);
      }
      let g = groups.get(key);
      if (!g) { groups.set(key, g = { acc: newAcc(), sortKey }); }
      add(g.acc, i);
    }
  });

  let entries = [...groups.entries()].map(([label, g]) => ({ label, value: accValue(g.acc, agg), sortKey: g.sortKey,
    acc: g.acc }));
  if (isDate) {
    entries.sort((a, b) => a.sortKey - b.sortKey);
  } else if (isNumericType(pureType)) {
    entries.sort((a, b) => Number(a.label) - Number(b.label));
  } else {
    entries.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
    if (block.limit && entries.length > block.limit) {
      const rest = entries.slice(block.limit);
      entries = entries.slice(0, block.limit);
      if (agg === "count" || agg === "sum") {
        const others = rest.reduce((s, e) => s + (e.value || 0), 0);
        entries.push({ label: t("Others"), value: others, sortKey: 0, acc: newAcc() });
      }
    }
  }
  return { labels: entries.map(e => e.label), values: entries.map(e => e.value), isDate };
}

/**
 * Turns groups into the traces understood by the chart renderer.
 */
export function groupsToTraces(block: DashboardBlock, groups: GroupsResult, seriesName: string): TraceData {
  const type = block.chartType || "bar";
  const meta = { label: seriesName };
  let trace: Trace;
  switch (type) {
    case "hbar":
      // Horizontal bars are drawn from the bottom up: reverse, so the biggest values come first.
      trace = { type: "bar", orientation: "h", x: groups.values.slice().reverse() as any,
        y: groups.labels.slice().reverse(), name: seriesName, meta };
      break;
    case "line":
      trace = { type: "scatter", mode: "lines+markers", x: groups.labels, y: groups.values as any, name: seriesName,
        meta };
      break;
    case "area":
      trace = { type: "scatter", mode: "lines", fill: "tozeroy", line: { shape: "spline" }, x: groups.labels,
        y: groups.values as any, name: seriesName, meta };
      break;
    case "pie":
    case "donut":
    case "funnel":
    case "treemap": {
      trace = { type: (type === "donut" ? "pie" : type) as any, labels: groups.labels, values: groups.values as any,
        name: seriesName, meta } as Trace;
      if (type === "donut") { (trace as any).hole = 0.62; }
      break;
    }
    default:
      trace = { type: "bar", x: groups.labels, y: groups.values as any, name: seriesName, meta };
  }
  return { data: [trace], layout: { xaxis: { type: "category" } as any } };
}

/**
 * A good column to split a new chart by: a category (choice, reference...), else a date.
 */
export function defaultGroupBy(docModel: DocModel, tableId: string | undefined): string | undefined {
  const cols = getUserColumns(getTable(docModel, tableId));
  const cat = cols.find(c => ["Choice", "Ref", "ChoiceList", "RefList", "Bool"].includes(c.pureType.peek()));
  return (cat || cols.find(c => isDateType(c.pureType.peek())) || cols.find(c => c.pureType.peek() === "Text"))
    ?.colId.peek();
}

/**
 * Builds a starting dashboard from a table's metadata: key figures first, then a few charts that
 * suit the table's columns (a trend over time for dates, breakdowns for categories), and the
 * document's existing charts.
 */
export function generateBlocks(docModel: DocModel, tableId: string): DashboardBlock[] {
  const table = getTable(docModel, tableId);
  const cols = getUserColumns(table);
  const tableData = docModel.docData.getTable(tableId);
  const rowCount = tableData?.getRowIds().length || 0;
  const numeric = cols.filter(c => isNumericType(c.pureType.peek()) && !/^(id|.*_?id)$/i.test(c.colId.peek()));
  const dates = cols.filter(c => isDateType(c.pureType.peek()));
  // Categories: columns with a few distinct values, good for breakdowns.
  const categories = cols.filter((c) => {
    const pt = c.pureType.peek();
    if (!["Choice", "ChoiceList", "Ref", "RefList", "Text", "Bool"].includes(pt)) { return false; }
    if (!tableData) { return pt !== "Text"; }
    const { values } = getShownValues(docModel, tableId, c);
    const distinct = new Set(values.flatMap(toList));
    return distinct.size >= 2 && distinct.size <= Math.max(12, Math.min(25, rowCount / 4));
  });

  const blocks: DashboardBlock[] = [];
  const mainDate = dates[0]?.colId.peek();
  blocks.push({ id: newBlockId(), kind: "kpi", tableId, agg: "count", width: 1, trendDate: mainDate });
  for (const col of numeric.slice(0, 2)) {
    blocks.push({ id: newBlockId(), kind: "kpi", tableId, agg: "sum", measure: col.colId.peek(), width: 1,
      trendDate: mainDate });
  }
  if (numeric[0]) {
    blocks.push({ id: newBlockId(), kind: "kpi", tableId, agg: "avg", measure: numeric[0].colId.peek(), width: 1 });
  } else if (categories[0]) {
    blocks.push({ id: newBlockId(), kind: "kpi", tableId, agg: "distinct", measure: categories[0].colId.peek(),
      width: 1 });
  }
  // Fill the first row of 4 key figures.
  while (blocks.length < GRID_COLUMNS && categories[blocks.length - 1]) {
    blocks.push({ id: newBlockId(), kind: "kpi", tableId, agg: "distinct",
      measure: categories[blocks.length - 1].colId.peek(), width: 1 });
  }
  const measure = numeric[0]?.colId.peek();
  const agg: Aggregation = measure ? "sum" : "count";
  if (mainDate) {
    blocks.push({ id: newBlockId(), kind: "chart", chartType: "area", tableId, agg, measure, groupBy: mainDate,
      dateBucket: "month", width: categories.length ? 2 : 4 });
  }
  const chartTypes: BlockChartType[] = ["donut", "hbar", "bar", "treemap"];
  categories.slice(0, mainDate ? 3 : 4).forEach((col, i) => {
    blocks.push({ id: newBlockId(), kind: "chart", chartType: chartTypes[i % chartTypes.length], tableId,
      agg: i === 0 ? "count" : agg, measure, groupBy: col.colId.peek(), limit: 8, width: 2 });
  });
  return blocks;
}
