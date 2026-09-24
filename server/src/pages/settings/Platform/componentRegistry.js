// Client fallback mirrors the server registry so the builder remains usable
// during transient API failures. The server /platform/component-registry is
// authoritative and is loaded by builders at runtime.
export const FALLBACK_COMPONENT_REGISTRY = [
  { key: "section", label: "Section", category: "layout", kind: "layout" },
  { key: "header", label: "Header", category: "content", kind: "content" },
  { key: "text", label: "Information Text", category: "content", kind: "content" },
  { key: "divider", label: "Divider", category: "layout", kind: "layout" },
  { key: "spacer", label: "Spacer", category: "layout", kind: "layout" },
  { key: "text_input", label: "Text Box", category: "field", kind: "field", bindable: true },
  { key: "long_text", label: "Long Text", category: "field", kind: "field", bindable: true },
  { key: "number", label: "Number", category: "field", kind: "field", bindable: true },
  { key: "currency", label: "Currency / Decimal", category: "field", kind: "field", bindable: true },
  { key: "date", label: "Date", category: "field", kind: "field", bindable: true },
  { key: "datetime", label: "Date & Time", category: "field", kind: "field", bindable: true },
  { key: "checkbox", label: "Checkbox", category: "field", kind: "field", bindable: true },
  { key: "picklist", label: "Picklist / Dropdown", category: "field", kind: "field", bindable: true },
  { key: "lookup", label: "Lookup", category: "field", kind: "field", bindable: true },
  { key: "related_list", label: "Related List / Table", category: "record", kind: "record", bindable: true },
  { key: "field_value", label: "Field Value", category: "record", kind: "record", bindable: true },
  { key: "button", label: "Custom Button", category: "action", kind: "action", reserved: true },
];

export function paletteComponents(registry = FALLBACK_COMPONENT_REGISTRY) {
  return registry.filter((component) => ["layout", "content", "action"].includes(component.category));
}

export function componentKeyForFieldType(fieldType, registry = FALLBACK_COMPONENT_REGISTRY) {
  const type = String(fieldType || "text").toLowerCase();
  const aliases = {
    text: "text_input", email: "text_input", phone: "text_input",
    long_text: "long_text", textarea: "long_text",
    number: "number", decimal: "currency", currency: "currency",
    date: "date", datetime: "datetime", boolean: "checkbox",
    select: "picklist", picklist: "picklist", multi_select: "picklist", lookup: "lookup",
  };
  const key = aliases[type] || "text_input";
  return registry.some((component) => component.key === key) ? key : "text_input";
}
