/*
 * The ONE dashboard layout model.
 *
 * `DashboardGrid` (runtime) and `DashboardLayoutCanvas` (builder drag/resize)
 * both read their geometry from here, so a position and size an administrator
 * drags in the Builder is exactly what the runtime renders. There is no second
 * layout representation anywhere in the dashboard code.
 */
export const DASHBOARD_COLUMNS = 12;

/* A 12-column responsive grid: four KPI cards across on desktop, wrapping to
   two and then one on tablet and phone. */
export const dashboardSpanClass = (width) => {
  const w = Math.min(DASHBOARD_COLUMNS, Math.max(1, Number(width) || 4));
  /* Phones: every component takes the full row (grid-cols-4 base → span 4).
     Without this, four KPI tiles squeeze into one 390px row and clip both
     their titles ("Total S…") and values ("£259.3…"). */
  return ({
    1: "col-span-4 sm:col-span-1",
    2: "col-span-4 sm:col-span-2",
    3: "col-span-4 sm:col-span-2 lg:col-span-3",
    4: "col-span-4 sm:col-span-2 lg:col-span-3",
    5: "col-span-4 sm:col-span-3 lg:col-span-4",
    6: "col-span-4 sm:col-span-3 lg:col-span-6",
    7: "col-span-4 sm:col-span-4 lg:col-span-7",
    8: "col-span-4 sm:col-span-4 lg:col-span-8",
    9: "col-span-4 sm:col-span-6 lg:col-span-9",
    10: "col-span-4 sm:col-span-6 lg:col-span-10",
    11: "col-span-4 sm:col-span-6 lg:col-span-11",
    12: "col-span-4 sm:col-span-6 lg:col-span-12",
  })[w];
};

export const dashboardHeightClass = (height) => {
  const h = Math.min(12, Math.max(1, Number(height) || 3));
  /* KPI row height: 104px clipped the metric value whenever a title wrapped;
     120px keeps the label + value pair intact without inflating the row. */
  if (h <= 1) return "min-h-[120px]";
  if (h <= 2) return "min-h-[150px]";
  if (h <= 4) return "min-h-[260px]";
  if (h <= 6) return "min-h-[340px]";
  return "min-h-[420px]";
};

export const clampWidth = (value) => Math.min(DASHBOARD_COLUMNS, Math.max(1, Number(value) || 1));
export const clampHeight = (value) => Math.min(12, Math.max(1, Number(value) || 1));

/*
 * Normalise a component list into a dense, ordered 12-column placement. Row and
 * column are recomputed from the stored order and widths so a saved definition
 * always reloads exactly as laid out, and components can never overlap.
 */
export function packLayout(components = []) {
  const placements = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  components.forEach((entry) => {
    /* Accepts a component ({ layout }) or a bare layout ({ w, h }); the server
       packer in services/dashboardBuilder.js takes bare layouts, so this keeps
       both sides on one signature. */
    const layout = entry && entry.layout !== undefined ? entry.layout : entry;
    const w = clampWidth(layout?.w);
    const h = clampHeight(layout?.h);
    if (x + w > DASHBOARD_COLUMNS) { x = 0; y += rowHeight; rowHeight = 0; }
    placements.push({ x, y, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  });
  return placements;
}

/* Re-emit a component list with its layout coordinates rewritten from the
   current order and widths. The builder calls this after a drag or resize so
   the persisted definition stays the single source of truth. */
export function applyLayout(components = []) {
  const placements = packLayout(components);
  return components.map((component, index) => ({ ...component, layout: placements[index] }));
}

export const layoutEquals = (a, b) =>
  a?.x === b?.x && a?.y === b?.y && a?.w === b?.w && a?.h === b?.h;

/*
 * The component vocabulary mirrored for the client. The server stays
 * authoritative; this exists so the runtime and the Builder render and label
 * the same components without importing server code into the browser bundle.
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

/*
 * The aggregation and condition vocabularies, mirrored from the reporting
 * engine so the Builder only ever offers combinations the server will accept:
 *   - services/reportableSources.js  (AGGREGATES, OPERATORS, numeric field types)
 *   - routes/reports.js              (CUSTOM_DATE_FILTERS, sales filter fields)
 * Nothing here is dashboard-specific logic — it is the existing reporting
 * vocabulary, surfaced so the Builder can build the same conditions the
 * reporting engine already validates and executes.
 */
export const AGGREGATES = Object.freeze(["COUNT", "SUM", "AVG", "MIN", "MAX"]);
export const AGGREGATABLE_FIELD_TYPES = Object.freeze(["number", "decimal", "currency", "date", "datetime", "formula", "rollup"]);
export const SUMMARY_COLUMN = (aggregate, field) => `${String(aggregate).toLowerCase()}_${field}`;

export const DATE_FILTER_FIELDS = Object.freeze([
  { key: "date", label: "Date", kind: "date" },
  { key: "store", label: "Store", kind: "id" },
  { key: "user", label: "Operator", kind: "id" },
  { key: "product", label: "Product", kind: "id" },
]);

/* Field-type driven operator lists — the same rules the Custom Report builder
   already uses, so a condition authored here executes unchanged there. */
export function operatorsForFieldType(type) {
  const kind = String(type || "text").toLowerCase();
  if (["number", "decimal", "currency"].includes(kind)) {
    return [["equals", "Equals"], ["not_equals", "Not equals"], ["gt", "Greater than"], ["gte", "Greater / equal"], ["lt", "Less than"], ["lte", "Less / equal"], ["between", "Between"]];
  }
  if (["date", "datetime"].includes(kind)) {
    return [["equals", "Equals"], ["gt", "After"], ["lt", "Before"], ["between", "Between"]];
  }
  if (kind === "boolean") return [["equals", "True / false"]];
  return [["equals", "Equals"], ["contains", "Contains"], ["starts_with", "Starts with"], ["is_blank", "Is empty"], ["is_not_blank", "Is not empty"], ["in", "Is any of"]];
}

export function aggregatesForFieldType(type) {
  const kind = String(type || "text").toLowerCase();
  return AGGREGATES.filter((aggregate) => aggregate === "COUNT" || AGGREGATABLE_FIELD_TYPES.includes(kind));
}

export const isAggregatable = (type) => aggregatesForFieldType(type).filter((aggregate) => aggregate !== "COUNT").length > 0;

/* Platform Object field metadata -> the eligible metric and grouping choices
   for a component bound to that Object. */
export function platformFieldChoices(fields = []) {
  const usable = (fields || []).filter((field) => field && (field.api_name || field.key) && field.active !== false && field.readable !== false);
  /* Every list is normalised to { key, label, type } so the picker, the
     condition editor and the aggregate rules all read the same shape. */
  const normalize = (field) => ({ key: field.api_name || field.key, label: field.label || field.api_name || field.key, type: field.field_type || field.type, field });
  const all = usable.map(normalize);
  return {
    metricFields: all.filter((field) => isAggregatable(field.type)),
    groupFields: all,
    all,
  };
}

