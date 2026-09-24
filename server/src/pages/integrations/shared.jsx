/*
 * T9M - shared constants + tiny UI atoms for the Integration module.
 * Kept dependency-free so every page/component in this folder can import
 * the same vocabulary the backend validates against.
 */

export const AUTH_TYPES = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer token" },
  { value: "api_key", label: "API key" },
  { value: "basic", label: "Basic auth" },
];

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/* entity_type values accepted by the backend endpoints API. The dispatcher
 * maps events to these: SALE_CREATED->sale, PURCHASE_CREATED/RECEIVED->purchase,
 * SALES_RETURN_CREATED->custom (1:1 by design). */
export const ENTITY_TYPES = ["sale", "purchase", "product", "customer", "custom"];

export const ENTITY_EVENT_HINT =
  "Events: sale = SALE_CREATED · purchase = PURCHASE_CREATED / PURCHASE_RECEIVED · custom = SALES_RETURN_CREATED";

export function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function safeParse(text) {
  try { return JSON.parse(text); } catch { return text; }
}

/* Success/error flash banner used across the module. */
export function Flash({ message, error }) {
  if (!message && !error) return null;
  return message ? (
    <div className="mb-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{message}</div>
  ) : (
    <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
  );
}

/* Enabled/disabled pill with a status dot. */
export function StatusPill({ enabled, extra }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
      {enabled ? "Enabled" : "Disabled"}
      {extra ? ` · ${extra}` : ""}
    </span>
  );
}
