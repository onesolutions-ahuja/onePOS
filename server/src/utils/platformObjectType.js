/*
 * Standard vs Custom classification for the Platform object administration UI.
 *
 * PRESENTATION ONLY. This never gates behaviour, never decides what may be
 * edited or deleted, and never replaces the backend's authoritative
 * system-object rules (services/platformSystemObjects.js), which remain the
 * source of truth for write protection and business-module routing.
 *
 * It classifies from metadata the Platform APIs already return, so an
 * administrator can tell onePOS-supplied objects from tenant-authored ones:
 *
 *   Standard — supplied by onePOS: backed by an existing business table
 *              (`source_table`) or shipped by an installed package
 *              (`package_id`).
 *   Custom   — authored in this tenant and not backed by a business table.
 */
export function isStandardObject(object) {
  if (!object || typeof object !== "object") return false;
  return Boolean(object.source_table || object.package_id);
}

export function objectType(object) {
  return isStandardObject(object) ? "standard" : "custom";
}

export function objectTypeLabel(object) {
  return isStandardObject(object) ? "Standard" : "Custom";
}

export function objectTypeDescription(object) {
  return isStandardObject(object)
    ? "Provided by onePOS and managed by its existing business module."
    : "Created in this company's metadata.";
}
