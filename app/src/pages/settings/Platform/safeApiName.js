export function toSafeApiName(label, fallback = "field") {
  const normalized = String(label || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 100)
    .replace(/_+$/g, "");

  return normalized || fallback;
}

/**
 * Shared create-mode API-name state derivation used by the Platform editors
 * (ObjectEditor, FieldEditor, LayoutEditor).
 *
 * While an entity is being created (isNew) and the editable label field
 * changes, the generated API name is recalculated from the COMPLETE current
 * label on every keystroke, so backspacing/correcting the label regenerates
 * the key. Once the entity exists (isNew false), the API name is stable and is
 * never regenerated from label edits.
 */
export function withGeneratedApiName(current, name, value, toApiName, options = {}) {
  const { labelField = "name", apiNameField = "object_key", isNew = true } = options;

  if (name !== labelField || !isNew) return {};

  return { [apiNameField]: toApiName(value) };
}
