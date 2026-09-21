/*
 * JARVIS AI assistant - session/permission context (V1).
 *
 * JARVIS must know WHO is asking: the authenticated user, their company, the
 * store where available, and the permission codes they hold. V1 uses the
 * EXISTING onePOS session (`req.user` from services/session.js) and the
 * EXISTING permissions model (`role_permissions` -> `permissions.code`,
 * the same lookup server.js uses) - no second user or permission system.
 *
 * This module is the single place that decides what JARVIS may know about the
 * caller. V2 (jarvis permissions/) will extend it into per-tool permission
 * checks; the field names below stay the same.
 */

/**
 * Non-secret identity of the authenticated session. Values are taken from the
 * verified JWT claims only - the client can never choose a company/store.
 */
export function buildJarvisSessionContext(user = {}) {
  return {
    userId: user?.id ?? null,
    username: user?.username ?? null,
    companyId: user?.companyId ?? null,
    storeId: user?.storeId ?? null,
    roleId: user?.roleId ?? null,
    permissions: [],
  };
}

/**
 * Resolve the caller's permission codes. READ-ONLY, best-effort: a lookup
 * failure must never block a JARVIS question, it just means JARVIS is told
 * that no permissions could be resolved.
 */
export async function resolveJarvisPermissions(user = {}, { getRolePermissionCodes } = {}) {
  const roleId = user?.roleId;
  if (!roleId || typeof getRolePermissionCodes !== "function") return [];
  try {
    const codes = await getRolePermissionCodes(roleId);
    return Array.isArray(codes) ? codes.filter((code) => typeof code === "string" && code.trim()) : [];
  } catch (error) {
    console.error("JARVIS permission lookup failed:", (error && error.message) || error);
    return [];
  }
}

/** Full JARVIS context for one authenticated request. */
export async function buildJarvisRequestContext(user, { getRolePermissionCodes } = {}) {
  const context = buildJarvisSessionContext(user);
  context.permissions = await resolveJarvisPermissions(user, { getRolePermissionCodes });
  return context;
}
