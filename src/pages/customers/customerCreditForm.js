/*
 * PHASE 2 — Customer Credit "Maximum Credit Age (days)" form helper.
 *
 * Pure serialization for the Customer Credit modal's maximum-credit-age
 * input, kept in a plain JS module so it can be unit-tested directly
 * (node --test) without a JSX transform.
 *
 * Contract (matches the backend PUT /api/customers/:id/credit validation):
 *  - blank / null / undefined → { value: null }   (no ageing restriction)
 *  - whole number >= 0        → { value: number }
 *  - anything else            → invalid, with a user-facing message
 */

export function serializeMaximumAgeDays(rawValue) {
  const trimmed = String(rawValue ?? "").trim();
  if (trimmed === "") return { valid: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return {
      valid: false,
      value: null,
      error: "Maximum credit age must be a whole number of days or left blank for no restriction",
    };
  }
  return { valid: true, value: n };
}

/*
 * Customer Credit Management — payment amount validation.
 *
 * Pure client-side mirror of the backend contract
 * (POST /api/customers/:id/credit/payments):
 *  - amount must be a finite number greater than zero
 *  - amount must not exceed the outstanding balance (when known)
 *
 * The backend remains authoritative: overpayments are rejected server-side
 * with 409 "Payment exceeds the outstanding balance". This helper only
 * prevents the obviously-invalid submit so the UI can show the same message
 * without a round trip.
 *
 * outstanding may be null/undefined when unknown — then only the
 * positive-amount check applies.
 */

export function validateCreditPaymentAmount(rawValue, outstanding) {
  const trimmed = String(rawValue ?? "").trim();
  const amount = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(amount) || amount <= 0) {
    return {
      valid: false,
      value: null,
      error: "Payment amount must be greater than zero",
    };
  }
  if (outstanding !== null && outstanding !== undefined && outstanding !== "") {
    const outstandingNum = Number(outstanding);
    if (
      Number.isFinite(outstandingNum) &&
      Math.round(amount * 100) > Math.round(outstandingNum * 100)
    ) {
      return {
        valid: false,
        value: null,
        error: "Payment exceeds the outstanding balance",
      };
    }
  }
  return { valid: true, value: Math.round(amount * 100) / 100 };
}
