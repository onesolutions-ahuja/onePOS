const DESTINATIONS = Object.freeze({
  pos: { path: "/app", moduleKey: "retail_pos", permission: "sale.view" },
  dashboard: { path: "/app/dashboard", moduleKey: null, requiresAnyPermission: true },
});

function destinationFor(value) {
  const key = String(value || "").trim().toLowerCase();
  if (DESTINATIONS[key]) return { key, ...DESTINATIONS[key] };
  return Object.entries(DESTINATIONS).find(([, destination]) => destination.path === value)
    ? { key: Object.keys(DESTINATIONS).find((name) => DESTINATIONS[name].path === value), ...Object.values(DESTINATIONS).find((destination) => destination.path === value) }
    : null;
}

function canAccessDestination(value, { enabledModules = new Set(), permissions = [], isAdmin = false, isSuperadmin = false } = {}) {
  const destination = destinationFor(value);
  if (!destination) return false;
  if (destination.moduleKey && !enabledModules.has(destination.moduleKey)) return false;
  if (isAdmin === true || isSuperadmin === true) return true;
  return (destination.requiresAnyPermission ? permissions.length > 0 : true)
    && (!destination.permission || permissions.includes(destination.permission));
}

export function resolveLandingPage({
  userOverride,
  roleDefault,
  profileDefault,
  companyDefault,
  deviceProfile = "admin",
  enabledModules = new Set(),
  permissions = [],
  isAdmin = false,
  isSuperadmin = false,
} = {}) {
  const profileFallback = profileDefault || (String(deviceProfile).toLowerCase() === "till" ? "pos" : "dashboard");
  const candidates = [userOverride, roleDefault, profileFallback, companyDefault, "dashboard", "pos"];
  const selected = candidates.find((candidate) => canAccessDestination(candidate, {
    enabledModules,
    permissions,
    isAdmin,
    isSuperadmin,
  }));
  return destinationFor(selected)?.path || null;
}

export function resolveLandingFlow({ flow, user = {}, deviceProfile = "admin", fallback = null } = {}) {
  const rules = Array.isArray(flow?.rules) ? flow.rules : [];
  const profile = String(deviceProfile || "admin").toLowerCase();
  const values = {
    user_id: String(user.id || ""),
    role_id: String(user.roleId || user.role_id || ""),
    profile: String(user.profile || user.profileKey || profile).toLowerCase(),
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
    if (conditions.every(matches) && typeof rule?.destination === "string" && rule.destination.startsWith("/app")) {
      return rule.destination;
    }
  }
  return typeof flow?.defaultDestination === "string" && flow.defaultDestination.startsWith("/app")
    ? flow.defaultDestination
    : fallback;
}
