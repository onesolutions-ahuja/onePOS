const WIDTHS = new Set(["full", "1/2", "1/3", "2/3", "1/4"]);
const COMPONENT_TYPES = new Set(["field", "text", "divider", "spacer", "header", "action", "related_list"]);

export function fieldKey(field) {
  return field?.apiName || field?.api_name || field?.fieldKey || field?.field_key || field?.name || "";
}

export function normalizeFormDefinition(definition = {}) {
  const rawSections = Array.isArray(definition.sections) && definition.sections.length
    ? definition.sections
    : [{ id: "section-details", label: "Details", order: 0, columns: 1, visible: true }];
  const sections = rawSections.map((section, index) => ({
    id: String(section?.id || `section-${index + 1}`),
    label: section?.label || section?.title || `Section ${index + 1}`,
    order: Number.isFinite(Number(section?.order)) ? Number(section.order) : index,
    columns: Math.min(4, Math.max(1, Number(section?.columns) || 1)),
    visible: section?.visible !== false,
  })).sort((a, b) => a.order - b.order);
  const sectionIds = new Set(sections.map((section) => section.id));
  const source = Array.isArray(definition.components) ? definition.components
    : sections.flatMap((section) => Array.isArray(section.items) ? section.items : []);
  const components = source.map((component, index) => {
    const type = COMPONENT_TYPES.has(component?.type) ? component.type : "field";
    const id = String(component?.id || `${type}-${component?.field_key || index + 1}`);
    const sectionId = sectionIds.has(component?.section_id) ? component.section_id : sections[0].id;
    return {
      ...component,
      id,
      type,
      section_id: sectionId,
      order: Number.isFinite(Number(component?.order)) ? Number(component.order) : index,
      width: WIDTHS.has(component?.width) ? component.width : "full",
      visible: component?.visible !== false,
      ...(type === "field" ? {
        field_key: component?.field_key || component?.fieldKey || "",
        required: component?.required === true,
        readOnly: component?.readOnly === true || component?.read_only === true,
      } : {}),
    };
  }).filter((component) => component.type !== "field" || component.field_key);
  return { ...definition, sections, components };
}

export function componentsForSection(definition, sectionId) {
  return normalizeFormDefinition(definition).components
    .filter((component) => component.section_id === sectionId)
    .sort((a, b) => a.order - b.order);
}

export function sanitizeFormDefinition(definition, fields = []) {
  const allowed = new Map(fields.map((field) => [fieldKey(field), field]));
  const normalized = normalizeFormDefinition(definition);
  return {
    ...normalized,
    components: normalized.components.filter((component) => component.type !== "field" || allowed.has(component.field_key)),
  };
}

export function diagnoseFormDefinition(definition = {}, fields = []) {
  const issues = [];
  const raw = definition && typeof definition === "object" ? definition : {};
  if (definition === null || typeof definition !== "object" || Array.isArray(definition)) {
    issues.push({ severity: "error", message: "Definition must be an object." });
    return issues;
  }
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const sectionIds = new Set();
  sections.forEach((section, index) => {
    if (!section || typeof section !== "object") {
      issues.push({ severity: "error", message: `Section ${index + 1} is malformed.` });
      return;
    }
    if (!section.id) issues.push({ severity: "error", message: `Section ${index + 1} has no id.` });
    else if (sectionIds.has(String(section.id))) issues.push({ severity: "error", message: `Duplicate section id "${section.id}".` });
    else sectionIds.add(String(section.id));
  });
  const allowed = new Set(fields.map(fieldKey));
  const components = Array.isArray(raw.components) ? raw.components : [];
  const componentIds = new Set();
  components.forEach((component, index) => {
    if (!component || typeof component !== "object") {
      issues.push({ severity: "error", message: `Component ${index + 1} is malformed.` });
      return;
    }
    const id = component.id || `${component.type || "component"}-${index + 1}`;
    if (componentIds.has(String(id))) issues.push({ severity: "error", message: `Duplicate component id "${id}".` });
    componentIds.add(String(id));
    if (!COMPONENT_TYPES.has(component.type)) issues.push({ severity: "warning", message: `Component "${id}" uses unsupported type "${component.type || ""}".` });
    if (component.width && !WIDTHS.has(component.width)) issues.push({ severity: "warning", message: `Component "${id}" uses unsupported width "${component.width}".` });
    if (component.section_id && sectionIds.size && !sectionIds.has(String(component.section_id))) issues.push({ severity: "error", message: `Component "${id}" references missing section "${component.section_id}".` });
    if (component.type === "field" && !allowed.has(component.field_key)) issues.push({ severity: "error", message: `Field "${component.field_key || ""}" is stale or unavailable.` });
    for (const key of ["visibilityCondition", "requiredCondition"]) {
      if (component[key] && (!Array.isArray(component[key].conditions) || !component[key].conditions.length)) {
        issues.push({ severity: "error", message: `Component "${id}" has an invalid ${key}.` });
      }
    }
  });
  return issues;
}
