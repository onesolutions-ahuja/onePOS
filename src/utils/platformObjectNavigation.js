import { resolveObjectNavIcon } from "./platformObjectIcons.js";
import { buildObjectPath } from "./adminRoutes.js";

/*
 * Configured Platform Object pages → onePOS navigation items.
 *
 * The server already decided what the caller may see
 * (services/platformObjectNavigation.js); this module only merges that payload
 * into the navigation the Dock and the sidebar already render, and it NEVER
 * adds access:
 *
 *   - a configured label that collides with a built-in page is skipped, so
 *     navigation metadata can never quietly replace the specialised Products,
 *     Customers, Inventory … destinations;
 *   - duplicate labels inside the payload keep the first occurrence (the server
 *     already ordered them deterministically);
 *   - the route is always the ONE generic object runtime path.
 *
 * Pure and side-effect free so the merge can be asserted without a DOM.
 */

/** Page state used while an object deep link is being resolved. */
export const OBJECT_PAGE_KEY = "__configured_object__";

/** Sorts configured pages exactly like the server does. */
export function sortConfiguredPages(pages = []) {
  return [...pages].sort((a, b) => {
    const orderA = Number.isFinite(a?.order) ? a.order : 100;
    const orderB = Number.isFinite(b?.order) ? b.order : 100;
    if (orderA !== orderB) return orderA - orderB;
    const byLabel = String(a?.label || "").localeCompare(String(b?.label || ""));
    if (byLabel !== 0) return byLabel;
    return String(a?.key || "").localeCompare(String(b?.key || ""));
  });
}

/** Keeps only entries that can actually be rendered as a navigation item. */
export function sanitizeConfiguredPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((page) => page && typeof page === "object")
    .map((page) => ({
      key: String(page.key || "").trim(),
      label: String(page.label || "").trim(),
      objectKey: String(page.objectKey || "").trim(),
      route: page.route || buildObjectPath(page.objectKey),
      icon: page.icon || null,
      order: Number.isFinite(page.order) ? page.order : 100,
      appKey: page.appKey || null,
      appLabel: page.appLabel || null,
    }))
    .filter((page) => page.key && page.label && page.objectKey);
}

/**
 * @param {object} input
 * @param {Array} input.objectPages    the runtime payload (`objectPages`)
 * @param {string[]} input.reservedLabels page names that already exist in the
 *   built-in navigation — configured entries never take these over
 * @returns {{pages: Array, items: Array<[string, Function]>, routes: object,
 *            objects: object, byObjectKey: object}}
 */
export function buildConfiguredNavigation({ objectPages = [], reservedLabels = [] } = {}) {
  const reserved = new Set((reservedLabels || []).map((label) => String(label)));
  const pages = [];
  const items = [];
  const routes = {};
  const objects = {};
  const byObjectKey = {};

  for (const page of sortConfiguredPages(sanitizeConfiguredPages(objectPages))) {
    if (reserved.has(page.label)) continue;
    if (Object.prototype.hasOwnProperty.call(routes, page.label)) continue;

    pages.push(page);
    items.push([page.label, resolveObjectNavIcon(page.icon)]);
    routes[page.label] = page.route;
    objects[page.label] = page.objectKey;
    if (!byObjectKey[page.objectKey]) byObjectKey[page.objectKey] = page;
  }

  return { pages, items, routes, objects, byObjectKey };
}

export default { buildConfiguredNavigation, sanitizeConfiguredPages, sortConfiguredPages, OBJECT_PAGE_KEY };
