import * as gu from "test/nbrowser/gristUtils";

import isString from "lodash/isString";
import isUndefined from "lodash/isUndefined";
import { assert, driver, WebElement } from "mocha-webdriver";
import { Layout, LayoutAxis, PlotData } from "plotly.js";

export interface ChartData {
  data: Partial<PlotData>[];
  layout: Layout;
}

// Chart types are picked from a grid of tiles. Tests name them as they used to be named in the
// old dropdown, so map those names to the tiles.
const CHART_TYPE_TILES: { [name: string]: string } = {
  "Bar chart": "column",
  "Horizontal bar chart": "hbar",
  "Pie chart": "pie",
  "Donut chart": "donut",
  "Area chart": "area",
  "Line chart": "line",
  "Scatter plot": "scatter",
  "Kaplan-Meier plot": "kaplan_meier",
  "Funnel chart": "funnel",
  "Treemap": "treemap",
};

export async function selectChartType(chartType: string) {
  const tile = CHART_TYPE_TILES[chartType];
  if (!tile) { throw new Error(`Unknown chart type ${chartType}`); }
  await driver.findWait(`.test-chart-type-${tile}`, 1000).click();
  return gu.waitForServer();
}

// Returns the selected chart type, named as in selectChartType().
export async function getSelectedChartType(): Promise<string> {
  const selected = await driver.findWait(".test-chart-type-tile[aria-checked=true]", 1000);
  const classes = (await selected.getAttribute("class")).split(/\s+/);
  const entry = Object.entries(CHART_TYPE_TILES).find(([, tile]) => classes.includes(`test-chart-type-${tile}`));
  return entry ? entry[0] : "";
}

export async function getChartData(chartElem?: WebElement | string): Promise<ChartData> {
  if (isString(chartElem) || isUndefined(chartElem)) {
    const section = isString(chartElem) ?
      await gu.getSection(chartElem) :
      await driver.findWait(".active_section", 4000);
    chartElem = await section.findWait(".test-chart-container", 5_000);
    await driver.wait(() => driver.executeScript((el: any) => Boolean(el.data), chartElem), 5_000);
  }
  return driver.executeScript((el: any) => ({ data: el.data, layout: el.layout }), chartElem);
}

// Less common options are in a collapsed "Advanced options" part of the panel.
export async function openAdvancedOptions() {
  if (!await driver.findContent("label", /Invert Y-axis/).isPresent()) {
    await driver.findWait(".test-chart-advanced", 1000).click();
  }
}

export function checkAxisRange({ layout }: ChartData, xMin: number, xMax: number, yMin: number, yMax: number) {
  // Axis ranges are as computed by the chart library, which rounds them to "nice" values: compare
  // with a tolerance relative to the size of the range.
  const actual = [layout.xaxis.range![0], layout.xaxis.range![1], layout.yaxis.range![0], layout.yaxis.range![1]];
  const expected = [xMin, xMax, yMin, yMax];
  const tol = (a: number, b: number) => Math.abs(b - a) * 0.1;
  const message = `axis ranges ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;
  assert.closeTo(actual[0], xMin, tol(xMin, xMax), message);
  assert.closeTo(actual[1], xMax, tol(xMin, xMax), message);
  assert.closeTo(actual[2], yMin, tol(yMin, yMax), message);
  assert.closeTo(actual[3], yMax, tol(yMin, yMax), message);
}

export function getAxisTitle(axis: Partial<LayoutAxis>): string | undefined {
  return axis.title && (axis.title as any).text;
}

export function findYAxis(name: string) {
  return driver.findContent(".test-chart-y-axis", name);
}

export async function removeYAxis(name: string) {
  await findYAxis(name).mouseMove().find(".test-chart-ref-select-remove").click();
  await gu.waitForServer();
}

export async function checkAxisConfig(expected: { groupingByColumn?: string | false,
  xaxis: string | undefined, yaxis: string[] }) {
  const isGroupByPresent = await driver.find(".test-chart-group-by-column").isPresent();
  let groupingByColumn = isGroupByPresent ? await driver.find(".test-chart-group-by-column").getText() : false;
  if (groupingByColumn === "Pick a column") {
    groupingByColumn = false;
  }
  const xaxis = await driver.find(".test-chart-x-axis").getText();
  assert.deepEqual({
    groupingByColumn,
    xaxis: xaxis === "Pick a column" ? undefined : xaxis,
    yaxis: await driver.findAll(".test-chart-y-axis", e => e.getText()),
  }, { ...expected, groupingByColumn: expected.groupingByColumn || false });
}

export async function setSplitSeries(name: string | false, section?: string) {
  await gu.openSectionMenu("viewLayout", section);
  await gu.findOpenMenuItem("li", "Widget options").click();

  const isChecked = await driver.findContent("label", /Split series/).find("input").matches(":checked");
  if (name === false && isChecked === true ||
    name && isChecked === false) {
    await driver.findContent("label", /Split series/).click();
  }
  if (name) {
    await driver.find(".test-chart-group-by-column").click();
    await gu.findOpenMenuItem("li", name || "Pick a column").click();
  }
  await gu.waitForServer();
}

export async function selectXAxis(name: string, opt: { noWait?: boolean } = {}) {
  await driver.find(".test-chart-x-axis").click();
  await gu.findOpenMenuItem("li", name).click();
  if (!opt.noWait) {
    await gu.waitForServer();
  }
}

export async function setYAxis(names: string[]) {
  // let's first remove all yaxis and then add new ones
  const toRemove = await driver.findAll(".test-chart-y-axis", e => e.getText());
  for (const n of toRemove) { await removeYAxis(n); }
  for (const n of names) { await addYAxis(n); }
}

export async function addYAxis(name: string) {
  await driver.find(".test-chart-add-y-axis").click();
  await gu.findOpenMenuItem("li", name).click();
  await gu.waitForServer();
}
