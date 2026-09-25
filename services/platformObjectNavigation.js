import { DEVICE_PROFILES, normalizeDeviceProfile } from "./runtimeAccess.js";
import {
  isPlatformSuperadmin,
  moduleRuntimeAccess,
  permissionAllows,
} from "./authorization.js";
import { isPackageLicensed } from "./licensing.js";
import { isSafeIdentifier } from "./platformMetadata.js";

/*
 * METADATA-DRIVEN PLATFORM OBJECT NAVIGATION
 *
 * A Platform Object becomes a normal onePOS navigation entry through the
 * EXISTING Platform Page/App configuration — no new table, no new column on
 * platform_objects, no hard-coded React page per Object:
 *
 *   platform_objects  →  platform_pages (+ platform_apps)  →  this module
 *                     →  current access rules  →  runtime navigation payload
 *                     →  AdminLayout / AdminNavDock  →  generic object runtime
 *
 * The navigation metadata is the page's own `definition` JSONB (the same field
 * the app builder already writes) extended with the navigation keys:
 *
 *   { objectKey, showInNavigation, icon, order, moduleKey?, profiles?, permissions? }
 *
 * PRESENTATION NEVER GRANTS ACCESS. Every entry here has already passed the
 * company → module/package/licence → object permission → user permission →
 * device profile gates, and the generic runtime endpoints keep enforcing
 * object permissions on their own, so a deep link without access is refused by
 * the API rather than by hiding a menu item.
 *
 * This module is pure: it takes rows the caller already loaded and returns the
 * lightweight navigation entries. It never touches the database, and it never
 * returns field definitions, layouts, formulas, workflows or records.
 */

/** The ONE generic runtime route every configured Object page resolves to. */
export const OBJECT_RUNTIME_ROUTE_PREFIX = "/app/objects/";

/** Deterministic default navigation order for pages that do not set one. */
export const DEFAULT_OBJECT_NAV_ORDER = 100;

/** Icon KEYS only — a safe default is applied for anything unknown. */
export const DEFAULT_OBJECT_ICON_KEY = "box";

export const OBJECT_NAVIGATION_EXCLUSIONS = Object.freeze({
  NOT_ACTIVE: "page_inactive",
  APP_INACTIVE: "app_inactive",
  OTHER_COMPANY: "other_company",
  UNSUPPORTED_PAGE_TYPE: "unsupported_page_type",
  NO_OBJECT: "no_object_configured",
  HIDDEN: "hidden_from_navigation",
  OBJECT_UNAVAILABLE: "object_unavailable",
  OBJECT_INACTIVE: "object_inactive",
  MODULE_DISABLED: "module_disabled",
  NOT_PERMITTED: "not_permitted",
  DEVICE_PROFILE: "device_profile",
  DUPLICATE_KEY: "duplicate_key",
});

const PAGE_TYPES_WITH_GENERIC_RUNTIME = new Set(["object"]);

/*
 * Permission codes in this system are DOTTED (reports.custom.view,
 * returns.view, audit.view …), so isSafeIdentifier() — which forbids dots — must
 * not be used to validate them: it would silently drop every real requirement
 * and turn a permission-gated page into an open one. This is the narrower,
 * purpose-built pattern for a permission code.
 */
const PERMISSION_CODE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

function isPermissionCode(value) {
  return typeof value === "string" && PERMISSION_CODE.test(value);
}

/** Icon keys are identifiers, never markup or component source. */
export function normalizeObjectIconKey(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  return key.slice(0, 40);
}

export function objectRuntimeRoute(objectKey) {
  const key = String(objectKey || "").trim();
  return key ? `${OBJECT_RUNTIME_ROUTE_PREFIX}${encodeURIComponent(key)}` : null;
}

function optionalString(value, limit = 120) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, limit) : null;
}

function normalizeProfiles(value) {
  if (!Array.isArray(value)) return [];
  const allowed = Object.values(DEVICE_PROFILES);
  return value
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter((entry) => allowed.includes(entry))
    .filter((entry, index, all) => all.indexOf(entry) === index)
    .slice(0, allowed.length);
}

/**
 * The single page-definition normalizer.
 *
 * It preserves what pages already stored (components/sections) AND the semantic
 * target keys, then whitelists the navigation keys. Unknown keys are dropped —
 * the definition is admin-authored input, so nothing arbitrary is persisted.
 */
export function normalizeObjectPageDefinition(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  // Forms, record pages and custom pages share the same layout vocabulary:
  // sections describe placement; components reference canonical Component
  // Registry keys. Keep the legacy components-only shape readable while no
  // longer collapsing sections into components.
  const legacyBuilder = source.builder && typeof source.builder === "object" && !Array.isArray(source.builder)
    ? source.builder
    : null;
  const builderSections = Array.isArray(legacyBuilder?.regions)
    ? legacyBuilder.regions.map((region, index) => ({
        id: String(region?.id || `section-${index + 1}`),
        label: String(region?.label || `Section ${index + 1}`).slice(0, 200),
        order: index,
        columns: Math.min(3, Math.max(1, Number(region?.columns) || 1)),
        visible: region?.visible !== false,
      }))
    : [];
  const builderComponents = Array.isArray(legacyBuilder?.regions)
    ? legacyBuilder.regions.flatMap((region) => Array.isArray(region?.components)
      ? region.components.map((component) => ({ ...component, section_id: region.id }))
      : [])
    : [];
  const definition = {
    sections: Array.isArray(source.sections) ? source.sections : builderSections,
    components: Array.isArray(source.components) ? source.components : builderComponents,
  };

  /* Custom Page Builder tree (nested sections.children). Sections/components
     above stay for legacy pages; when the nested tree is present it is the
     authoritative shape and the flat arrays are kept in sync for readers. */
  if (Array.isArray(source.sections) && source.sections.some((section) => section && Array.isArray(section.children))) {
    definition.pageTree = true;
  }
  const device = optionalString(source.device ?? legacyBuilder?.device, 20);
  if (["desktop", "tablet", "mobile"].includes(device)) definition.device = device;

  /* Existing target keys (previously discarded by the old whitelist, which is
     why a configured page had no object to open). */
  const objectKey = optionalString(source.objectKey ?? source.object_key, 100);
  if (objectKey) definition.objectKey = objectKey;

  const referenceId = optionalString(source.referenceId ?? source.reference_id, 64);
  if (referenceId) definition.referenceId = referenceId;

  const reportKey = optionalString(source.reportKey ?? source.report_key, 100);
  if (reportKey) definition.reportKey = reportKey;

  /* Navigation exposure. Only an explicit false hides a page, so the admin UI
     writes the flag explicitly and existing pages keep their behaviour. */
  definition.showInNavigation = source.showInNavigation !== false;

  const icon = normalizeObjectIconKey(source.icon);
  if (icon) definition.icon = icon;

  const order = Number.parseInt(source.order, 10);
  definition.order = Number.isFinite(order) ? Math.min(Math.max(order, 0), 9999) : DEFAULT_OBJECT_NAV_ORDER;

  const moduleKey = optionalString(source.moduleKey ?? source.module_key, 100);
  if (moduleKey && isSafeIdentifier(moduleKey)) definition.moduleKey = moduleKey;

  const profiles = normalizeProfiles(source.profiles);
  if (profiles.length) definition.profiles = profiles;

  const permissions = Array.isArray(source.permissions)
    ? source.permissions
      .map((entry) => String(entry || "").trim())
      .filter((entry) => isPermissionCode(entry))
      .slice(0, 10)
    : [];
  if (permissions.length) definition.permissions = permissions;

  return definition;
}

/** Deterministic navigation order: configured position, then label, then key. */
export function sortObjectNavigation(entries = []) {
  return [...entries].sort((a, b) => {
    const orderA = Number.isFinite(a.order) ? a.order : DEFAULT_OBJECT_NAV_ORDER;
    const orderB = Number.isFinite(b.order) ? b.order : DEFAULT_OBJECT_NAV_ORDER;
    if (orderA !== orderB) return orderA - orderB;
    const byLabel = String(a.label || "").localeCompare(String(b.label || ""));
    if (byLabel !== 0) return byLabel;
    return String(a.key || "").localeCompare(String(b.key || ""));
  });
}

/**
 * Build the runtime object-navigation payload.
 *
 * @param {object} input
 * @param {Array} input.pages          platform_pages rows joined with their app (caller's company only)
 * @param {Array} input.apps           platform_apps rows (caller's company only)
 * @param {Array} input.objects        platform_objects rows referenced by those pages
 * @param {Array} input.modules        platform_modules rows + company enablement/package/licence columns
 * @param {Array} input.objectPermissions platform_object_permissions rows for the caller's role
 * @param {object} input.entitlements  company entitlements
 * @param {string[]} input.permissions the caller's role permission codes
 * @param {boolean} input.isSuperadmin
 * @param {string} input.deviceProfile
 * @param {string} input.companyId     the caller's company (tenant guard)
 * @returns {{entries: Array, excluded: Array<{key: string, reason: string}>}}
 */
export function objectNavigationEntries({
  pages = [],
  apps = [],
  objects = [],
  modules = [],
  objectPermissions = [],
  entitlements = {},
  permissions = [],
  isSuperadmin = false,
  deviceProfile = DEVICE_PROFILES.ADMIN,
  companyId = null,
} = {}) {
  const isSuperadminRequest = isPlatformSuperadmin({ isSuperadmin });
  const profile = normalizeDeviceProfile(deviceProfile);

  const appById = new Map(apps.map((app) => [String(app.id), app]));
  const objectByKey = new Map(objects.map((object) => [String(object.object_key), object]));
  const moduleByKey = new Map(modules.map((module) => [String(module.module_key), module]));
  const moduleById = new Map(modules.map((module) => [String(module.id), module]));
  const viewableObjectIds = new Set(
    objectPermissions.filter((row) => row.can_view === true).map((row) => String(row.object_id))
  );

  /* Deterministic first-wins when two pages claim the same key. */
  const ordered = sortObjectNavigation(
    pages.map((page) => ({
      page,
      order: normalizeObjectPageDefinition(page.definition).order,
      label: page.label,
      key: page.page_key,
    }))
  ).map((item) => item.page);

  const entries = [];
  const excluded = [];
  const usedKeys = new Set();

  for (const page of ordered) {
    const key = String(page.page_key || "");
    const fail = (reason) => excluded.push({ key, reason });

    if (page.active === false) { fail(OBJECT_NAVIGATION_EXCLUSIONS.NOT_ACTIVE); continue; }
    if (!key) { fail(OBJECT_NAVIGATION_EXCLUSIONS.DUPLICATE_KEY); continue; }
    if (usedKeys.has(key)) { fail(OBJECT_NAVIGATION_EXCLUSIONS.DUPLICATE_KEY); continue; }

    /* Tenant guard: both the page and its app must belong to the caller. */
    if (companyId != null && String(page.company_id || "") !== String(companyId)) {
      fail(OBJECT_NAVIGATION_EXCLUSIONS.OTHER_COMPANY);
      continue;
    }

    const app = appById.get(String(page.app_id));
    if (!app || app.active === false) { fail(OBJECT_NAVIGATION_EXCLUSIONS.APP_INACTIVE); continue; }
    if (companyId != null && String(app.company_id || "") !== String(companyId)) {
      fail(OBJECT_NAVIGATION_EXCLUSIONS.OTHER_COMPANY);
      continue;
    }

    if (!PAGE_TYPES_WITH_GENERIC_RUNTIME.has(String(page.page_type || "object"))) {
      fail(OBJECT_NAVIGATION_EXCLUSIONS.UNSUPPORTED_PAGE_TYPE);
      continue;
    }

    const definition = normalizeObjectPageDefinition(page.definition);

    if (definition.showInNavigation === false) { fail(OBJECT_NAVIGATION_EXCLUSIONS.HIDDEN); continue; }

    const objectKey = definition.objectKey;
    if (!objectKey) { fail(OBJECT_NAVIGATION_EXCLUSIONS.NO_OBJECT); continue; }

    const object = objectByKey.get(String(objectKey));
    if (!object) { fail(OBJECT_NAVIGATION_EXCLUSIONS.OBJECT_UNAVAILABLE); continue; }
    if (object.active === false) { fail(OBJECT_NAVIGATION_EXCLUSIONS.OBJECT_INACTIVE); continue; }
    if (companyId != null && object.company_id && String(object.company_id) !== String(companyId)) {
      fail(OBJECT_NAVIGATION_EXCLUSIONS.OTHER_COMPANY);
      continue;
    }

    /* Module / package / licence: the page may name a module explicitly,
       otherwise the Object's owning module applies. An unknown module key fails
       closed — navigation metadata must never widen access. */
    const module = definition.moduleKey
      ? moduleByKey.get(String(definition.moduleKey))
      : object.module_id
        ? moduleById.get(String(object.module_id))
        : null;

    if (definition.moduleKey && !module) {
      fail(OBJECT_NAVIGATION_EXCLUSIONS.MODULE_DISABLED);
      continue;
    }

    if (object.module_id && !definition.moduleKey && !module) {
      fail(OBJECT_NAVIGATION_EXCLUSIONS.MODULE_DISABLED);
      continue;
    }

    if (module) {
      const access = moduleRuntimeAccess({
        enabledByCompany: module.company_enabled ?? true,
        packageInstalled: module.package_status === "active",
        licensed: isPackageLicensed(entitlements, { manifest: module.package_manifest || {} }),
        permitted: true,
        isSuperadmin: isSuperadminRequest,
      });
      /* Company disablement, a missing package and a missing entitlement all
         exclude the entry; they are reported as one reason because the caller
         may not distinguish them (and must not have to). */
      if (!access.allowed) { fail(OBJECT_NAVIGATION_EXCLUSIONS.MODULE_DISABLED); continue; }
    }

    /* Object-level permission (platform_object_permissions.can_view by role). */
    if (!isSuperadminRequest && !viewableObjectIds.has(String(object.id))) {
      fail(OBJECT_NAVIGATION_EXCLUSIONS.NOT_PERMITTED);
      continue;
    }

    /* Page-declared user permissions, using the shared rule. A page that
       declares none is available to everyone who already passed the object
       permission gate above — permissionAllows() answers false for an empty
       requirement list, so the guard must only run when one is declared. */
    const requiredPermissions = definition.permissions || [];
    if (requiredPermissions.length && !permissionAllows({
      isSuperadmin: isSuperadminRequest,
      permissions,
      requiredPermissions,
    })) {
      fail(OBJECT_NAVIGATION_EXCLUSIONS.NOT_PERMITTED);
      continue;
    }

    /* Device / app profile (a page with no declared profiles serves everyone). */
    if (definition.profiles?.length && !definition.profiles.includes(profile)) {
      fail(OBJECT_NAVIGATION_EXCLUSIONS.DEVICE_PROFILE);
      continue;
    }

    usedKeys.add(key);
    entries.push({
      key,
      label: optionalString(page.label, 200) || objectKey,
      objectKey,
      route: objectRuntimeRoute(objectKey),
      icon: definition.icon || null,
      order: definition.order,
      appKey: optionalString(app.app_key, 100),
      appLabel: optionalString(app.label, 200),
    });
  }

  return { entries: sortObjectNavigation(entries), excluded };
}
