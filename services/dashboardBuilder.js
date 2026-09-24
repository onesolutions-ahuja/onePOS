/* Dashboard definitions are deliberately data-only. Reports remain the sole
 * SQL/query engine; this module only validates the dashboard composition. */
export const COMPONENT_TYPES = Object.freeze(["kpi", "chart", "table", "text"]);
export const FILTER_FIELDS = Object.freeze(["store", "date"]);

export function validateDashboardDefinition(input = {}) {
  const name = String(input.name || "").trim();
  if (!name || name.length > 150) throw new Error("A dashboard name up to 150 characters is required");
  const components = Array.isArray(input.components) ? input.components.slice(0, 50) : [];
  const normalized = components.map((component, index) => {
    const type = String(component?.type || "");
    if (!COMPONENT_TYPES.includes(type)) throw new Error(`Invalid dashboard component at position ${index + 1}`);
    const config = component?.config && typeof component.config === "object" ? component.config : {};
    if (type !== "text" && !config.reportId) throw new Error(`Component ${index + 1} must reference a saved report`);
    return {
      id: String(component.id || crypto.randomUUID()),
      type,
      title: String(component.title || "").slice(0, 150),
      config: {
        reportId: config.reportId ? String(config.reportId) : null,
        valueField: config.valueField ? String(config.valueField) : null,
        labelField: config.labelField ? String(config.labelField) : null,
        chartType: ["bar", "line", "pie"].includes(config.chartType) ? config.chartType : "bar",
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

export function mergeDashboardFilters(reportDefinition, dashboardFilters = []) {
  const filters = Array.isArray(reportDefinition?.filters) ? [...reportDefinition.filters] : [];
  for (const filter of dashboardFilters) {
    if (filter.field === "date") filters.push({ field: "date", operator: filter.value || "this_week" });
    if (filter.field === "store" && filter.value) filters.push({ field: "store", operator: "equals", value: filter.value });
  }
  return { ...reportDefinition, filters };
}
