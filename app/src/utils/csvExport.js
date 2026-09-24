/**
 * Convert a value to a safe CSV cell. Escapes commas, quotes and newlines
 * per RFC 4180 (values containing these are wrapped in double quotes).
 */
function escapeCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Build a valid CSV string from headers + rows.
 */
export function buildCsv(headers, rows) {
  const lines = [
    (headers || []).map(escapeCell).join(","),
    ...(rows || []).map((row) => (row || []).map(escapeCell).join(",")),
  ];
  return lines.join("\r\n");
}

/**
 * Generate a CSV from headers + rows and trigger a browser download.
 * Filename defaults to `onePOS-export-<date>.csv` unless `name` is given
 * (e.g. "sales" -> `onePOS-sales.csv`).
 */
export function exportCsv(headers, rows, name) {
  const csv = buildCsv(headers, rows);
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `onePOS-${name || "export"}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}