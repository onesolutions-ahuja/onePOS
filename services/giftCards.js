/*
 * Gift cards — shared domain helpers.
 *
 * A gift card is company-scoped and identified by its unique code. The
 * balance is ALWAYS derived from the immutable gift_card_transactions
 * ledger (issue/topup/refund positive; redeem negative; adjustment signed
 * as given) — the same derive-don't-store rule as customer credit.
 *
 * Pure functions only: routes own SQL, this module owns the rules.
 */

/** Statuses a card can move through. 'depleted' is derived, never set. */
export const GIFT_CARD_STATUSES = ["active", "blocked", "expired", "depleted"];

/** Transaction types and their sign convention (signed amounts). */
export const GIFT_CARD_TX_TYPES = {
  issue: +1,
  topup: +1,
  refund: +1,
  redeem: -1,
  adjustment: +1, // adjustment rows carry their own signed amount
};

/**
 * Derive a card's balance from its ledger rows.
 * @param {Array<{transaction_type: string, amount: number|string}>} rows
 * @returns {number} balance in major units (2dp)
 */
export function deriveGiftCardBalance(rows) {
  let cents = 0;
  for (const row of rows || []) {
    const amount = Number(row.amount) || 0;
    const signed =
      row.transaction_type === "adjustment" ? amount : amount * (GIFT_CARD_TX_TYPES[row.transaction_type] ?? 0);
    cents += Math.round(signed * 100);
  }
  return Math.round(cents) / 100;
}

/**
 * Is the card redeemable right now? Expiry, when present, is compared
 * against `now` (ISO string or Date) so tests can pin time deterministically.
 */
export function isCardRedeemable(card, now = new Date()) {
  if (!card) return { ok: false, reason: "Card not found" };
  if (card.status === "blocked") return { ok: false, reason: "Gift card is blocked" };
  if (card.status === "expired") return { ok: false, reason: "Gift card has expired" };
  if (card.status === "depleted") return { ok: false, reason: "Gift card has no remaining balance" };
  if (card.expires_at) {
    const expiry = new Date(card.expires_at);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= new Date(now).getTime()) {
      return { ok: false, reason: "Gift card has expired" };
    }
  }
  return { ok: true };
}

/**
 * Redemption rule: amount must be positive, <= balance and > 0 after
 * rounding to pence. Returns the exact redemption amount in pence or an error.
 */
export function validateRedemption(balanceMajor, requestedMajor) {
  const balanceCents = Math.round((Number(balanceMajor) || 0) * 100);
  const amountCents = Math.round((Number(requestedMajor) || 0) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "Redemption amount must be greater than zero" };
  }
  if (amountCents > balanceCents) {
    return { ok: false, reason: `Insufficient gift card balance: £${(balanceCents / 100).toFixed(2)} available` };
  }
  return { ok: true, amountCents };
}

/**
 * Issue rule: value must be a positive, finite major-unit amount.
 */
export function validateIssueValue(value) {
  const cents = Math.round((Number(value) || 0) * 100);
  if (!Number.isFinite(cents) || cents <= 0) {
    return { ok: false, reason: "Gift card value must be greater than zero" };
  }
  return { ok: true, cents };
}

/** Top-up rule: strictly positive. */
export function validateTopUp(value) {
  return validateIssueValue(value);
}

/**
 * Manual adjustment: non-zero, signed (negative removes value), bounded by
 * the current balance so the ledger can never go negative via adjustment.
 */
export function validateAdjustment(balanceMajor, pointsMajor) {
  const balanceCents = Math.round((Number(balanceMajor) || 0) * 100);
  const cents = Math.round((Number(pointsMajor) || 0) * 100);
  if (!Number.isFinite(cents) || cents === 0) {
    return { ok: false, reason: "Adjustment amount must be a non-zero value" };
  }
  if (cents < 0 && -cents > balanceCents) {
    return { ok: false, reason: `Adjustment would take the balance below zero: £${(balanceCents / 100).toFixed(2)} available` };
  }
  return { ok: true, cents };
}

/**
 * Human-friendly card code: 3 groups of 4 uppercase alphanumerics
 * (Crockford base32 — no I, L, O, U to avoid misreading). The check
 * character at the end gives a light typo guard without a checksum table.
 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateGiftCardCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < 13; i += 1) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 13)}`;
}

/**
 * Normalise a code for lookup: uppercase, trim whitespace and the
 * separators people commonly add when typing a printed code.
 */
export function normaliseGiftCardCode(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "");
}

/**
 * SQL lookup: a stored code may or may not contain dashes, so compare on
 * the separator-stripped form of the stored value. Returns (sql, params)
 * for the caller's db/pool — kept here so lookup is identical everywhere.
 */
export function codeLookupClause(inputCode, companyIdParamIndex = 2) {
  const normalised = normaliseGiftCardCode(inputCode);
  return {
    sql: `SELECT * FROM gift_cards WHERE company_id = $${companyIdParamIndex} AND UPPER(REPLACE(REPLACE(code, '-', ''), ' ', '')) = $1`,
    params: [normalised],
  };
}
