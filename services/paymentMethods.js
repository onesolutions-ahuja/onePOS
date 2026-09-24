// Canonical payment-method registry backed by company metadata records.
// Consumers must resolve methods here instead of maintaining local tender lists.
export const DEFAULT_PAYMENT_METHODS = Object.freeze([
  { code: "cash", label: "Cash", kind: "CASH", allowOffline: true, sortOrder: 10 },
  { code: "card", label: "Card", kind: "CARD", allowOffline: false, sortOrder: 20 },
  { code: "customer_credit", label: "Customer Credit", kind: "CREDIT", allowOffline: false, sortOrder: 30 },
  { code: "gift_card", label: "Gift Card", kind: "GIFT_CARD", allowOffline: false, sortOrder: 40 },
  { code: "voucher", label: "Voucher", kind: "VOUCHER", allowOffline: false, sortOrder: 50 },
  { code: "cheque", label: "Cheque", kind: "CHEQUE", allowOffline: false, sortOrder: 60 },
  { code: "bank_transfer", label: "Bank Transfer", kind: "BANK_TRANSFER", allowOffline: false, sortOrder: 70 },
  { code: "online", label: "Online", kind: "ONLINE", allowOffline: false, sortOrder: 80 },
]);

export async function listPaymentMethods(db, companyId, { activeOnly = true } = {}) {
  if (!db || !companyId) return DEFAULT_PAYMENT_METHODS.map((item) => ({ ...item, active: true, system: true }));
  try {
    const result = await db(
      `SELECT id, code, label, kind, active, allow_offline, sort_order, config
       FROM payment_methods
       WHERE company_id=$1 ${activeOnly ? "AND active=true" : ""}
       ORDER BY sort_order, label`,
      [companyId]
    );
    if (result.rows.length) return result.rows.map((row) => ({
      id: row.id, code: row.code, label: row.label, kind: row.kind, active: row.active,
      allowOffline: row.allow_offline, sortOrder: row.sort_order, config: row.config || {}, system: false,
    }));
  } catch (error) {
    // Backward-compatible during rolling deployments before the migration runs.
    if (error?.code !== "42P01") throw error;
  }
  return DEFAULT_PAYMENT_METHODS.map((item) => ({ ...item, active: true, system: true }));
}

export async function getAllowedPaymentMethodCodes(db, companyId) {
  return (await listPaymentMethods(db, companyId)).map((item) => item.code);
}

export async function ensureDefaultPaymentMethods(db, companyId) {
  if (!db || !companyId) return;
  for (const method of DEFAULT_PAYMENT_METHODS) {
    await db(
      `INSERT INTO payment_methods (company_id,code,label,kind,active,allow_offline,sort_order)
       VALUES ($1,$2,$3,$4,true,$5,$6)
       ON CONFLICT (company_id,code) DO NOTHING`,
      [companyId, method.code, method.label, method.kind, method.allowOffline, method.sortOrder]
    );
  }
}
