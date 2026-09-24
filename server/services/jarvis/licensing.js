/*
 * JARVES user/licence control (internal configuration foundation).
 *
 * A company may license a fixed number of JARVES users. The allowance lives in
 * the EXISTING company_settings table (jarves_licence_users, default 0 =
 * nobody); per-user opt-in lives on the EXISTING users table
 * (users.jarves_enabled). No billing, no external licence verification and no
 * second permission system - this is plain configuration the admin controls.
 *
 * Rules pinned by tests:
 *   - an unset/zero allowance means NO user can be JARVES-enabled;
 *   - the enabled count can never exceed the allowance (enabling a user when
 *     the count is at the allowance is refused with ALLOWANCE_REACHED);
 *   - lowering the allowance below the current enabled count is refused
 *     (ALLOWANCE_BELOW_ENABLED): existing users are never silently disabled;
 *   - every query is scoped by company_id - company A can never read or change
 *     company B's licence state.
 *
 * `db` is the EXISTING server.js query helper, injected for testability.
 */

export const JARVES_MAX_ALLOWANCE = 10000;

/** Allowance result codes (route maps them to HTTP statuses/messages). */
export const JARVES_ALLOWANCE_RESULTS = Object.freeze({
  OK: "ok",
  ALLOWANCE_REACHED: "allowance_reached",
  ALLOWANCE_BELOW_ENABLED: "allowance_below_enabled",
  USER_NOT_FOUND: "user_not_found",
  ALREADY_SET: "already_set",
});

/** Normalise an admin-supplied allowance to a safe integer, or null if invalid. */
export function normalizeJarvesAllowance(value) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > JARVES_MAX_ALLOWANCE) return null;
  return parsed;
}

/** Count of ACTIVE users with JARVES enabled for one company. */
export async function countJarvesEnabledUsers(db, companyId) {
  const result = await db(
    `SELECT COUNT(*)::int AS enabled FROM users WHERE company_id = $1 AND jarves_enabled = TRUE AND active = TRUE`,
    [companyId]
  );
  return Number(result.rows[0]?.enabled ?? 0);
}

/** Company licence allowance (0 when never configured - JARVES is opt-in). */
export async function getJarvesAllowance(db, companyId) {
  const result = await db(
    `SELECT jarves_licence_users FROM company_settings WHERE company_id = $1`,
    [companyId]
  );
  return Number(result.rows[0]?.jarves_licence_users ?? 0);
}

/** { allowance, enabledUsers, seatsRemaining } for one company - admin UI + enforcement. */
export async function getJarvesLicenceState(db, companyId) {
  const allowance = await getJarvesAllowance(db, companyId);
  const enabledUsers = await countJarvesEnabledUsers(db, companyId);
  return { allowance, enabledUsers, seatsRemaining: Math.max(allowance - enabledUsers, 0) };
}

/** Is JARVES enabled for this specific user (company-scoped, active only)? */
export async function isJarvesEnabledForUser(db, { userId, companyId } = {}) {
  if (!userId || !companyId) return false;
  const result = await db(
    `SELECT 1 FROM users WHERE id = $1 AND company_id = $2 AND jarves_enabled = TRUE AND active = TRUE LIMIT 1`,
    [userId, companyId]
  );
  return result.rows.length > 0;
}

/**
 * Set the company allowance. Refuses to go below the current enabled count so
 * existing users are never silently stripped - the admin must disable users
 * first. Returns a JARVES_ALLOWANCE_RESULTS code.
 */
export async function setJarvesAllowance(db, companyId, allowance, updatedBy = null) {
  const safeAllowance = normalizeJarvesAllowance(allowance);
  if (safeAllowance == null) return JARVES_ALLOWANCE_RESULTS.ALLOWANCE_BELOW_ENABLED; // invalid input

  const enabledUsers = await countJarvesEnabledUsers(db, companyId);
  if (safeAllowance < enabledUsers) return JARVES_ALLOWANCE_RESULTS.ALLOWANCE_BELOW_ENABLED;

  await db(
    `INSERT INTO company_settings (company_id, jarves_licence_users, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (company_id) DO UPDATE SET jarves_licence_users = $2, updated_by = $3, updated_at = NOW()`,
    [companyId, safeAllowance, updatedBy]
  );
  return JARVES_ALLOWANCE_RESULTS.OK;
}

/**
 * Enable/disable JARVES for one user, company-scoped. Enabling is refused when
 * the allowance is already fully used. Returns a JARVES_ALLOWANCE_RESULTS code.
 */
export async function setJarvesUserEnabled(db, { companyId, userId, enabled }) {
  if (typeof enabled !== "boolean") return JARVES_ALLOWANCE_RESULTS.USER_NOT_FOUND;

  if (enabled) {
    const state = await getJarvesLicenceState(db, companyId);
    const already = await isJarvesEnabledForUser(db, { userId, companyId });
    if (!already && state.seatsRemaining <= 0) return JARVES_ALLOWANCE_RESULTS.ALLOWANCE_REACHED;
  }

  const result = await db(
    `UPDATE users SET jarves_enabled = $1, updated_at = NOW()
     WHERE id = $2 AND company_id = $3
     RETURNING id, username, jarves_enabled`,
    [enabled, userId, companyId]
  );
  if (!result.rows.length) return JARVES_ALLOWANCE_RESULTS.USER_NOT_FOUND;
  return JARVES_ALLOWANCE_RESULTS.OK;
}

/**
 * The per-request access checker the JARVES route uses. Built once in
 * server.js with the existing db helper. Returns true only when the
 * authenticated user is company-scoped AND explicitly enabled for JARVES.
 */
export function createJarvesAccessChecker({ db } = {}) {
  if (typeof db !== "function") {
    throw new Error("createJarvesAccessChecker requires the existing db helper");
  }
  return function jarvesAccess(user = {}) {
    return isJarvesEnabledForUser(db, { userId: user?.id, companyId: user?.companyId });
  };
}