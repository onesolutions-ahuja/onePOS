/* Dashboard definitions are deliberately data-only. Reports remain the sole
 * SQL/query engine; this module only validates the dashboard composition. */
export const COMPONENT_TYPES = Object.freeze(["kpi", "chart", "pie", "donut", "bar", "table", "text"]);
export const CHART_TYPES = Object.freeze(["bar", "line", "pie", "donut"]);
export const KPI_SIZES = Object.freeze(["small", "medium", "large"]);
export const VALUE_FORMATS = Object.freeze(["number", "currency", "percent"]);
export const DATE_RANGES = Object.freeze([
  "today", "yesterday", "this_week", "last_7_days", "this_month", "this_quarter", "fiscal_year",
]);
export const FILTER_FIELDS = Object.freeze(["store", "date"]);

/*
 * The canonical dashboard component vocabulary. Every entry is GENERIC: it
 * describes a rendering shape plus the configuration an administrator supplies
 * (a saved report or an inline report definition reusing the existing custom
 * report engine). No Sales-, Product- or payment-specific component exists.
 */
export const DASHBOARD_COMPONENTS = Object.freeze([
  { key: "kpi", label: "Metric / KPI", kind: "metric", valueField: true, labelField: true, formats: VALUE_FORMATS, sizes: KPI_SIZES },
  { key: "pie", label: "Pie Chart", kind: "chart", categoryField: true, valueField: true, maxCategories: true },
  { key: "donut", label: "Donut Chart", kind: "chart", categoryField: true, valueField: true, maxCategories: true },
  { key: "bar", label: "Bar Chart", kind: "chart", categoryField: true, valueField: true, sort: true, limit: true },
  { key: "table", label: "Table / List", kind: "record" },
  { key: "text", label: "Text", kind: "content" },
]);
const DASHBOARD_COMPONENT_MAP = new Map(DASHBOARD_COMPONENTS.map((component) => [component.key, component]));

export function getDashboardComponent(key) {
  return DASHBOARD_COMPONENT_MAP.get(String(key || "")) || null;
}

export function validateDashboardDefinition(input = {}) {
  const name = String(input.name || "").trim();
  if (!name || name.length > 150) throw new Error("A dashboard name up to 150 characters is required");
  const components = Array.isArray(input.components) ? input.components.slice(0, 50) : [];
  const normalized = components.map((component, index) => {
    const type = String(component?.type || "");
    if (!COMPONENT_TYPES.includes(type)) throw new Error(`Invalid dashboard component at position ${index + 1}`);
    const config = component?.config && typeof component.config === "object" ? component.config : {};
    if (type !== "text" && !config.reportId && !config.report) throw new Error(`Component ${index + 1} must reference a report`);
    if (config.report && config.report.dataSource && !["sales", "platform_object"].includes(String(config.report.dataSource))) {
      throw new Error(`Component ${index + 1} uses an unsupported data source`);
    }
    if (config.report) {
      if (config.report.dataSource && !["sales", "platform_object"].includes(String(config.report.dataSource))) throw new Error(`Component ${index + 1} has an unsupported data source`);
      if (!Array.isArray(config.report.fields) || !config.report.fields.length) throw new Error(`Component ${index + 1} must select at least one field`);
    }
    return {
      id: String(component.id || crypto.randomUUID()),
      type,
      title: String(component.title || "").slice(0, 150),
      config: {
        reportId: config.reportId ? String(config.reportId) : null,
        /* An inline report definition lets an administrator fully configure a
           component from Dashboard Builder using the SAME custom-report
           vocabulary the Custom Report builder produces. Execution still goes
           through the one reporting engine (routes/dashboardBuilder.js). */
        report: config.report && typeof config.report === "object" ? {
          dataSource: ["sales", "platform_object"].includes(config.report.dataSource) ? config.report.dataSource : "sales",
          objectId: config.report.objectId ? String(config.report.objectId) : null,
          fields: [...new Set((Array.isArray(config.report.fields) ? config.report.fields : []).map(String))],
          groupBy: [...new Set((Array.isArray(config.report.groupBy) ? config.report.groupBy : []).map(String))],
          sort: Array.isArray(config.report.sort) ? config.report.sort : [],
          filters: Array.isArray(config.report.filters) ? config.report.filters.slice(0, 10) : [],
          filterLogic: ["all", "any"].includes(String(config.report.filterLogic)) ? config.report.filterLogic : "all",
        } : null,
        valueField: config.valueField ? String(config.valueField) : null,
        labelField: config.labelField ? String(config.labelField) : null,
        chartType: CHART_TYPES.includes(config.chartType) ? config.chartType : null,
        format: VALUE_FORMATS.includes(config.format) ? config.format : "number",
        size: KPI_SIZES.includes(config.size) ? config.size : "medium",
        maxCategories: Math.min(25, Math.max(2, Number(config.maxCategories) || 6)),
        limit: Math.min(200, Math.max(1, Number(config.limit) || 12)),
        sort: Array.isArray(config.sort) ? config.sort.slice(0, 3).map((item) => ({ field: String(item?.field || ""), direction: item?.direction === "asc" ? "asc" : "desc" })) : null,
        dateRange: DATE_RANGES.includes(config.dateRange) ? config.dateRange : null,
        content: type === "text" ? String(config.content || "").slice(0, 5000) : null,
      },
      layout: {
        x: Math.max(0, Number(component.layout?.x) || 0),
        y: Math.max(0, Number(component.layout?.y) || 0),
        w: Math.min(12, Math.max(1, Number(component.layout?.w) || 4)),
        h: Math.min(12, Math.max(1, Number(component.layout?.h) || 3)),
      },
    };
  });
  const filters = Array.isArray(input.filters) ? input.filters.slice(0, 10).map((filter) => {
    const field = String(filter?.field || "");
    if (!FILTER_FIELDS.includes(field)) throw new Error("Invalid dashboard filter");
    return { field, operator: String(filter.operator || "equals"), value: String(filter.value || "").slice(0, 100) };
  }) : [];
  return { name, description: String(input.description || "").slice(0, 500), components: normalized, filters };
}

/*
 * The shipped default Dashboard. It is a DASHBOARD DEFINITION, not Dashboard
 * page markup: every entry is a generic component (kpi / pie / donut / bar)
 * bound to a saved report by id. The same rows are editable, reorderable and
 * removable in Dashboard Builder, and the Dashboard page renders whatever the
 * saved definition says. Changing a component's reportId, metric, grouping or
 * date range changes the rendered dashboard without touching React source.
 */
const salesDatasource = { dataSource: "sales", fields: [], groupBy: [], sort: [], filters: [], filterLogic: "all" };

export const DEFAULT_DASHBOARD_DEFINITION = Object.freeze({
  name: "Business Overview",
  description: "Default configurable dashboard: KPIs and visualisations bound to saved reports.",
  filters: [],
  components: [
    { id: "default-kpi-total-sales", type: "kpi", title: "Total Sales", config: { reportId: "report_total_sales", valueField: "net_sales", format: "currency", size: "medium", dateRange: "fiscal_year", report: { ...salesDatasource, fields: ["net_sales"] } }, layout: { x: 0, y: 0, w: 3, h: 1 } },
    { id: "default-kpi-quarter-sales", type: "kpi", title: "Quarter Sales", config: { reportId: "report_quarter_sales", valueField: "net_sales", format: "currency", size: "medium", dateRange: "this_quarter", report: { ...salesDatasource, fields: ["net_sales"] } }, layout: { x: 3, y: 0, w: 3, h: 1 } },
    { id: "default-kpi-annual-sales", type: "kpi", title: "Annual Sales", config: { reportId: "report_annual_sales", valueField: "net_sales", format: "currency", size: "medium", dateRange: "last_7_days", report: { ...salesDatasource, fields: ["net_sales"] } }, layout: { x: 6, y: 0, w: 3, h: 1 } },
    { id: "default-kpi-top-product", type: "kpi", title: "Most Selling Product", config: { reportId: "report_top_product", valueField: "quantity", labelField: "product", format: "number", size: "medium", dateRange: "fiscal_year", report: { ...salesDatasource, fields: ["product", "quantity"], groupBy: ["product"], sort: [{ field: "quantity", direction: "desc" }] } }, layout: { x: 9, y: 0, w: 3, h: 1 } },
    { id: "default-pie-category", type: "pie", title: "Sales by Category", config: { reportId: "report_sales_by_category", valueField: "net_sales", labelField: "category", maxCategories: 6, dateRange: "fiscal_year", report: { ...salesDatasource, fields: ["category", "net_sales"], groupBy: ["category"], sort: [{ field: "net_sales", direction: "desc" }] } }, layout: { x: 0, y: 1, w: 6, h: 4 } },
    { id: "default-donut-payment", type: "donut", title: "Payment Method Mix", config: { reportId: "report_payment_mix", valueField: "total", labelField: "method", maxCategories: 6, dateRange: "fiscal_year", report: { ...salesDatasource, fields: ["method", "total"], groupBy: ["method"], sort: [{ field: "total", direction: "desc" }] } }, layout: { x: 6, y: 1, w: 6, h: 4 } },
    { id: "default-bar-period", type: "bar", title: "Sales by Period", config: { reportId: "report_sales_by_period", valueField: "net_sales", labelField: "date", limit: 12, dateRange: "last_7_days", report: { ...salesDatasource, fields: ["date", "net_sales"], groupBy: ["date"], sort: [{ field: "date", direction: "asc" }] } }, layout: { x: 0, y: 5, w: 12, h: 4 } },
  ],
});

/* The custom-report fields a Dashboard Builder administrator may pick from for
   the built-in sales datasource. Reuses the reporting engine's field list. */
export const DASHBOARD_SALES_FIELDS = Object.freeze([
  { key: "date", label: "Date", groupable: true },
  { key: "store", label: "Store", groupable: true },
  { key: "user", label: "Operator", groupable: true },
  { key: "product", label: "Product", groupable: true },
  { key: "sku", label: "SKU", groupable: true },
  { key: "category", label: "Category", groupable: true },
  { key: "method", label: "Payment method", groupable: true },
  { key: "quantity", label: "Quantity sold", aggregate: true },
  { key: "gross_sales", label: "Gross sales", aggregate: true },
  { key: "net_sales", label: "Net sales", aggregate: true },
  { key: "vat", label: "VAT", aggregate: true },
  { key: "discount", label: "Discounts", aggregate: true },
  { key: "transactions", label: "Transactions", aggregate: true },
]);

export function mergeDashboardFilters(reportDefinition, dashboardFilters = []) {
  const filters = Array.isArray(reportDefinition?.filters) ? [...reportDefinition.filters] : [];
  for (const filter of dashboardFilters) {
    if (filter.field === "date") filters.push({ field: "date", operator: filter.value || "this_week" });
    if (filter.field === "store" && filter.value) filters.push({ field: "store", operator: "equals", value: filter.value });
  }
  return { ...reportDefinition, filters };
}
