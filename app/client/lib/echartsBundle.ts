/**
 * ECharts, trimmed down to the pieces Grist's charts use. Loaded lazily (see loadECharts() in
 * imports.js) so that documents without charts don't pay for it.
 */
import {
  BarChart, CustomChart, FunnelChart, LineChart, PieChart, ScatterChart, TreemapChart,
} from "echarts/charts";
import {
  DatasetComponent, GraphicComponent, GridComponent, LegendComponent, MarkLineComponent,
  TitleComponent, TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart, LineChart, PieChart, ScatterChart, FunnelChart, TreemapChart, CustomChart,
  GridComponent, TooltipComponent, LegendComponent, TitleComponent, GraphicComponent,
  DatasetComponent, MarkLineComponent,
  LabelLayout, UniversalTransition, SVGRenderer,
]);

export { echarts };
