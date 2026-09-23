const DEFAULT_ENTITLEMENTS = Object.freeze({
  pos: true,
  inventory: true,
  purchasing: true,
  customers: true,
  reports: true,
  self_checkout: false,
  loyalty: false,
  jarvis: false,
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
