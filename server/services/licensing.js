const DEFAULT_ENTITLEMENTS = Object.freeze({
  pos: true,
  inventory: true,
  purchasing: true,
  customers: true,
  reports: true,
  self_checkout: false,
  loyalty: false,
  jarvis: false,
  crm: false,
  credit_control: false,
  online_orders: false,
  kds: false,
});

export function normaliseEntitlements(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(Object.entries(source)
    .filter(([key, enabled]) => /^[a-z][a-z0-9_.-]{0,80}$/i.test(key) && typeof enabled === "boolean")
    .map(([key, enabled]) => [key, enabled]));
}

export function mergeEntitlements(value = {}) {
  return { ...DEFAULT_ENTITLEMENTS, ...normaliseEntitlements(value) };
}

export async function getCompanyEntitlements(db, companyId) {
  if (!companyId) return {};
  const result = await db(
    `SELECT l.active, l.starts_at, l.expires_at,
            COALESCE(jsonb_object_agg(le.entitlement_key, le.enabled)
              FILTER (WHERE le.entitlement_key IS NOT NULL), '{}'::jsonb) AS entitlements
       FROM companies c
       LEFT JOIN licences l ON l.id = c.licence_id
       LEFT JOIN licence_entitlements le ON le.licence_id = l.id
      WHERE c.id = $1
      GROUP BY l.id`,
    [companyId]
  );
  const row = result.rows[0];
  if (!row || row.active !== true ||
      (row.starts_at && new Date(row.starts_at) > new Date()) ||
      (row.expires_at && new Date(row.expires_at) < new Date())) return {};
  return mergeEntitlements(row.entitlements);
}

export async function getUserLicenceState(db, companyId, userId) {
  if (!companyId || !userId) return { active: false, reason: "UNASSIGNED" };
  const result = await db(
    `SELECT a.active AS assignment_active, a.starts_at AS assignment_starts_at, a.expires_at AS assignment_expires_at,
            l.id AS licence_id, l.name AS licence_name, l.active AS licence_active,
            l.starts_at AS licence_starts_at, l.expires_at AS licence_expires_at
       FROM user_licence_assignments a
       JOIN licences l ON l.id=a.licence_id
      WHERE a.company_id=$1 AND a.user_id=$2
      LIMIT 1`,
    [companyId, userId]
  );
  const row = result.rows[0];
  if (!row) return { active: false, reason: "UNASSIGNED" };
  const now = Date.now();
  const before = (v) => v && new Date(v).getTime() > now;
  const expired = (v) => v && new Date(v).getTime() <= now;
  if (row.assignment_active !== true || row.licence_active !== true) return { ...row, active: false, reason: "INACTIVE" };
  if (before(row.assignment_starts_at) || before(row.licence_starts_at)) return { ...row, active: false, reason: "NOT_STARTED" };
  if (expired(row.assignment_expires_at) || expired(row.licence_expires_at)) return { ...row, active: false, reason: "EXPIRED" };
  return { ...row, active: true, reason: "ACTIVE" };
}

export async function hasActiveUserLicence(db, companyId, userId) {
  return (await getUserLicenceState(db, companyId, userId)).active === true;
}

export function hasEntitlement(entitlements, key) {
  return entitlements?.[key] === true;
}

export function isPackageLicensed(entitlements, packageEntry = {}) {
  const key = packageEntry?.manifest?.entitlementKey;
  return !key || hasEntitlement(entitlements, key);
}

export function requireEntitlement(db, key) {
  return async (req, res, next) => {
    try {
      const entitlements = await getCompanyEntitlements(db, req.user?.companyId);
      if (!hasEntitlement(entitlements, key)) {
        return res.status(403).json({ success: false, code: "FEATURE_NOT_LICENSED", message: "This feature is not licensed for this company" });
      }
      req.entitlements = entitlements;
      return next();
    } catch (error) {
      console.error(`Licensing check failed for ${key}:`, error);
      return res.status(500).json({ success: false, message: "Unable to verify feature licence" });
    }
  };
}

export { DEFAULT_ENTITLEMENTS };
