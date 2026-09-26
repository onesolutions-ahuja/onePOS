/*
 * THE canonical navigation-target system for Builder components.
 *
 * ONE registry + ONE resolver serve every actionable component (Custom Button
 * today; workflow cards, related lists, menus later). The Builder never keeps
 * its own route list and never stores URLs — it stores a STABLE TARGET
 * DEFINITION (type + registry keys), and the runtime resolves that definition
 * through the existing onePOS navigation architecture at click time:
 *
 *   Navigation Target Registry (this module)
 *     → Builder target selector (ActionWorkflowPicker)
 *       → stable saved target definition (customPageTree.js interaction)
 *         → resolveNavigationTarget() (this module)
 *           → permission/entitlement/scope checks (same gates as the dock)
 *             → existing app router (App.jsx view switch + history push)
 *
 * Destinations are ALWAYS discovered from the authoritative sources:
 *
 *   system_page   → utils/navCatalogue.js (the ONE application page catalogue,
 *                   already permission-gated) intersected with the runtime
 *                   app-catalog module keys (licence/enablement filter)
 *   custom_page   → /api/platform/runtime/apps (company-scoped platform_pages)
 *   object_list   → the app-catalog `objectPages` payload (server-filtered per
 *                   caller: object permission, module licence, device profile)
 *   object_record → the same object discovery + a record-source selector
 *
 * Navigation only changes application location. It is NOT a business action,
 * NOT a permission bypass and never executes anything: the destination's own
 * runtime re-checks access server-side (navigation security does not replace
 * API security).
 */

import {
  permittedNavItems,
  normalizePermissionState,
} from "./navCatalogue.js";
import {
  PAGE_SLUGS,
  buildAppPath,
  buildCustomPagePath,
  buildObjectPath,
  buildObjectRecordPath,
} from "./adminRoutes.js";

/** The destination types Builder components may persist. */
export const NAVIGATION_TARGET_TYPES = Object.freeze({
  SYSTEM_PAGE: "system_page",
  CUSTOM_PAGE: "custom_page",
  OBJECT_LIST: "object_list",
  OBJECT_RECORD: "object_record",
});

/** Record sources for an object_record target. */
export const NAVIGATION_RECORD_SOURCES = Object.freeze(["current", "explicit"]);

/**
 * THE application-page target list, derived from the ONE nav catalogue.
 *
 * `permissionState` is the same /api/auth/me/permissions payload every shell
 * consumes, so a page the caller cannot open never becomes a selectable
 * destination — the Builder cannot become a permission bypass.
 *
 * Debug/internal surfaces ("Licensing" is superadmin-only tooling, the audit
 * log is an administration console) are excluded: a React route existing is
 * not the same as being a legitimate Builder destination.
 */
const EXCLUDED_SYSTEM_TARGET_KEYS = new Set(["Licensing", "Audit Log"]);

export function systemNavigationTargets(permissionState = null) {
  const state = normalizePermissionState(permissionState || {});
  /* permittedNavItems returns [page, Icon]; pages map 1:1 to /app/<slug>. */
  const items = permittedNavItems(state);
  const seen = new Set();
  const targets = [];
  for (const [page, Icon] of items) {
    if (EXCLUDED_SYSTEM_TARGET_KEYS.has(page)) continue;
    if (!PAGE_SLUGS[page] || seen.has(page)) continue;
    seen.add(page);
    targets.push({
      type: NAVIGATION_TARGET_TYPES.SYSTEM_PAGE,
      key: page,
      label: page,
      route: buildAppPath(page),
      iconKey: Icon ? Icon.name || page : null,
    });
  }
  return targets;
}

/** The saved targets a Builder component reads back after save/reload. */
export function normalizeNavigationTarget(value) {
  const source = value && typeof value === "object" ? value : {};
  const type = Object.values(NAVIGATION_TARGET_TYPES).includes(source.type)
    ? source.type
    : null;
  if (!type) return null;
  const key = typeof source.key === "string" ? source.key.trim().slice(0, 200) : "";
  const target = { type, key };
  if (type === NAVIGATION_TARGET_TYPES.SYSTEM_PAGE) {
    /* The page key IS the registry key (PAGE_SLUGS entry) — not a URL. */
    return key && PAGE_SLUGS[key] ? { type, key } : null;
  }
  if (type === NAVIGATION_TARGET_TYPES.CUSTOM_PAGE) {
    /* Stable page key only; labels are display state and never identity. */
    return key && /^[a-z_][a-z0-9_]*$/.test(key) ? { type, key } : null;
  }
  if (type === NAVIGATION_TARGET_TYPES.OBJECT_LIST) {
    return key && /^[a-z_][a-z0-9_]*$/.test(key) ? { type, key } : null;
  }
  /* object_record: object key + safe record source (+ explicit id). */
  const objectKey = typeof source.objectKey === "string" ? source.objectKey.trim().slice(0, 100) : "";
  const recordSource = NAVIGATION_RECORD_SOURCES.includes(source.recordSource)
    ? source.recordSource
    : "current";
  if (!objectKey || !/^[a-z_][a-z0-9_]*$/.test(objectKey)) return null;
  const next = { type, key: objectKey, objectKey, recordSource };
  if (recordSource === "explicit") {
    /* Identifiers here are record UUIDs (the platform's record id shape);
       anything else is dropped, so no forged input can reach the route. */
    const recordId = typeof source.recordId === "string" ? source.recordId.trim().slice(0, 64) : "";
    if (!/^[0-9a-fA-F-]{8,64}$/.test(recordId)) return null;
    next.recordId = recordId;
  }
  return next;
}

/**
 * THE ONE runtime resolver: saved target definition → canonical route.
 *
 * @param {object} target          normalized target definition
 * @param {object} context         safe runtime context (see context below)
 * @returns {{ok:true, route:string, target:object, label:string}
 *        |{ok:false, reason:string, message:string}}
 */
export function resolveNavigationTarget(target, context = {}) {
  const normalized = normalizeNavigationTarget(target);
  if (!normalized) {
    return { ok: false, reason: "invalid_target", message: "This button has no valid navigation target configured." };
  }
  const state = normalizePermissionState(context.permissionState || {});
  const enabledModules = context.enabledModules instanceof Set
    ? context.enabledModules
    : new Set(Array.isArray(context.enabledModules) ? context.enabledModules : []);
  const objectPages = Array.isArray(context.objectPages) ? context.objectPages : [];
  const customPages = Array.isArray(context.customPages) ? context.customPages : [];

  if (normalized.type === NAVIGATION_TARGET_TYPES.SYSTEM_PAGE) {
    /* Re-check against the SAME catalogue the dock renders from — the
       Builder's list is convenience; this gate is the invariant. */
    const available = systemNavigationTargets(state).find((entry) => entry.key === normalized.key);
    if (!available) {
      return { ok: false, reason: "not_available", message: "That page is not available on this device." };
    }
    return { ok: true, route: available.route, target: normalized, label: available.label };
  }

  if (normalized.type === NAVIGATION_TARGET_TYPES.CUSTOM_PAGE) {
    const page = customPages.find((entry) => entry && entry.key === normalized.key);
    if (!page) {
      return { ok: false, reason: "not_found", message: "The linked page is no longer available." };
    }
    return { ok: true, route: buildCustomPagePath(normalized.key), target: normalized, label: page.label || normalized.key };
  }

  if (normalized.type === NAVIGATION_TARGET_TYPES.OBJECT_LIST) {
    const object = objectPages.find((entry) => entry && entry.objectKey === normalized.key);
    if (!object) {
      /* Server-filtered payload: an object the caller may not see, or one
         whose module lost its licence, simply is not navigable here. */
      return { ok: false, reason: "not_available", message: "That object is not available for your account." };
    }
    return { ok: true, route: buildObjectPath(normalized.key), target: normalized, label: object.label || object.key || normalized.key };
  }

  /* object_record — resolves through the ONE canonical record route helper. */
  const object = objectPages.find((entry) => entry && entry.objectKey === normalized.objectKey);
  if (!object) {
    return { ok: false, reason: "not_available", message: "That object is not available for your account." };
  }
  const recordSource = normalized.recordSource;
  if (recordSource === "explicit") {
    if (!normalized.recordId) {
      return { ok: false, reason: "missing_record", message: "The linked record is no longer available." };
    }
    return {
      ok: true,
      route: buildObjectRecordPath(normalized.objectKey, normalized.recordId),
      target: normalized,
      label: object.label || normalized.objectKey,
    };
  }
  /* "current": the record must come from the SAFE runtime context — the
     component's bound collection object/row. A component with no record
     context cannot fabricate one. */
  const currentRecordId = context.currentRecordId != null ? String(context.currentRecordId).trim() : "";
  if (!currentRecordId) {
    return { ok: false, reason: "no_record_context", message: "This button needs a selected record to open." };
  }
  return {
    ok: true,
    route: buildObjectRecordPath(normalized.objectKey, currentRecordId),
    target: normalized,
    label: object.label || normalized.objectKey,
  };
}

/**
 * SAFE RUNTIME CONTEXT for navigation actions.
 *
 * Builder components receive exactly this — the authenticated session state,
 * the resolved catalogues and the record context of the surface they live on.
 * Nothing here grants access to runtime internals; the session permission
 * state is re-checked at resolve time, and every destination endpoint stays
 * authoritative for its own data.
 */
export function buildNavigationContext({
  permissionState = null,
  enabledModules = null,
  objectPages = [],
  customPages = [],
  currentObjectKey = null,
  currentRecordId = null,
} = {}) {
  const modules = enabledModules instanceof Set
    ? enabledModules
    : new Set(Array.isArray(enabledModules) ? enabledModules : []);
  return {
    permissionState,
    enabledModules: modules,
    objectPages: objectPages.map((page) => ({
      key: page?.key || page?.page_key || null,
      label: page?.label || null,
      objectKey: page?.objectKey || page?.object_key || null,
    })).filter((page) => page.objectKey),
    customPages: customPages.map((page) => ({
      key: page?.key || page?.page_key || null,
      label: page?.label || null,
    })).filter((page) => page.key),
    currentObjectKey: typeof currentObjectKey === "string" && /^[a-z_][a-z0-9_]*$/.test(currentObjectKey) ? currentObjectKey : null,
    currentRecordId: currentRecordId != null && String(currentRecordId).trim() !== "" ? String(currentRecordId).trim() : null,
  };
}

/**
 * Execute a navigation target through the EXISTING app router.
 *
 * The app is a two-view application whose "routes" are views re-resolved from
 * the address bar (parseAppPath). One mechanism serves every shell: push the
 * canonical URL, then re-resolve — exactly what PlatformAdmin.openAdminPage
 * and the Custom Page runtime already do. No second router, no per-component
 * navigation code.
 */
export function navigateToTarget(result, { currentPath = null } = {}) {
  if (!result || result.ok !== true || !result.route) return false;
  if (typeof window === "undefined") return false;
  const path = currentPath || window.location.pathname;
  if (path !== result.route) {
    window.history.pushState({}, "", result.route);
  }
  if (typeof window.PopStateEvent === "function") {
    window.dispatchEvent(new window.PopStateEvent("popstate"));
  }
  return true;
}

/** Human label for the Builder's summary line (describeInteraction). */
export function describeNavigationTarget(target, fallbackLabel = "") {
  const normalized = normalizeNavigationTarget(target);
  if (!normalized) return "";
  if (normalized.type === NAVIGATION_TARGET_TYPES.SYSTEM_PAGE) return normalized.key;
  if (normalized.type === NAVIGATION_TARGET_TYPES.CUSTOM_PAGE) return fallbackLabel || normalized.key;
  const suffix = normalized.type === NAVIGATION_TARGET_TYPES.OBJECT_RECORD
    ? ` · ${normalized.recordSource === "explicit" ? "Record" : "Current record"}`
    : " · list";
  return `${fallbackLabel || normalized.key}${suffix}`;
}
