export const BATCH_INVENTORY_MODES = {
  REQUIRED_DATES: "required_dates",
  OPTIONAL_DATES: "optional_dates",
  NONE: "none",
};

const DATE_RULES = new Set(["none", "today", "today_plus_days"]);

export function normaliseBatchPolicy(row = {}) {
  const mode = Object.values(BATCH_INVENTORY_MODES).includes(row.batch_inventory_mode)
    ? row.batch_inventory_mode
    : BATCH_INVENTORY_MODES.NONE;
  const mfgRule = DATE_RULES.has(row.batch_default_mfg_rule) ? row.batch_default_mfg_rule : "none";
  const expiryRule = DATE_RULES.has(row.batch_default_expiry_rule) ? row.batch_default_expiry_rule : "none";
  const expiryDays = Number.isInteger(Number(row.batch_default_expiry_days)) && Number(row.batch_default_expiry_days) >= 0
    ? Number(row.batch_default_expiry_days)
    : 365;
  return { mode, defaultMfgRule: mfgRule, defaultExpiryRule: expiryRule, defaultExpiryDays: expiryDays };
}

export function applyBatchDateRule(value, rule, days = 365, today = new Date()) {
  if (value) return { value: String(value).slice(0, 10), source: "ACTUAL" };
  if (rule === "none") return { value: null, source: null };
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (rule === "today_plus_days") date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return { value: date.toISOString().slice(0, 10), source: "DEFAULT" };
}

export function resolveBatchEntry(policy, { productBatchTracking = false, batchNumber, manufacturingDate, expiryDate } = {}) {
  const effective = policy?.mode === BATCH_INVENTORY_MODES.NONE ? BATCH_INVENTORY_MODES.NONE : policy?.mode || BATCH_INVENTORY_MODES.NONE;
  const enabled = effective !== BATCH_INVENTORY_MODES.NONE && productBatchTracking;
  if (!enabled) return { batchNumber: null, manufacturingDate: null, expiryDate: null, manufacturingDateSource: null, expiryDateSource: null };
  const number = batchNumber == null ? "" : String(batchNumber).trim();
  if (!number) throw new Error("Batch number is required");
  if (effective === BATCH_INVENTORY_MODES.REQUIRED_DATES && (!manufacturingDate || !expiryDate)) {
    throw new Error("Manufacturing date and expiry date are required");
  }
  const mfg = applyBatchDateRule(manufacturingDate, policy.defaultMfgRule);
  const expiry = applyBatchDateRule(expiryDate, policy.defaultExpiryRule, policy.defaultExpiryDays);
  if (effective === BATCH_INVENTORY_MODES.REQUIRED_DATES && (!mfg.value || !expiry.value)) {
    throw new Error("Manufacturing date and expiry date are required");
  }
  return { batchNumber: number, manufacturingDate: mfg.value, expiryDate: expiry.value, manufacturingDateSource: mfg.source, expiryDateSource: expiry.source };
}

export async function loadBatchPolicy(db, companyId) {
  const result = await db(
    "SELECT batch_inventory_mode, batch_default_mfg_rule, batch_default_expiry_rule, batch_default_expiry_days FROM company_settings WHERE company_id=$1",
    [companyId]
  );
  return normaliseBatchPolicy(result.rows[0]);
}
