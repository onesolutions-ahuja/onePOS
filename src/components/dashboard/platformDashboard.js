/*
 * Client-side mirror of the canonical dashboard component vocabulary declared
 * in services/dashboardBuilder.js. The server remains authoritative; this file
 * only lets the runtime and the Builder render/label the same components
 * without importing server code into the browser bundle.
 */
export const DASHBOARD_COMPONENTS = Object.freeze([
  { key: "kpi", label: "Metric / KPI", kind: "metric" },
  { key: "pie", label: "Pie Chart", kind: "chart" },
  { key: "donut", label: "Donut Chart", kind: "chart" },
  { key: "bar", label: "Bar Chart", kind: "chart" },
  { key: "table", label: "Table / List", kind: "record" },
  { key: "text", label: "Text", kind: "content" },
]);

export const DASHBOARD_DATE_RANGES = Object.freeze([
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_7_days", label: "Last 7 days" },
  { key: "this_month", label: "This month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "fiscal_year", label: "Fiscal year" },
]);

export const DASHBOARD_SALES_FIELDS = Object.freeze([
  { key: "date", label: "Date", groupable: true },
  { key: "store", label: "Store", groupable: true },
  { key: "user", label: "Operator", groupable: true },
  { key: "product", label: "Product", groupable: true },
  { key: "category", label: "Category", groupable: true },
  { key: "method", label: "Payment method", groupable: true },
  { key: "sku", label: "SKU", groupable: true },
  { key: "quantity", label: "Quantity sold", aggregate: true },
  { key: "gross_sales", label: "Gross sales", aggregate: true },
  { key: "net_sales", label: "Net sales", aggregate: true },
  { key: "total", label: "Total", aggregate: true },
  { key: "vat", label: "VAT", aggregate: true },
  { key: "discount", label: "Discounts", aggregate: true },
  { key: "transactions", label: "Transactions", aggregate: true },
]);

export function getDashboardComponentSpec(key) {
  return DASHBOARD_COMPONENTS.find((component) => component.key === String(key || "")) || null;
}
