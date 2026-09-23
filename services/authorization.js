/**
 * ONE authoritative statement of onePOS authorization semantics.
 *
 * Everything that needs to know "is this caller a Platform Superadmin?" or
 * "may this caller reach this runtime module?" resolves it HERE, so the rule
 * cannot drift between the navigation filter, the runtime app catalogue, the
 * route guards and the tenant/store scoping helpers.
 *
 * Two distinct concepts are kept deliberately separate:
 *
 *   PLATFORM DEVELOPER SUPERADMIN — the platform-level operator account
 *                          (users.is_superadmin). Highest onePOS
 *                          administrative account with full CRUD access across
 *                          company/platform surfaces and database lifecycle
 *                          management.
 *   COMPANY ADMIN        — an Administrator/Admin/Owner role inside ONE
 *                          company. Administrative, but never platform-wide.
 *
 * A Company Admin is never treated as a Superadmin, and the Superadmin bypass
 * applies only to the permission/entitlement gates — never to tenant scope.
 */

/**
 * Platform Superadmin detection.
 *
 * Accepts either a user-ish object (the DB column `is_superadmin` or the API
 * field `isSuperadmin`) or an explicit `{ isSuperadmin }` flag, so every call
 * site can use the same predicate without normalising first.
 */
export function isPlatformSuperadmin(subject) {
  if (!subject || typeof subject !== "object") return false;
  return subject.isSuperadmin === true || subject.is_superadmin === true;
}

export const PLATFORM_DEVELOPER_SUPERADMIN = "Platform Developer Superadmin";

/**
 * Shared permission decision for normal application functionality.
 *
 * Superadmin is a global bypass; every other user must satisfy at least one
 * of the permissions required by the operation.
 */
export function permissionAllows({ isSuperadmin = false, permissions = [], requiredPermissions = [] } = {}) {
  if (isSuperadmin === true) return true;
  return requiredPermissions.some((permission) => permissions.includes(permission));
}

/** Reasons a runtime catalogue module can be hidden from a caller. */
export const MODULE_ACCESS_REASONS = Object.freeze({
  ALLOWED: "entitled",
  ALLOWED_SUPERADMIN: "superadmin_management",
  COMPANY_DISABLED: "company_disabled",
  NOT_PERMITTED: "not_permitted",
  PACKAGE_NOT_INSTALLED: "package_not_installed",
  NOT_LICENSED: "not_licensed",
});

/**
 * Decide whether ONE module of the runtime application catalogue is reachable
 * by the caller.
 *
 * This is the single place the Platform Superadmin's runtime rule is written.
 *
 * The gates mean different things, which is why they are not collapsed:
 *
 *   enabledByCompany  the tenant's EXPLICIT operational switch. Honoured for
 *                     EVERY caller, Superadmin included — a module the company
 *                     switched off must not come back as a working page just
 *                     because the operator is a Superadmin. Module
 *                     administration is reached through the platform
 *                     management endpoints, which these runtime gates do not
 *                     guard.
 *
 *   permitted         the ordinary permission model (Superadmin bypasses it;
 *                     that is the pre-existing, intended behaviour).
 *
 *   packageInstalled  what the company has BOUGHT (an active
 *   licensed          company_package_installations row / a licence
 *                     entitlement). These describe the company's ENTITLEMENT.
 *
 * The Platform Superadmin is the account that GRANTS entitlements, so it must
 * be able to reach a module's surfaces even when its own company has neither a
 * package installation nor a licence — otherwise the operator's own company
 * (which typically has no licence rows at all) sees an empty platform. That is
 * a MANAGEMENT capability.
 *
 * It is deliberately NOT a runtime entitlement: for every other caller the
 * entitlement gates apply exactly as before, so an unlicensed company never
 * behaves as licensed for ordinary users.
 *
 * @returns {{allowed: boolean, reason: string}}
 */
export function moduleRuntimeAccess({
  enabledByCompany = true,
  packageInstalled = false,
  licensed = false,
  permitted = false,
  isSuperadmin = false,
} = {}) {
  if (enabledByCompany === false) {
    return { allowed: false, reason: MODULE_ACCESS_REASONS.COMPANY_DISABLED };
  }
  if (permitted !== true) {
    return { allowed: false, reason: MODULE_ACCESS_REASONS.NOT_PERMITTED };
  }
  if (isSuperadmin === true) {
    /* Entitlement gates describe what the company owns; the Superadmin
       administers that, so both are bypassed for MANAGEMENT only. */
    return {
      allowed: true,
      reason:
        packageInstalled && licensed
          ? MODULE_ACCESS_REASONS.ALLOWED
          : MODULE_ACCESS_REASONS.ALLOWED_SUPERADMIN,
    };
  }
  if (!packageInstalled) {
    return { allowed: false, reason: MODULE_ACCESS_REASONS.PACKAGE_NOT_INSTALLED };
  }
  if (!licensed) {
    return { allowed: false, reason: MODULE_ACCESS_REASONS.NOT_LICENSED };
  }
  return { allowed: true, reason: MODULE_ACCESS_REASONS.ALLOWED };
}

/** Convenience boolean form of {@link moduleRuntimeAccess}. */
export function isModuleRuntimeAccessible(options) {
  return moduleRuntimeAccess(options).allowed === true;
}

/**
 * Administrative access inside the caller's OWN company.
 *
 * This is the single predicate behind the "Administrator permission required"
 * gates. It is held by a Company Administrator/Admin/Owner role AND by a
 * Platform Superadmin: the platform operator has to be able to administer
 * company-level surfaces (stores, tills, users, customer records) even though
 * its own role is not named "Administrator", and the runtime-access model must
 * not reject it with a 403 on a page it is allowed to reach.
 *
 * It is deliberately NOT the same thing as the company-admin ROLE lookup
 * (`canViewCompanyCustomers` in server.js), because that helper ALSO drives
 * DATA SCOPE decisions (company-wide vs store-restricted reads) in
 * customers.js and reports.js — widening it would silently change query scope.
 * This predicate answers only the access question.
 *
 * The company context is always the caller's own, so this is never a
 * cross-tenant grant; the caller's role and the superadmin flag are resolved
 * server-side and passed in.
 */
export function companyAdministrativeAccess({ isCompanyAdminRole = false, isSuperadmin = false } = {}) {
  return isCompanyAdminRole === true || isSuperadmin === true;
}
