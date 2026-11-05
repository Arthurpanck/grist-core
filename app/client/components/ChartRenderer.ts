/**
 * Turns the chart data computed by ChartView into an ECharts option, and owns the ECharts
 * instance that draws it.
 *
 * ChartView builds its data as a list of Plotly-shaped "traces" (that representation predates
 * ECharts and is covered by tests and by Grist's own data handling: grouping, error bars,
 * aggregation...). This module is only about presentation: it maps those traces onto ECharts
 * series, and applies Grist's look (palettes, typography, light/dark theme, tooltips).
 */
import { EChartsType, loadECharts } from "app/client/lib/imports";
import { ChartOptions } from "app/client/models/entities/ViewSectionRec";
import { gristThemeObs } from "app/client/ui2018/theme";

import type { Datum, Layout, PlotData as PlotlyPlotData } from "plotly.js";

export type Trace = Partial<PlotlyPlotData> & { meta?: any };

export interface TraceData {
  data: Trace[];
  layout?: Partial<Layout>;
}

/**
 * Palettes offered to the user. "modern" is the default: a colorblind-checked categorical order.
 * Each palette lists light-theme colors, then (optionally) the dark-theme equivalents.
 */
export interface ChartPalette {
  id: string;
  light: string[];
  dark?: string[];
}

export const CHART_PALETTES: ChartPalette[] = [
  {
    id: "modern",
    light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
    dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#2f9e44", "#9085e9", "#e66767"],
  },
  {
    id: "grist",
    light: ["#16b378", "#2b78ae", "#fe945b", "#8563cc", "#d34141", "#28b4d3", "#db7fbf", "#b3b42b"],
  },
  {
    id: "ocean",
    light: ["#0b3d91", "#1f6fd1", "#3e9be9", "#69c0f5", "#14a3a3", "#5ad1b5", "#8a9bb5", "#334e68"],
    dark: ["#3d7be0", "#4f98ec", "#74b6f2", "#a3d4f8", "#2bc0c0", "#7ee0c8", "#a8b6cc", "#6b88a8"],
  },
  {
    id: "sunset",
    light: ["#e4572e", "#f3a712", "#a63d40", "#e98a15", "#6c4b8b", "#d1495b", "#edae49", "#3d5a80"],
  },
  {
    id: "pastel",
    light: ["#7aa6e0", "#f4a582", "#8fd3b8", "#f2cf73", "#c5a3e0", "#f29bb7", "#9ccbe8", "#b8d98c"],
  },
  {
    id: "mono",
    light: ["#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6", "#184f95", "#3987e5", "#9ec5f4"],
    dark: ["#5598e7", "#86b6ef", "#3987e5", "#b7d3f6", "#2a78d6", "#9ec5f4", "#6da7ec", "#cde2fb"],
  },
];

export const DEFAULT_PALETTE = "modern";

export function getPaletteColors(paletteId: string | undefined, dark: boolean): string[] {
  const palette = CHART_PALETTES.find(p => p.id === paletteId) || CHART_PALETTES[0];
  return (dark && palette.dark) || palette.light;
}

export type ValueFormatter = (value: any, seriesLabel?: string) => string;

export interface RenderContext {
  chartType: string;
  options: ChartOptions;
  // Formats a Y value for display (tooltips, data labels), using the column's own format.
  formatValue?: ValueFormatter;
  // Whether a legend should be offered at all (dashboards may hide it to save room).
  compact?: boolean;
}

interface ChartColors {
  dark: boolean;
  bg: string;
  fg: string;
  muted: string;
  axis: string;
  grid: string;
  tooltipBg: string;
  tooltipBorder: string;
  palette: string[];
}

function rawColor(value: any): string {
  return typeof value === "string" ? value : value?.getRawValue?.() || "";
}

export function getChartColors(paletteId?: string): ChartColors {
  const theme = gristThemeObs().get();
  const dark = theme.appearance === "dark";
  const { chartBg, chartFg, chartXAxis } = theme.colors.components;
  const bg = rawColor(chartBg) || (dark ? "#32323f" : "#ffffff");
  return {
    dark,
    bg,
    fg: rawColor(chartFg) || (dark ? "#efefef" : "#262633"),
    muted: dark ? "#a4a4b1" : "#6b6b78",
    axis: rawColor(chartXAxis) || (dark ? "#69697d" : "#c4c4cc"),
    grid: dark ? "rgba(255,255,255,0.08)" : "rgba(38,38,51,0.08)",
    tooltipBg: dark ? "#262633" : "#ffffff",
    tooltipBorder: dark ? "rgba(255,255,255,0.1)" : "rgba(38,38,51,0.08)",
    palette: getPaletteColors(paletteId, dark),
  };
}

const FONT_FAMILY = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

function getLocale(): string | undefined {
  return document.documentElement.lang || undefined;
}

let _compactFmt: Intl.NumberFormat | undefined;
let _plainFmt: Intl.NumberFormat | undefined;

let _fullFmt: Intl.NumberFormat | undefined;

/** Number with thousands separators: 338 106,5 */
export function formatFull(value: number): string {
  try {
    _fullFmt = _fullFmt || new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
    return _fullFmt.format(value);
  } catch (e) {
    return String(value);
  }
}

/** Short number for axis ticks: 950, 1 200, 12 k, 3,4 M. */
export function formatCompact(value: number): string {
  if (typeof value !== "number" || !isFinite(value)) { return String(value ?? ""); }
  try {
    if (Math.abs(value) >= 10000) {
      _compactFmt = _compactFmt || new Intl.NumberFormat(getLocale(), {
        notation: "compact", maximumFractionDigits: 1,
      });
      return _compactFmt.format(value);
    }
    _plainFmt = _plainFmt || new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 2 });
    return _plainFmt.format(value);
  } catch (e) {
    return String(value);
  }
}

// ChartView renders dates as ISO strings in the document's timezone (with an offset). We want to
// show exactly that wall-clock time, so we parse the date and time parts as local time.
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/;

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_RE.test(v) && v.length >= 10;
}

function isoToLocalTime(v: string): number {
  const m = ISO_RE.exec(v)!;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)).getTime();
}

function formatDate(time: number, withTime: boolean): string {
  try {
    return new Intl.DateTimeFormat(getLocale(), withTime ?
      { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(new Date(time));
  } catch (e) {
    return new Date(time).toDateString();
  }
}

// Compact date for axis ticks, depending on the span of the axis.
function formatAxisDate(time: number, span: number, withTime: boolean): string {
  const d = new Date(time);
  const day = 86400e3;
  let opts: Intl.DateTimeFormatOptions;
  if (span > 2 * 365 * day) {
    opts = d.getMonth() === 0 && d.getDate() === 1 ? { year: "numeric" } : { month: "short", year: "numeric" };
  } else if (span > 60 * day) {
    opts = d.getDate() === 1 ? (d.getMonth() === 0 ? { month: "short", year: "numeric" } : { month: "short" }) :
      { day: "numeric", month: "short" };
  } else if (span > 2 * day || !withTime) {
    opts = { day: "numeric", month: "short" };
  } else {
    opts = { hour: "2-digit", minute: "2-digit" };
  }
  try {
    return new Intl.DateTimeFormat(getLocale(), opts).format(d);
  } catch (e) {
    return d.toDateString();
  }
}

function hasTimePart(times: number[]) {
  return times.some((t) => {
    const d = new Date(t);
    return d.getHours() !== 0 || d.getMinutes() !== 0;
  });
}

function formatLabel(v: Datum): string {
  if (isIsoDate(v)) {
    const t = isoToLocalTime(v);
    return formatDate(t, hasTimePart([t]));
  }
  return v === null || v === undefined ? "" : String(v);
}

type AxisKind = "value" | "time" | "category";

function detectAxisKind(values: Datum[]): AxisKind {
  const present = values.filter(v => v !== null && v !== undefined && v !== "");
  if (!present.length) { return "category"; }
  if (present.every(v => typeof v === "number")) { return "value"; }
  if (present.every(isIsoDate)) { return "time"; }
  return "category";
}

function toArray(v: any): Datum[] {
  return Array.isArray(v) ? v : (v ? Array.from(v as ArrayLike<Datum>) : []);
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) { return hex; }
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function isPieLikeType(t: any) {
  return t === "pie" || t === "funnel" || t === "treemap";
}

/**
 * Builds a full ECharts option from traces. Pure function, exported for tests.
 */
export function buildEChartsOption(traceData: TraceData, ctx: RenderContext, colors: ChartColors): any {
  const traces = traceData.data || [];
  const layout = traceData.layout || {};
  const fmtValue: ValueFormatter = ctx.formatValue ||
    ((v: any) => (typeof v === "number" ? formatCompact(v) : String(v)));

  const base: any = {
    color: colors.palette,
    backgroundColor: "transparent",
    textStyle: { fontFamily: FONT_FAMILY, color: colors.fg },
    animationDuration: 600,
    animationDurationUpdate: 400,
    animationEasing: "cubicOut",
    tooltip: {
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: colors.fg, fontSize: 12, fontFamily: FONT_FAMILY },
      extraCssText: `border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,${colors.dark ? 0.45 : 0.12});`,
      confine: true,
    },
  };

  if (traces.length && traces.every(t => isPieLikeType(t.type))) {
    return { ...base, ...buildPieLike(traces, layout, ctx, colors, fmtValue) };
  }
  return { ...base, ...buildCartesian(traces, layout, ctx, colors, fmtValue) };
}

function legendOption(names: string[], colors: ChartColors, position: string | undefined, compact?: boolean) {
  const show = names.length > 1 && position !== "none";
  const common = {
    show,
    type: "scroll",
    icon: "circle",
    itemWidth: 9,
    itemHeight: 9,
    itemGap: 16,
    textStyle: { color: colors.fg, fontSize: 12 },
    pageIconColor: colors.muted,
    pageTextStyle: { color: colors.muted },
    data: names,
  };
  if (position === "right") {
    return { legend: { ...common, orient: "vertical", right: 8, top: "middle" }, reserve: { right: 140 } };
  }
  if (position === "bottom") {
    return { legend: { ...common, bottom: 4, left: "center" }, reserve: { bottom: show ? 28 : 0 } };
  }
  return { legend: { ...common, top: compact ? 0 : 4, left: "center" }, reserve: { top: show ? 30 : 0 } };
}

function tooltipRow(color: string, name: string, value: string) {
  return `<div style="display:flex;align-items:center;gap:8px;line-height:20px">` +
    `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color}"></span>` +
    `<span style="flex:1 1 auto;opacity:.8">${escapeHtml(name)}</span>` +
    `<span style="font-weight:600;margin-left:12px;font-variant-numeric:tabular-nums">${escapeHtml(value)}</span></div>`;
}

function tooltipTitle(text: string) {
  return `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(text)}</div>`;
}

function buildPieLike(traces: Trace[], layout: Partial<Layout>, ctx: RenderContext, colors: ChartColors,
  fmtValue: ValueFormatter) {
  const trace = traces[0];
  const opts = ctx.options || {};
  const labels = toArray((trace as any).labels).map(formatLabel);
  const values = toArray((trace as any).values);
  const label = trace.meta?.label;
  const data = labels.map((name, i) => ({ name, value: values[i] }))
    .filter(d => typeof d.value === "number");
  const total = data.reduce((s, d) => s + Math.abs(d.value as number), 0);
  const many = data.length > 8;
  const showValues = Boolean(opts.showValues);
  const legendPos = opts.legendPosition || (many ? "right" : "none");
  const { legend, reserve } = legendOption(data.map(d => d.name), colors, legendPos, ctx.compact);

  const tooltip = {
    trigger: "item",
    formatter: (p: any) => tooltipTitle(p.name) +
      tooltipRow(p.color, label || "", `${fmtValue(p.value, label)}` +
      (total ? `  ·  ${(100 * Math.abs(p.value) / total).toFixed(1)} %` : "")),
  };

  const type = trace.type as string;
  if (type === "funnel") {
    return {
      legend, tooltip,
      series: [{
        type: "funnel",
        left: "10%", right: reserve.right ? reserve.right + 20 : "10%",
        top: (reserve.top || 0) + 16, bottom: (reserve.bottom || 0) + 16,
        sort: "descending",
        gap: 3,
        minSize: "8%",
        label: {
          show: true, position: "inside", color: "#fff", fontWeight: 600,
          formatter: (p: any) => showValues ? `${p.name}\n${fmtValue(p.value, label)}` : p.name,
          textBorderColor: "rgba(0,0,0,0.25)", textBorderWidth: 2,
        },
        itemStyle: { borderColor: colors.bg, borderWidth: 0, borderRadius: 4 },
        emphasis: { label: { fontSize: 14 } },
        data,
      }],
    };
  }
  if (type === "treemap") {
    return {
      tooltip,
      series: [{
        type: "treemap",
        left: 4, right: 4, top: 4, bottom: 4,
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        label: {
          show: true, color: "#fff", fontSize: 13, fontWeight: 600, overflow: "truncate",
          formatter: (p: any) => `${p.name}\n{v|${fmtValue(p.value, label)}}`,
          rich: { v: { fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.9)", padding: [4, 0, 0, 0] } },
        },
        upperLabel: { show: false },
        itemStyle: { borderColor: colors.bg, borderWidth: 2, gapWidth: 2, borderRadius: 6 },
        colorMappingBy: "index",
        data,
      }],
    };
  }

  // Pie and donut.
  const hole = typeof (trace as any).hole === "number" ? (trace as any).hole : 0;
  const outer = 72;
  const radius = hole ? [`${Math.round(outer * hole)}%`, `${outer}%`] : ["0%", `${outer}%`];
  const centerX = reserve.right ? "40%" : "50%";
  const centerY = reserve.top ? "54%" : (reserve.bottom ? "46%" : "50%");
  const showLabels = !many || data.length <= 12;
  const annotations = (layout as any).annotations as any[] | undefined;
  const graphic: any[] = [];
  if (annotations?.length && hole) {
    const a = annotations[0];
    const size = a.font?.size || 24;
    graphic.push({
      type: "group",
      left: centerX, top: centerY,
      bounding: "raw",
      children: [
        { type: "text", style: { text: String(a.text), fontSize: size, fontWeight: 700, fill: colors.fg,
          textAlign: "center", textVerticalAlign: "middle", fontFamily: FONT_FAMILY }, y: -size * 0.15 },
        { type: "text", style: { text: "Total", fontSize: Math.max(11, size * 0.4), fill: colors.muted,
          textAlign: "center", textVerticalAlign: "top", fontFamily: FONT_FAMILY }, y: size * 0.45 },
      ],
    });
  }
  return {
    legend, tooltip, graphic,
    series: [{
      type: "pie",
      radius,
      center: [centerX, centerY],
      avoidLabelOverlap: true,
      padAngle: hole ? 1.5 : 0,
      minShowLabelAngle: 0,
      itemStyle: { borderColor: colors.bg, borderWidth: hole ? 0 : 2, borderRadius: hole ? 6 : 4 },
      label: {
        show: showLabels,
        color: colors.fg,
        fontSize: 12,
        formatter: (p: any) => `{n|${p.name}}\n{p|${showValues ? fmtValue(p.value, label) + " · " : ""}` +
          `${p.percent?.toFixed(p.percent < 10 ? 1 : 0)} %}`,
        rich: {
          n: { color: colors.fg, fontSize: 12, lineHeight: 16 },
          p: { color: colors.muted, fontSize: 11, lineHeight: 15 },
        },
      },
      labelLine: { show: showLabels, length: 10, length2: 12, smooth: true, lineStyle: { color: colors.axis } },
      emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 12, shadowColor: "rgba(0,0,0,0.18)" } },
      data,
    }],
  };
}

function buildCartesian(traces: Trace[], layout: Partial<Layout>, ctx: RenderContext, colors: ChartColors,
  fmtValue: ValueFormatter) {
  const opts = ctx.options || {};
  const chartType = ctx.chartType;
  const isBar = traces.some(t => t.type === "bar");
  const horizontal = traces.some(t => t.orientation === "h");
  // Axis carrying the "labels" (x in vertical charts) vs. the one carrying values.
  const labelKey = horizontal ? "y" : "x";
  const valueKey = horizontal ? "x" : "y";
  const allLabels: Datum[] = ([] as Datum[]).concat(...traces.map(t => toArray((t as any)[labelKey])));
  // Like Plotly, numbers go on a numeric axis (also for bars), and text on a category axis. Bars
  // over dates are shown as categories, which reads better than thin bars on a time line.
  let labelKind: AxisKind = detectAxisKind(allLabels);
  if (isBar && labelKind === "time") { labelKind = "category"; }
  const forcedCategory = ((layout as any)[`${labelKey}axis`]?.type === "category");
  if (forcedCategory) { labelKind = "category"; }

  const stacked = Boolean(opts.stacked) || (layout as any).barmode === "relative";
  const showValues = Boolean(opts.showValues);
  const smooth = opts.smooth ?? (chartType === "area");
  const names = traces.map((t, i) => String(t.name ?? `Series ${i + 1}`));

  // Category axis: union of labels in order of first appearance.
  const categories: string[] = [];
  const catIndex = new Map<string, number>();
  if (labelKind === "category") {
    for (const v of allLabels) {
      const key = formatLabel(v);
      if (!catIndex.has(key)) { catIndex.set(key, categories.length); categories.push(key); }
    }
  }
  const toLabelCoord = (v: Datum): any => {
    if (labelKind === "time") { return isIsoDate(v) ? isoToLocalTime(v) : null; }
    if (labelKind === "category") { return formatLabel(v); }
    return v;
  };

  const series: any[] = [];
  traces.forEach((trace, i) => {
    const color = colors.palette[i % colors.palette.length];
    const labels = toArray((trace as any)[labelKey]);
    const values = toArray((trace as any)[valueKey]);
    const seriesLabel = trace.meta?.label ?? names[i];
    let data: any[];
    if (labelKind === "category") {
      const arr: any[] = categories.map(() => null);
      labels.forEach((l, j) => { arr[catIndex.get(formatLabel(l))!] = values[j]; });
      data = arr;
    } else {
      data = labels.map((l, j) => {
        const c = toLabelCoord(l);
        return horizontal ? [values[j], c] : [c, values[j]];
      });
      if (labelKind === "time" || labelKind === "value") {
        // ECharts draws lines in data order; keep them in label order.
        const idx = horizontal ? 1 : 0;
        if (trace.type !== "bar" && (trace as any).mode !== "text+markers") {
          data.sort((a, b) => (a[idx] ?? 0) - (b[idx] ?? 0));
        }
      }
    }

    const valueLabel = {
      show: showValues,
      position: trace.type === "bar" ? (stacked ? "inside" : (horizontal ? "right" : "top")) : "top",
      color: trace.type === "bar" && stacked ? "#fff" : colors.muted,
      fontSize: 11,
      formatter: (p: any) => {
        const v = Array.isArray(p.value) ? p.value[horizontal ? 0 : 1] : p.value;
        return v === null || v === undefined ? "" : fmtValue(v, seriesLabel);
      },
    };

    if (trace.type === "bar") {
      const radius = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
      series.push({
        type: "bar",
        name: names[i],
        data,
        stack: stacked ? "total" : undefined,
        barMaxWidth: 36,
        barGap: "12%",
        barCategoryGap: traces.length > 1 ? "28%" : "38%",
        itemStyle: {
          color,
          borderRadius: stacked ? (i === traces.length - 1 ? radius : 0) : radius,
          borderColor: stacked ? colors.bg : undefined,
          borderWidth: stacked ? 1 : 0,
        },
        emphasis: { focus: "series", itemStyle: { shadowBlur: 8, shadowColor: hexToRgba(color, 0.4) } },
        label: valueLabel,
        meta: seriesLabel,
      });
    } else {
      const mode = String((trace as any).mode || "lines");
      const isScatterOnly = !mode.includes("lines");
      const isArea = (trace as any).fill === "tozeroy" || Boolean((trace as any).stackgroup) && chartType === "area";
      const shape = (trace as any).line?.shape;
      if (isScatterOnly) {
        const texts = toArray((trace as any).text);
        series.push({
          type: "scatter",
          name: names[i],
          data: data.map((d, j) => (texts[j] !== undefined ? { value: d, name: formatLabel(texts[j]) } : d)),
          symbolSize: 11,
          itemStyle: { color, opacity: 0.85, borderColor: colors.bg, borderWidth: 1.5 },
          emphasis: { focus: "series", scale: 1.4 },
          label: {
            show: texts.length > 0 && texts.length <= 40,
            position: "bottom", color: colors.muted, fontSize: 11,
            formatter: (p: any) => p.name || "",
          },
          meta: seriesLabel,
        });
      } else {
        const stackGroup = (trace as any).stackgroup;
        const markers = mode.includes("markers");
        series.push({
          type: "line",
          name: names[i],
          data,
          stack: stackGroup ? String(stackGroup) : undefined,
          smooth: shape === "hv" ? false : (shape === "spline" || smooth ? 0.35 : false),
          step: shape === "hv" ? "end" : undefined,
          connectNulls: Boolean((trace as any).connectgaps),
          showSymbol: markers || data.length <= 1,
          symbol: "circle",
          symbolSize: markers ? 7 : 6,
          lineStyle: { width: 2.5, color, cap: "round", join: "round" },
          itemStyle: { color, borderColor: colors.bg, borderWidth: 2 },
          areaStyle: isArea || stackGroup && chartType === "area" ? {
            color: {
              type: "linear", x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: hexToRgba(color, stackGroup ? 0.55 : 0.32) },
                { offset: 1, color: hexToRgba(color, stackGroup ? 0.25 : 0.02) },
              ],
            },
          } : (stackGroup ? { color: hexToRgba(color, 0.25) } : undefined),
          emphasis: { focus: "series" },
          label: valueLabel,
          meta: seriesLabel,
        });
      }
    }

    // Error bars, drawn as a custom series on top of the main one.
    const err = (trace as any)[`error_${valueKey}`];
    if (err?.array) {
      const plus = toArray(err.array);
      const minus = err.symmetric === false ? toArray(err.arrayminus) : plus;
      const errData = labels.map((l, j) => {
        const v = values[j] as number;
        if (typeof v !== "number") { return null; }
        const lo = v - (Number(minus[j]) || 0);
        const hi = v + (Number(plus[j]) || 0);
        return [toLabelCoord(l), lo, hi];
      }).filter(Boolean);
      series.push({
        type: "custom",
        name: names[i],
        silent: true,
        z: 10,
        data: errData,
        tooltip: { show: false },
        renderItem: (_params: any, api: any) => {
          const c = api.value(0);
          const lo = api.value(1);
          const hi = api.value(2);
          const p1 = horizontal ? api.coord([lo, c]) : api.coord([c, lo]);
          const p2 = horizontal ? api.coord([hi, c]) : api.coord([c, hi]);
          const cap = 5;
          const style = { stroke: colors.fg, lineWidth: 1.2, opacity: 0.7 };
          const lines = horizontal ? [
            [p1[0], p1[1], p2[0], p2[1]],
            [p1[0], p1[1] - cap, p1[0], p1[1] + cap],
            [p2[0], p2[1] - cap, p2[0], p2[1] + cap],
          ] : [
            [p1[0], p1[1], p2[0], p2[1]],
            [p1[0] - cap, p1[1], p1[0] + cap, p1[1]],
            [p2[0] - cap, p2[1], p2[0] + cap, p2[1]],
          ];
          return {
            type: "group",
            children: lines.map(([x1, y1, x2, y2]) => ({ type: "line", shape: { x1, y1, x2, y2 }, style })),
          };
        },
        encode: horizontal ? { x: [1, 2], y: 0 } : { x: 0, y: [1, 2] },
      });
    }
  });

  const { legend, reserve } = legendOption(names, colors, opts.legendPosition, ctx.compact);
  const labelTitle: string | undefined = (layout as any)[`${labelKey}axis`]?.title?.text;
  const valueTitle: string | undefined = (layout as any)[`${valueKey}axis`]?.title?.text;
  const xTitle = horizontal ? valueTitle : labelTitle;
  const yTitle = horizontal ? labelTitle : valueTitle;

  const axisLabelStyle = { color: colors.muted, fontSize: 11, hideOverlap: true };
  const axisNameStyle = { color: colors.muted, fontSize: 12, fontWeight: 500 };

  const labelAxis: any = {
    type: labelKind,
    data: labelKind === "category" ? categories : undefined,
    boundaryGap: labelKind === "category" ? (isBar ? true : false) : undefined,
    axisLine: { show: true, lineStyle: { color: colors.axis } },
    axisTick: { show: false },
    axisLabel: {
      ...axisLabelStyle,
      ...(labelKind === "value" ? { formatter: (v: number) => formatCompact(v) } : {}),
      ...(labelKind === "category" && !horizontal ? { interval: "auto", rotate: categories.length > 12 ? 35 : 0 } : {}),
      ...(horizontal ? { width: 140, overflow: "truncate" } : {}),
    },
    splitLine: { show: labelKind !== "category", lineStyle: { color: colors.grid } },
    scale: labelKind === "value" && !isBar,
  };
  if (isBar && labelKind === "value") {
    // Leave room for half a bar on each side.
    const xs = [...new Set(allLabels.filter((v): v is number => typeof v === "number"))].sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < xs.length; i++) { gap = Math.min(gap, xs[i] - xs[i - 1]); }
    if (!isFinite(gap) || gap <= 0) { gap = 1; }
    if (xs.length) {
      labelAxis.min = xs[0] - gap / 2;
      labelAxis.max = xs[xs.length - 1] + gap / 2;
      labelAxis.axisLabel.showMinLabel = false;
      labelAxis.axisLabel.showMaxLabel = false;
    }
  }
  if (labelKind === "time") {
    const times = series.flatMap(s => (s.data as any[]).map(d => (Array.isArray(d) ? d[horizontal ? 1 : 0] : null)))
      .filter((t): t is number => typeof t === "number");
    const withTime = hasTimePart(times);
    const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
    labelAxis.axisLabel.formatter = (t: number) => formatAxisDate(t, span, withTime);
    labelAxis.splitLine = { show: false };
  }
  const valueAxis: any = {
    type: opts.logYAxis ? "log" : "value",
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { ...axisLabelStyle, formatter: (v: number) => formatCompact(v) },
    splitLine: { show: true, lineStyle: { color: colors.grid } },
    // A scatter plot doesn't need to include zero.
    scale: chartType === "scatter" || chartType === "kaplan_meier" ? chartType === "scatter" : false,
  };
  if (labelKind === "category" && horizontal) {
    // First category on top.
    labelAxis.inverse = true;
  }
  if (chartType === "scatter") {
    // Both axes are values.
    labelAxis.scale = true;
  }
  const xAxis = horizontal ? valueAxis : labelAxis;
  const yAxis = horizontal ? labelAxis : valueAxis;
  if (opts.invertYAxis) { yAxis.inverse = !yAxis.inverse; }
  if (xTitle) {
    Object.assign(xAxis, { name: xTitle, nameLocation: "middle", nameGap: 0, nameTextStyle: axisNameStyle });
  }
  if (yTitle) {
    Object.assign(yAxis, { name: yTitle, nameLocation: "end", nameGap: 12,
      nameTextStyle: { ...axisNameStyle, align: "left", padding: [0, 0, 0, -8] } });
  }

  const tooltipTrigger = chartType === "scatter" ? "item" : "axis";
  const tooltip: any = {
    trigger: tooltipTrigger,
    axisPointer: {
      type: isBar ? "shadow" : "line",
      shadowStyle: { color: colors.dark ? "rgba(255,255,255,0.05)" : "rgba(38,38,51,0.05)" },
      lineStyle: { color: colors.axis, type: "solid" },
      label: { show: false },
    },
    formatter: (params: any) => {
      const list = (Array.isArray(params) ? params : [params]).filter((p: any) => p.seriesType !== "custom");
      if (!list.length) { return ""; }
      const first = list[0];
      let title: string;
      if (tooltipTrigger === "item") {
        const v = first.value;
        title = first.name || first.seriesName;
        return tooltipTitle(title) +
          tooltipRow(first.color, xTitle || "x", formatCompact(v[0])) +
          tooltipRow(first.color, first.seriesName, fmtValue(v[1], first.seriesName));
      }
      const axisVal = first.axisValue;
      title = labelKind === "time" ? formatDate(Number(axisVal), hasTimePart([Number(axisVal)])) :
        labelKind === "value" ? formatCompact(Number(axisVal)) : String(first.axisValueLabel ?? axisVal);
      const rows = list.map((p: any) => {
        const v = Array.isArray(p.value) ? p.value[horizontal ? 0 : 1] : p.value;
        const label = series[p.seriesIndex]?.meta;
        return tooltipRow(p.color, p.seriesName,
          v === null || v === undefined ? "–" : fmtValue(v, label));
      });
      return tooltipTitle(title) + rows.join("");
    },
  };

  return {
    legend,
    tooltip,
    grid: {
      left: 12,
      right: ((reserve as any).right || 0) + 20,
      top: ((reserve as any).top || 0) + (yTitle ? 34 : 18),
      bottom: ((reserve as any).bottom || 0) + (xTitle ? 36 : 10),
      containLabel: true,
    },
    xAxis: xTitle ? {
      ...xAxis, nameGap: horizontal ? 28 : (labelKind === "category" && categories.length > 12 ? 52 : 30),
    } : xAxis,
    yAxis,
    series,
  };
}

let _echarts: EChartsType | undefined;

export async function getECharts(): Promise<EChartsType> {
  return _echarts || (_echarts = await loadECharts());
}

/**
 * Owns an ECharts instance attached to a DOM element.
 */
export class EChartsHost {
  private _chart: ReturnType<EChartsType["init"]> | null = null;
  private _lastKey = "";

  constructor(private _elem: HTMLElement) {}

  public async render(option: any, structureKey: string) {
    const echarts = await getECharts();
    if (!this._chart || this._chart.isDisposed()) {
      this._chart = echarts.init(this._elem, null, { renderer: "svg" });
    }
    // When the kind of chart changes, start from a clean slate rather than morphing the old one.
    if (structureKey !== this._lastKey) {
      this._chart.clear();
      this._lastKey = structureKey;
    }
    this._chart.setOption(option, { notMerge: true });
  }

  /**
   * The type and range of the axes, as ECharts computed them. Exposed for tests, in Plotly's terms.
   */
  public getAxesInfo(): { [axis: string]: { type: string, range: any[] } } {
    const result: { [axis: string]: { type: string, range: any[] } } = {};
    const model = (this._chart as any)?.getModel?.();
    if (!model) { return result; }
    for (const dim of ["x", "y"]) {
      const axis = model.getComponent(`${dim}Axis`, 0)?.axis;
      if (!axis) { continue; }
      const type = ({ value: "linear", time: "date" } as any)[axis.type] || axis.type;
      let range: any[] = axis.scale.getExtent().slice();
      if (type === "log") {
        // Plotly expresses log ranges as powers of ten.
        range = range.map((v: number) => Math.log10(v));
      } else if (type === "date") {
        range = range.map((v: number) => {
          const d = new Date(v);
          const pad = (n: number) => String(n).padStart(2, "0");
          const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          return (d.getHours() || d.getMinutes()) ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
        });
      }
      if (axis.inverse) { range.reverse(); }
      result[dim] = { type, range };
    }
    return result;
  }

  public resize() {
    if (this._chart && !this._chart.isDisposed()) {
      const style = window.getComputedStyle(this._elem);
      if (style.display === "none") { return; }
      this._chart.resize();
    }
  }

  public clear() {
    this._chart?.clear();
  }

  public getDataURL(): string | undefined {
    return this._chart?.getDataURL({ pixelRatio: 2, backgroundColor: getChartColors().bg });
  }

  public dispose() {
    if (this._chart && !this._chart.isDisposed()) { this._chart.dispose(); }
    this._chart = null;
  }
}
