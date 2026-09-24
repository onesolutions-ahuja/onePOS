/*
 * T10R - Wastage & Breakage reason helpers (shared server + tests).
 *
 * No new ledger, no new table, no new permission: decreases keep writing the
 * SAME inventory_movements row (ADJUSTMENT_OUT) via the SAME
 * createInventoryMovement path. This module only classifies the free-text
 * `reason` column into the canonical buckets the report filters on:
 * Wastage / Breakage / Other. Legacy rows (any other reason text) read as
 * "Other" so existing history keeps working untouched.
 */

export const ADJUSTMENT_REASONS = ["Wastage", "Breakage", "Other"];

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

/* Canonical bucket for a stored reason string. */
export function classifyAdjustmentReason(reason) {
  const v = norm(reason);
  if (v === "wastage" || v === "wasted" || v === "waste") return "Wastage";
  if (v === "breakage" || v === "broken" || v === "damage" || v === "damaged") return "Breakage";
  return "Other";
}

/*
 * Validate the reason supplied with an adjustment.
 * - Increases: any reason (including blank) still allowed, exactly as before.
 * - Decreases: require one of Wastage / Breakage / Other (case-insensitive).
 *   Known legacy aliases ("damaged", "waste", ...) are canonicalised so
 *   existing callers keep working. An optional detail suffix
 *   ("Wastage - expired milk") is accepted: the canonical label is stored
 *   in `reason` (so report filters keep matching) and the detail is
 *   returned for the caller to preserve in `notes`.
 *   Returns { reason, detail } or { error }.
 */
export function resolveAdjustmentReason(adjustmentQuantity, reason) {
  const qty = Number(adjustmentQuantity);
  if (!Number.isFinite(qty) || qty >= 0) return reason ?? null;
  const text = String(reason || "").trim();
  if (!text) return { error: "A reason is required for stock decreases: Wastage, Breakage or Other" };
  const head = text.split(/\s[-–:]\s/)[0].trim();
  const v = head.toLowerCase();
  const found =
    ADJUSTMENT_REASONS.find((r) => r.toLowerCase() === v) ||
    (["waste", "wasted"].includes(v) ? "Wastage" : null) ||
    (["broken", "damage", "damaged"].includes(v) ? "Breakage" : null);
  if (!found) return { error: "Reason must be one of: Wastage, Breakage, Other" };
  const detail = text.slice(head.length).replace(/^\s[-–:]\s*/, "").trim() || null;
  return { reason: found, detail };
}

export default { ADJUSTMENT_REASONS, classifyAdjustmentReason, resolveAdjustmentReason };
