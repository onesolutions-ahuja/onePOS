/*
 * Dashboard component architecture tests.
 *
 * These lock the rule that makes the Dashboard configuration-driven: the
 * runtime renders whatever the definition says, so re-pointing a component at a
 * different datasource / metric / grouping / date range changes the dashboard
 * without any React change.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CHART_TYPES,
  DASHBOARD_COMPONENTS,
  DATE_RANGES,
  DEFAULT_DASHBOARD_DEFINITION,
  VALUE_FORMATS,
  getDashboardComponent,
  validateDashboardDefinition,
} from "../services/dashboardBuilder.js";
import { PLATFORM_COMPONENTS, getPlatformComponent, validateComponentRegistry } from "../services/platformComponentRegistry.js";
import { buildCustomSalesQuery, validateCustomReportDefinition } from "../routes/reports.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const DASHBOARD_PAGE = read("../src/pages/dashboard/Dashboard.jsx");
const BUILDER_PAGE = read("../src/pages/dashboard/DashboardBuilder.jsx");
const GRID = read("../src/components/dashboard/DashboardGrid.jsx");
const RENDERERS = read("../src/components/dashboard/DashboardComponents.jsx");
const ROUTER = read("../routes/dashboardBuilder.js");

test("the default dashboard ships 4 KPIs and 3 visualisations as metadata", () => {
  const value = validateDashboardDefinition(structuredClone(DEFAULT_DASHBOARD_DEFINITION));
  const kpis = value.components.filter((component) => component.type === "kpi");
  const charts = value.components.filter((component) => ["pie", "donut", "bar"].includes(component.type));
  assert.equal(kpis.length, 4, "four configurable KPI components");
  assert.equal(charts.length, 3, "three configurable visualisations");
  assert.deepEqual(kpis.map((k) => k.title), ["Total Sales", "Quarter Sales", "Annual Sales", "Most Selling Product"]);
  assert.deepEqual(charts.map((c) => c.type).sort(), ["bar", "donut", "pie"]);
  for (const kpi of kpis) {
    assert.ok(kpi.config.report, "every default KPI carries a report definition");
    assert.ok(kpi.config.valueField, "every default KPI names a metric");
    assert.ok(kpi.config.dateRange, "every default KPI names a date range");
  }
});

test("dashboard components are generic and Sales-agnostic", () => {
  const keys = DASHBOARD_COMPONENTS.map((component) => component.key);
  assert.deepEqual(keys, ["kpi", "pie", "donut", "bar", "table", "text"]);
  for (const key of keys) {
    const keyText = key.toLowerCase();
    for (const forbidden of ["sale", "product", "payment", "category", "customer"]) {
      assert.ok(!keyText.includes(forbidden), `${key} must not be domain-specific`);
    }
  }
  assert.equal(getDashboardComponent("kpi").kind, "metric");
  assert.equal(getDashboardComponent("donut").kind, "chart");
  assert.equal(getDashboardComponent("nope"), null);
});

test("the single platform Component Registry exposes the dashboard components", () => {
  const validation = validateComponentRegistry();
  assert.equal(validation.valid, true, "one registry, no duplicate keys");
  for (const key of ["kpi", "pie_chart", "donut_chart", "bar_chart", "dashboard_text"]) {
    const component = getPlatformComponent(key);
    assert.ok(component, `${key} must be registered`);
    assert.equal(component.category, "dashboard");
    assert.equal(component.dashboard, true);
  }
  assert.ok(getPlatformComponent("kpi").configurable.includes("aggregation"));
  assert.ok(getPlatformComponent("bar_chart").configurable.includes("dateRange"));

test("component configuration is validated, clamped and typed", () => {
  const value = validateDashboardDefinition({
    name: "Config",
    components: [
      { type: "donut", title: "Mix", config: { report: { dataSource: "sales", fields: ["net_sales"], groupBy: ["method"] }, valueField: "net_sales", labelField: "method", format: "currency", maxCategories: 999, dateRange: "this_quarter" }, layout: { w: 6, h: 4 } },
      { type: "bar", title: "Period", config: { report: { dataSource: "sales", fields: ["date", "net_sales"] }, valueField: "net_sales", labelField: "date", chartType: "bogus", format: "nope", limit: 9999, dateRange: "not-a-range" } },
    ],
  });
  const [donut, bar] = value.components;
  assert.equal(donut.config.maxCategories, 25, "clamped to the allowed range");
  assert.equal(bar.config.chartType, null, "an unknown chart type is rejected, not trusted");
  assert.equal(bar.config.format, "number");
  assert.equal(bar.config.limit, 200);
  assert.equal(bar.config.dateRange, null);
  assert.equal(donut.config.dateRange, "this_quarter");
});

test("a component without a valid datasource is rejected", () => {
  assert.throws(() => validateDashboardDefinition({ name: "Broken", components: [{ type: "pie", config: {} }] }), /must reference a report/);
  assert.throws(() => validateDashboardDefinition({ name: "Broken", components: [{ type: "bar", config: { report: { dataSource: "raw_sql" } } }] }), /data source/);
  assert.throws(() => validateDashboardDefinition({ name: "Broken", components: [{ type: "bar", config: { report: { fields: [] } } }] }), /at least one field/);
});

test("datasource security: an inline report is validated by the one reporting engine", () => {
  const definition = validateCustomReportDefinition({ dataSource: "sales", fields: ["category", "net_sales"], groupBy: ["category"] });
  assert.equal(definition.dataSource, "sales");
  assert.deepEqual(definition.groupBy, ["category"]);
  assert.throws(() => validateCustomReportDefinition({ dataSource: "sales", fields: ["drop_table"] }), /valid report field/);
  assert.throws(() => validateCustomReportDefinition({ dataSource: "sales", fields: ["net_sales"], groupBy: ["net_sales"] }), /Invalid grouping field/);
  const built = buildCustomSalesQuery(definition, { from: "2026-01-01", to: "2026-12-31" }, [], []);
  assert.match(built.sql, /s\.company_id = \$3/);
  assert.match(built.sql, /s\.status = 'completed'/);
  assert.equal(built.params.length, 3, "company id is supplied by the caller, never by the client");
});

test("aggregation + grouping come from configuration, not from the component", () => {
  const byCategory = buildCustomSalesQuery({ dataSource: "sales", fields: ["category", "net_sales"], groupBy: ["category"], sort: [{ field: "net_sales", direction: "desc" }], filters: [], filterLogic: "all" }, { from: null, to: null }, [], []);
  const byDate = buildCustomSalesQuery({ dataSource: "sales", fields: ["date", "quantity"], groupBy: ["date"], sort: [{ field: "date", direction: "asc" }], filters: [], filterLogic: "all" }, { from: null, to: null }, [], []);
  assert.match(byCategory.sql, /GROUP BY COALESCE\(pc\.name, 'Uncategorised'\)/);
  assert.match(byCategory.sql, /"net_sales" DESC/);
  assert.match(byDate.sql, /GROUP BY \(s\.created_at AT TIME ZONE c\.timezone\)::date/);
  assert.match(byDate.sql, /"date" ASC/);
  assert.match(byDate.sql, /COALESCE\(SUM\(si\.quantity\), 0\) AS "quantity"/);
});

test("date-range configuration is a whitelist applied by the router", () => {
  assert.ok(DATE_RANGES.includes("this_quarter"));
  assert.equal(DATE_RANGES.includes("last_7_days; DROP TABLE sales"), false);
  assert.match(ROUTER, /DATE_RANGES\.includes\(config\.dateRange\)/);
  assert.match(ROUTER, /\{ field: "date", operator: config\.dateRange \}/);
});

test("the saved and unsaved dashboards share ONE execution path", () => {
  assert.match(ROUTER, /async function runComponent\(req, component, dashboardFilters\)/);

test("the Dashboard page renders metadata; it never names a widget", () => {
  assert.match(DASHBOARD_PAGE, /apiRequest\("\/api\/dashboards\/default"\)/);
  assert.match(DASHBOARD_PAGE, /apiRequest\("\/api\/dashboards\/run"/);
  assert.match(DASHBOARD_PAGE, /<DashboardGrid/);
  for (const forbidden of ["Total Sales", "Sales by Category", "Payment Method Mix", "Most Selling Product", "salesOverview"]) {
    assert.ok(!DASHBOARD_PAGE.includes(forbidden), `Dashboard page must not hard-code "${forbidden}"`);
  }
});

test("the runtime is generic: one renderer, driven by configuration", () => {
  assert.match(GRID, /renderDashboardComponent\(component, result, state\)/);
  assert.match(RENDERERS, /export function renderDashboardComponent/);
  assert.match(RENDERERS, /config\?\.valueField/);
  assert.match(RENDERERS, /config\?\.labelField/);
  assert.match(RENDERERS, /function State\(\{ state, children \}\)/);
  assert.match(RENDERERS, /No data/);
  assert.match(RENDERERS, /could not be loaded/);
  assert.match(RENDERERS, /animate-pulse/);
});

test("responsive behaviour is one grid, not one implementation per device", () => {
  assert.match(GRID, /grid-cols-4/);
  assert.match(GRID, /col-span-4 sm:col-span-6 lg:col-span-12/, "full-width components stack on small screens");
  assert.match(GRID, /col-span-1 sm:col-span-2 lg:col-span-3/, "KPI cards wrap from 4 across to 1");
  assert.match(GRID, /min-w-0/, "no horizontal page overflow");
});

test("the Builder configures the same components the runtime renders", () => {
  assert.match(BUILDER_PAGE, /DASHBOARD_COMPONENTS\.map/);
  assert.match(BUILDER_PAGE, /<DashboardGrid/);
  assert.match(BUILDER_PAGE, /\/api\/dashboards\/run/);
  for (const control of ["Data source", "Metric field", "Category / group field", "Date range", "Format", "Size", "Maximum categories", "Width", "Height"]) {
    assert.ok(BUILDER_PAGE.includes(control), `Builder must expose "${control}"`);
  }
  assert.match(BUILDER_PAGE, /moveComponent/);
  assert.match(BUILDER_PAGE, /removeComponent/);
});

test("format and chart vocabularies stay bounded", () => {
  assert.deepEqual([...VALUE_FORMATS], ["number", "currency", "percent"]);
  assert.deepEqual([...CHART_TYPES], ["bar", "line", "pie", "donut"]);
});

  assert.match(ROUTER, /runComponent\(req, component, definition\.filters \|\| \[\]\)/);
  assert.equal((ROUTER.match(/buildCustomSalesQuery\(/g) || []).length, 1, "exactly one query build call in the router");
  assert.match(ROUTER, /validateCustomReportDefinition\(config\.report\)/, "inline reports go through the reporting validator");
});

  assert.equal(PLATFORM_COMPONENTS.filter((c) => /sales_by|payment_donut/i.test(c.key)).length, 0);
});
