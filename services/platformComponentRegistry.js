/**
 * Canonical metadata-driven UI component registry.
 * Forms, record pages and custom pages must use these keys rather than
 * inventing page-specific control vocabularies.
 */
export const PLATFORM_COMPONENTS = Object.freeze([
  { key: "section", label: "Section", category: "layout", kind: "layout", bindable: false },
  // Custom Page Builder layout components. `multi_container` is record-bound:
  // it renders a Record Collection through the shared page renderer and never
  // embeds its own query logic (collection → existing Platform record APIs).
  { key: "container", label: "Container", category: "layout", kind: "layout", bindable: false, containsChildren: true },
  { key: "multi_container", label: "MultiContainer", category: "record", kind: "record", bindable: true, recordBound: true, containsChildren: false },
  { key: "table", label: "Table / List", category: "record", kind: "record", bindable: true, recordBound: true, containsChildren: false },
  { key: "header", label: "Header", category: "content", kind: "content", bindable: false },
  { key: "text", label: "Information Text", category: "content", kind: "content", bindable: false },
  { key: "divider", label: "Divider", category: "layout", kind: "layout", bindable: false },
  { key: "spacer", label: "Spacer", category: "layout", kind: "layout", bindable: false },
  { key: "text_input", label: "Text Box", category: "field", kind: "field", bindable: true, fieldTypes: ["text", "email", "phone"] },
  { key: "long_text", label: "Long Text", category: "field", kind: "field", bindable: true, fieldTypes: ["long_text", "textarea"] },
  { key: "number", label: "Number", category: "field", kind: "field", bindable: true, fieldTypes: ["number"] },
  { key: "currency", label: "Currency / Decimal", category: "field", kind: "field", bindable: true, fieldTypes: ["decimal", "currency"] },
  { key: "date", label: "Date", category: "field", kind: "field", bindable: true, fieldTypes: ["date"] },
  { key: "datetime", label: "Date & Time", category: "field", kind: "field", bindable: true, fieldTypes: ["datetime"] },
  { key: "checkbox", label: "Checkbox", category: "field", kind: "field", bindable: true, fieldTypes: ["boolean"] },
  { key: "picklist", label: "Picklist / Dropdown", category: "field", kind: "field", bindable: true, fieldTypes: ["select", "picklist", "multi_select"] },
  { key: "lookup", label: "Lookup", category: "field", kind: "field", bindable: true, fieldTypes: ["lookup"] },
  { key: "related_list", label: "Related List / Table", category: "record", kind: "record", bindable: true, relationship: true },
  { key: "field_value", label: "Field Value", category: "record", kind: "record", bindable: true, displayOnly: true },
  // Dashboard Builder / runtime components. Every entry is GENERIC: a rendering
  // shape plus the configuration an administrator supplies (datasource, metric,
  // grouping, date range). None of them is Sales- or Product-specific, and all
  // of them are driven entirely by saved dashboard metadata.
  { key: "kpi", label: "Metric / KPI", category: "dashboard", kind: "metric", bindable: false, dashboard: true, configurable: ["dataSource", "metric", "aggregation", "filters", "dateRange", "format", "size"] },
  { key: "pie_chart", label: "Pie Chart", category: "dashboard", kind: "chart", bindable: false, dashboard: true, configurable: ["dataSource", "categoryField", "metric", "aggregation", "conditions", "dateRange", "maxCategories"] },
  { key: "donut_chart", label: "Donut Chart", category: "dashboard", kind: "chart", bindable: false, dashboard: true, configurable: ["dataSource", "categoryField", "metric", "aggregation", "conditions", "dateRange", "maxCategories"] },
  { key: "bar_chart", label: "Bar Chart", category: "dashboard", kind: "chart", bindable: false, dashboard: true, configurable: ["dataSource", "categoryField", "metric", "aggregation", "filters", "sort", "limit", "dateRange"] },
  { key: "dashboard_text", label: "Dashboard Text", category: "dashboard", kind: "content", bindable: false, dashboard: true, configurable: ["content"] },
  // Reserved canonical trigger component. Behaviour/variants are configured in UI Batch 2.
  { key: "button", label: "Custom Button", category: "action", kind: "action", bindable: false, reserved: true },
  { key: "jarves", label: "JARVES", category: "action", kind: "assistant", bindable: false, registered: true, behaviours: ["behaviour_1", "behaviour_2", "behaviour_3"], interactions: ["voice", "message", "ask_input"] },
]);

const COMPONENT_MAP = new Map(PLATFORM_COMPONENTS.map((component) => [component.key, component]));

export function listPlatformComponents() {
  return PLATFORM_COMPONENTS.map((component) => ({ ...component, fieldTypes: component.fieldTypes ? [...component.fieldTypes] : undefined }));
}

export function getPlatformComponent(key) {
  return COMPONENT_MAP.get(String(key || "")) || null;
}

export function componentForFieldType(fieldType) {
  const type = String(fieldType || "text").toLowerCase();
  return PLATFORM_COMPONENTS.find((component) => component.kind === "field" && component.fieldTypes?.includes(type)) || getPlatformComponent("text_input");
}

export function validateComponentRegistry() {
  const keys = PLATFORM_COMPONENTS.map((component) => component.key);
  return { valid: new Set(keys).size === keys.length, count: keys.length };
}
