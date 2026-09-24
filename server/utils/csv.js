/*
 * Server-side CSV building (RFC 4180) — the backend twin of
 * src/utils/csvExport.js (which also drives the browser download).
 * Kept separate so the server never imports browser-only modules.
 */

/** Convert a value to a safe CSV cell (commas, quotes, newlines escaped). */
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[\",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Build a valid CSV string from headers + rows of cells. */
export function buildCsv(headers, rows) {
  const lines = [
    (headers || []).map(escapeCell).join(","),
    ...(rows || []).map((row) => (row || []).map(escapeCell).join(",")),
  ];
  return lines.join("\r\n");
}
