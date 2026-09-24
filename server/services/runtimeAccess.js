import { internalAppCatalog } from "./internalAppCatalog.js";
import { isPlatformSuperadmin } from "./authorization.js";

export const DEVICE_PROFILES = Object.freeze({
  ADMIN: "admin",
  TILL: "till",
});

const DESTINATIONS = Object.freeze({
  pos: { path: "/app", moduleKey: "retail_pos", permission: "sale.view" },
  dashboard: { path: "/app/dashboard", moduleKey: null, requiresAnyPermission: true },
});

export function normalizeDeviceProfile(value) {
  const profile = String(value || "").trim().toLowerCase();
  return profile === DEVICE_PROFILES.TILL ? DEVICE_PROFILES.TILL : DEVICE_PROFILES.ADMIN;
}

export function destinationFor(value) {
  const key = String(value || "").trim().toLowerCase();
  if (DESTINATIONS[key]) return { key, ...DESTINATIONS[key] };
  const destination = Object.values(DESTINATIONS).find((entry) => entry.path === value);
  return destination ? { key: Object.keys(DESTINATIONS).find((name) => DESTINATIONS[name] === destination), ...destination } : null;
}

export const isValidLandingPage = (value) => Boolean(destinationFor(value));

export function canAccessDestination(value, { enabledModules = new Set(), permissions = [], isAdmin = false, isSuperadmin = false } = {}) {
  const destination = destinationFor(value);
  if (!destination) return false;
  /* Company module activation applies to EVERY caller — including a Platform
     Superadmin operating inside a company. The Superadmin bypass is a
     PERMISSION-model bypass, never a tenant-configuration bypass. */
  if (destination.moduleKey && !enabledModules.has(destination.moduleKey)) return false;
  /* Platform Superadmin resolves a valid destination even with an empty
     permission set, so ordinary permission filtering can never eliminate
     every candidate for the platform operator. */
  if (isAdmin === true) return true;
  if (isPlatformSuperadmin({ isSuperadmin })) return true;
  return (destination.requiresAnyPermission ? permissions.length > 0 : true)
    && (!destination.permission || permissions.includes(destination.permission));
}

export function resolveLandingPage({
  userOverride,
  roleDefault,
  profileDefault,
  companyDefault,
  deviceProfile = DEVICE_PROFILES.ADMIN,
  enabledModules = new Set(),
  permissions = [],
  isAdmin = false,
  isSuperadmin = false,
} = {}) {
  const profile = normalizeDeviceProfile(deviceProfile);
  const profileFallback = profileDefault || (profile === DEVICE_PROFILES.TILL ? "pos" : "dashboard");
  const candidates = [userOverride, roleDefault, profileFallback, companyDefault, "dashboard", "pos"];
  const selected = candidates.find((candidate) => canAccessDestination(candidate, { enabledModules, permissions, isAdmin, isSuperadmin }));
  return destinationFor(selected)?.path || null;
}

export function permittedCatalogEntries({ enabledModules = new Set(), permissions = [], isAdmin = false, isSuperadmin = false } = {}) {
  const bypass = isAdmin === true || isPlatformSuperadmin({ isSuperadmin });
  return internalAppCatalog.filter((entry) => enabledModules.has(entry.key) && (bypass || entry.permissions.some((permission) => permissions.includes(permission))));
}


export function resolveLandingFlow({ flow, user = {}, deviceProfile = DEVICE_PROFILES.ADMIN, fallback = null } = {}) {
  const rules = Array.isArray(flow?.rules) ? flow.rules : [];
  const profile = normalizeDeviceProfile(deviceProfile);
  const values = {
    user_id: String(user.id || ""),
    role_id: String(user.roleId || user.role_id || ""),
    profile: String(user.profile || user.profileKey || profile || "").toLowerCase(),
    store_id: String(user.storeId || user.store_id || ""),
    company_id: String(user.companyId || user.company_id || ""),
  };
  const matches = (condition = {}) => {
    const actual = values[String(condition.field || "").toLowerCase()];
    if (actual === undefined) return false;
    const expected = String(condition.value ?? "");
    return condition.operator === "not_equals" ? actual !== expected : actual === expected;
  };
  for (const rule of rules) {
    if (rule?.active === false) continue;
    const conditions = Array.isArray(rule?.conditions) ? rule.conditions : [];
    if (conditions.every(matches) && typeof rule?.destination === "string" && rule.destination.startsWith("/app")) return rule.destination;
  }
  return typeof flow?.defaultDestination === "string" && flow.defaultDestination.startsWith("/app") ? flow.defaultDestination : fallback;
}
