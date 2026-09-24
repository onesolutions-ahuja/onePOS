/*
 * Shared constants + helpers for the Online Orders UI (Uber Eats / Deliveroo).
 *
 * Used by BOTH the full admin page (OnlineOrdersAdmin) and the restricted
 * processing view (OnlineOrdersPrep) so the lifecycle matrix, busy feedback
 * and platform naming can never drift apart.
 *
 * UI action matrix - backend lifecycle validation remains unchanged:
 *   RECEIVED  -> ACCEPTED (accept; internal workflow enters PREPARING) / REJECTED (reject)
 *   ACCEPTED  -> PREPARING is internal-only (no "Preparing" button)
 *   PREPARING -> READY (ready)
 *   READY     -> COMPLETED (complete)
 *   any active status -> CANCELLED (cancel)
 * PREPARING is a STATUS: it never offers a "Preparing" action of its own.
 * Terminal orders (COMPLETED / REJECTED / CANCELLED) offer nothing.
 */

export const ACTIVE_STATUSES = ["RECEIVED", "ACCEPTED", "PREPARING", "READY"];

export const TERMINAL_STATUSES = ["COMPLETED", "REJECTED", "CANCELLED"];

export const STATUS_BADGES = {
  RECEIVED: "bg-blue-50 text-blue-700",
  ACCEPTED: "bg-indigo-50 text-indigo-700",
  PREPARING: "bg-amber-50 text-amber-700",
  READY: "bg-emerald-50 text-emerald-700",
  COMPLETED: "bg-slate-100 text-slate-500",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-red-50 text-red-700",
};

/*
 * Every lifecycle action. `label` is the button text at rest, `busy` is the
 * text shown the instant the button is clicked, so a click is always visibly
 * acknowledged while the platform call is in flight.
 */
export const ORDER_ACTIONS = {
  accept: { label: "Accept Order", busy: "Accepting...", className: "bg-indigo-600 text-white hover:bg-indigo-700" },
  reject: { label: "Reject", busy: "Rejecting...", className: "bg-red-50 text-red-600 hover:bg-red-100" },
  ready: { label: "Mark Ready", busy: "Marking ready...", className: "bg-emerald-600 text-white hover:bg-emerald-700" },
  complete: { label: "Complete Order", busy: "Completing...", className: "bg-blue-600 text-white hover:bg-blue-700" },
  cancel: { label: "Cancel", busy: "Cancelling...", className: "bg-slate-100 text-slate-600 hover:bg-slate-200" },
};

/*
 * Which actions each status offers on the main admin page.
 * ACCEPTED orders are internally PREPARING (auto-advanced on accept); the
 * "Preparing" button is deliberately gone from the kitchen workflow.
 */
export const STATUS_ACTIONS = {
  RECEIVED: ["accept", "reject", "cancel"],
  ACCEPTED: ["ready", "cancel"],
  PREPARING: ["ready", "cancel"],
  READY: ["complete", "cancel"],
};

/*
 * Restricted processing view: only ACCEPTED / PREPARING / READY orders, and
 * only the actions of that workflow (no accept/reject of new orders, and
 * Complete is offered from READY only - it stays permission-gated separately).
 * ACCEPTED shows "Mark Ready" directly - no "Preparing" button.
 */
export const PREP_STATUS_ACTIONS = {
  ACCEPTED: ["ready", "cancel"],
  PREPARING: ["ready", "cancel"],
  READY: ["complete", "cancel"],
};

export function platformLabel(platform) {
  return platform === "uber" ? "Uber Eats" : platform === "deliveroo" ? "Deliveroo" : platform || "-";
}

export function platformBadgeClass(platform) {
  return platform === "uber"
    ? "bg-emerald-600 text-white"
    : platform === "deliveroo"
      ? "bg-cyan-600 text-white"
      : "bg-slate-300 text-slate-700";
}

/*
 * Compact "time received" for order cards: today -> HH:MM, otherwise a short
 * date + time. Cards also show a relative age ("4m ago") next to it.
 */
export function formatOrderTime(dateStr) {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "-";
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const hhmm = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? hhmm : `${date.toLocaleDateString([], { day: "2-digit", month: "short" })} ${hhmm}`;
}

export function timeAgo(dateStr) {
  if (!dateStr) return "";
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
