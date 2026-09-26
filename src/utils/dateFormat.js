/*
 * THE shared user-facing date formatter.
 *
 * Every date shown to a user (list columns, report tables, chart axes,
 * record views) goes through here — never a raw ISO string like
 * "2026-09-25T23:00:00.000Z". The pattern honours the company's configured
 * date format (Settings → General → Date format, e.g. "DD/MM/YYYY") cached
 * from /api/settings; defaults to DD/MM/YYYY before settings arrive.
 */

let cachedPattern = null;

/** Called by the settings layer when the company settings load/change. */
export function setDateFormatPattern(pattern) {
  const value = String(pattern || "").trim();
  cachedPattern = value && /\d/.test(value.replace(/[DMY]/gi, "")) ? value : null;
}

function patternTokens(pattern) {
  const p = String(pattern || "").toUpperCase();
  const day = p.includes("DD") ? "2-digit" : "numeric";
  const month = p.includes("MMM") ? "short" : p.includes("MM") ? "2-digit" : "numeric";
  let year = "numeric";
  if (p.includes("YY") && !p.includes("YYYY")) year = "2-digit";
  return { day, month, year };
}

/** "2026-09-25T23:00:00.000Z" → per configured pattern; "" when absent. */
export function formatDateValue(value, { withTime = false, pattern } = {}) {
  if (value === null || value === undefined || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  const tokens = patternTokens(pattern || cachedPattern || "DD/MM/YYYY");
  const dateText = new Intl.DateTimeFormat("en-GB", {
    day: tokens.day,
    month: tokens.month,
    year: tokens.year,
  }).format(date);
  if (!withTime) return dateText;
  const timeText = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${dateText} ${timeText}`;
}

/** For chart tick axes: trims to just the day/month when the span is days. */
export function formatAxisDateValue(value) {
  return formatDateValue(value, { pattern: cachedPattern || "DD MMM" });
}
