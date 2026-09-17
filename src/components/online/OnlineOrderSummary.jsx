import {
  ACTIVE_STATUSES,
  STATUS_BADGES,
} from "../../pages/online/onlineOrdersShared.js";

/*
 * Online Orders summary / report strip.
 *
 * Sits above the order views and answers "how busy are we right now?" at a
 * glance: pending total, per-lifecycle-stage counts, per-platform counts and
 * today's terminal outcomes (completed / cancelled / rejected).
 *
 * Counts are computed client-side from the SAME list the page already loads
 * (GET /api/online/orders) - no extra backend endpoint is needed.
 *
 * Clicking a chip applies that status as the order-list filter (the Pending
 * chip returns to the processing view / unfiltered list).
 */

function chipClass(active) {
  return `flex flex-col items-center justify-center px-3 py-1.5 rounded-lg border text-center min-w-[74px] ${
    active
      ? "bg-blue-50 border-blue-300"
      : "bg-white border-slate-200 hover:border-slate-300"
  }`;
}

export default function OnlineOrderSummary({ orders = [], selectedStatus = "", onSelectStatus }) {
  const byStatus = { RECEIVED: 0, ACCEPTED: 0, PREPARING: 0, READY: 0, COMPLETED: 0, CANCELLED: 0, REJECTED: 0 };
  const byPlatform = { uber: 0, deliveroo: 0 };
  let pending = 0;

  for (const order of orders) {
    if (byStatus[order.status] !== undefined) byStatus[order.status] += 1;
    if (ACTIVE_STATUSES.includes(order.status)) {
      pending += 1;
      if (byPlatform[order.platform] !== undefined) byPlatform[order.platform] += 1;
    }
  }

  const chips = [
    { key: "__pending", label: "Pending", count: pending, strong: true },
    { key: "RECEIVED", label: "New", count: byStatus.RECEIVED },
    { key: "ACCEPTED", label: "Accepted", count: byStatus.ACCEPTED },
    { key: "PREPARING", label: "Preparing", count: byStatus.PREPARING },
    { key: "READY", label: "Ready", count: byStatus.READY },
    { key: "__uber", label: "Uber Eats", count: byPlatform.uber, platform: "uber" },
    { key: "__deliveroo", label: "Deliveroo", count: byPlatform.deliveroo, platform: "deliveroo" },
    { key: "COMPLETED", label: "Completed", count: byStatus.COMPLETED },
    { key: "CANCELLED", label: "Cancelled", count: byStatus.CANCELLED },
    { key: "REJECTED", label: "Rejected", count: byStatus.REJECTED },
  ];

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {chips.map((chip) => {
        const active =
          (chip.key === "__pending" && !selectedStatus) || chip.key === selectedStatus;

        return (
          <button
            key={chip.key}
            type="button"
            title={`Show ${chip.label.toLowerCase()} orders`}
            onClick={() => onSelectStatus && onSelectStatus(chip.key)}
            className={`${chipClass(active)} ${chip.strong && chip.count > 0 ? "ring-1 ring-blue-300" : ""}`}
          >
            <span
              className={`text-lg font-bold leading-none ${
                chip.count > 0 ? "text-slate-800" : "text-slate-300"
              }`}
            >
              {chip.count}
            </span>
            <span
              className={`text-[10px] uppercase tracking-wide mt-0.5 ${
                chip.key === "__uber"
                  ? "text-emerald-700"
                  : chip.key === "__deliveroo"
                    ? "text-cyan-700"
                    : active
                      ? "text-blue-700"
                      : "text-slate-400"
              }`}
            >
              {chip.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* Re-exported for consumers that badge statuses next to the summary. */
export { STATUS_BADGES };
