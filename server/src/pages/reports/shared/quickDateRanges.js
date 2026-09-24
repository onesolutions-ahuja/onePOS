/**
 * Reusable quick date-range calculations for Reports.
 *
 * All values are plain local calendar dates ("YYYY-MM-DD" strings) suitable
 * for <input type="date"> pickers — no UTC conversion, no timezone drift.
 * No external date library is used.
 *
 * UK-style fiscal year: 6 April -> 5 April.
 * e.g. on 20 Sep 2026 the fiscal year runs 6 Apr 2026 -> 20 Sep 2026 (to = today).
 */

/** Weeks start on Monday (UK convention). 0 = Sunday ... 6 = Saturday. */
const WEEK_START_MONDAY = 1;

/** Month/day the UK fiscal year starts: 6 April. */
const FISCAL_START_MONTH = 3; // JS months are 0-based; 3 = April
const FISCAL_START_DAY = 6;

/** Format a Date as a local "YYYY-MM-DD" string without any UTC conversion. */
export function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Parse a "YYYY-MM-DD" string as a local calendar date (not UTC). */
export function fromLocalDateString(value) {
  if (typeof value !== "string") return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

/** Add days to a "YYYY-MM-DD" string, staying on the local calendar. */
export function addDays(dateString, days) {
  const date = fromLocalDateString(dateString) || new Date();
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

/**
 * Start of the current week containing `now` (local calendar).
 * Weeks run Monday -> Sunday (UK convention).
 */
export function startOfWeek(now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (date.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  date.setDate(date.getDate() - daysSinceMonday);
  return date;
}

/** First day of the current calendar quarter containing `now` (local calendar). */
export function startOfQuarter(now = new Date()) {
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3; // Jan/Apr/Jul/Oct
  return new Date(now.getFullYear(), quarterStartMonth, 1);
}

/**
 * First day of the current UK fiscal year (6 April -> 5 April) containing `now`.
 * e.g. 20 Sep 2026 -> 6 Apr 2026; 20 Feb 2026 -> 6 Apr 2025.
 */
export function startOfFiscalYear(now = new Date()) {
  const year = now.getFullYear();
  const isBeforeAprilSixth =
    now.getMonth() < FISCAL_START_MONTH ||
    (now.getMonth() === FISCAL_START_MONTH && now.getDate() < FISCAL_START_DAY);
  const fiscalStartYear = isBeforeAprilSixth ? year - 1 : year;
  return new Date(fiscalStartYear, FISCAL_START_MONTH, FISCAL_START_DAY);
}

/**
 * All quick-range options for Reports.
 *
 * Every range ends today (the reporting "to" date), except Yesterday which
 * covers only that single day. Values are derived from a local-calendar
 * `today` so the logic is deterministic and testable.
 *
 * @param {Date} [today] Reference "now" (defaults to the actual current date).
 * @returns {Array<{ key: string, label: string, from: string, to: string }>}
 */
export function getQuickDateRanges(today = new Date()) {
  const todayStr = toLocalDateString(today);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

  return [
    { key: "today", label: "Today", from: todayStr, to: todayStr },
    { key: "yesterday", label: "Yesterday", from: toLocalDateString(yesterday), to: toLocalDateString(yesterday) },
    { key: "week", label: "This Week", from: toLocalDateString(startOfWeek(today)), to: todayStr },
    { key: "month", label: "This Month", from: toLocalDateString(new Date(today.getFullYear(), today.getMonth(), 1)), to: todayStr },
    { key: "quarter", label: "This Quarter", from: toLocalDateString(startOfQuarter(today)), to: todayStr },
    { key: "fiscalYear", label: "Fiscal Year", from: toLocalDateString(startOfFiscalYear(today)), to: todayStr },
  ];
}

/**
 * Resolve one quick range by key for the given current date values.
 * Used to keep the selected quick option in sync when the user edits
 * the From/To pickers manually.
 *
 * @param {string} key One of the range keys above.
 * @param {Date} [today] Reference "now".
 * @returns {{ from: string, to: string } | null} Null for unknown keys.
 */
export function getQuickDateRange(key, today = new Date()) {
  return getQuickDateRanges(today).find((range) => range.key === key) || null;
}
