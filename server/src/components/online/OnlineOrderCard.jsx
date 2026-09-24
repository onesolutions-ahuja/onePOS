import { Loader2, Printer } from "lucide-react";
import {
  ORDER_ACTIONS,
  STATUS_BADGES,
  TERMINAL_STATUSES,
  formatOrderTime,
  platformBadgeClass,
  platformLabel,
  timeAgo,
} from "../../pages/online/onlineOrdersShared.js";
import { fmt } from "../../utils/formatters.js";

/*
 * Compact rectangular order card for till-style order processing.
 *
 * Shows platform, order number, time received, customer, items with
 * quantities/modifiers, total, current status and the small action buttons
 * the order's status allows (plus a print button). The action matrix comes
 * from onlineOrdersShared (or an override), so the card can never offer a
 * transition the backend does not accept.
 *
 * While one of this card's actions is in flight, that button shows its own
 * spinner/"busy" label and the card's other buttons are held back - every
 * OTHER card stays fully usable.
 */

export default function OnlineOrderCard({
  order,
  detail = null,
  busyAction = null,
  allowedActions,
  onAction,
  onOpenDetail,
  onPrint,
}) {
  const actions = allowedActions || [];
  const busyForOrder =
    busyAction && busyAction.orderId === order.id ? busyAction.action : null;

  const items = detail && Array.isArray(detail.items) ? detail.items : null;

  return (
    <div
      className={`bg-white border rounded-lg p-3 flex flex-col gap-2 ${
        order.status === "RECEIVED" ? "border-blue-300" : "border-slate-200"
      }`}
    >
      {/* Row 1: platform + order number + status + time */}
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${platformBadgeClass(order.platform)}`}>
          {platformLabel(order.platform)}
        </span>
        <button
          type="button"
          onClick={() => onOpenDetail && onOpenDetail(order)}
          className="font-mono text-sm font-semibold text-slate-800 hover:text-blue-600 hover:underline truncate"
          title="Open order details"
        >
          {order.external_order_id}
        </button>
        <span className="flex-1" />
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_BADGES[order.status] || "bg-slate-100 text-slate-500"}`}>
          {order.status}
        </span>
      </div>

      {/* Row 2: received + customer */}
      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span title={order.created_at ? new Date(order.created_at).toLocaleString() : ""}>
          {formatOrderTime(order.created_at)}
          {order.created_at ? <span className="text-slate-400"> · {timeAgo(order.created_at)}</span> : ""}
        </span>
        {order.customer_name && <span>{order.customer_name}</span>}
        {order.customer_phone && <span className="text-slate-400">{order.customer_phone}</span>}
        <span className="text-slate-400">{order.fulfilment_type}</span>
      </div>

      {/* Row 3: items + quantities (+ modifiers when the detail is loaded) */}
      <div className="border-t border-slate-100 pt-1.5 text-sm">
        {items ? (
          <ul className="space-y-0.5">
            {items.map((item) => {
              const modifiers =
                (item.platform_data && item.platform_data.modifiers) || [];
              const modifierNames = modifiers.map((m) => m.name).filter(Boolean).join(", ");
              return (
                <li key={item.id} className="flex items-baseline gap-2">
                  <span className="font-semibold text-slate-700 tabular-nums">×{item.quantity}</span>
                  <span className="text-slate-700 truncate">{item.product_name}</span>
                  {modifierNames && (
                    <span className="text-[11px] text-slate-400 truncate">({modifierNames})</span>
                  )}
                  {item.mapping_status === "UNMAPPED" && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 shrink-0">
                      UNMAPPED
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="text-xs text-slate-500 tabular-nums">{fmt(item.total)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-xs text-slate-400">{order.item_count ?? "-"} item(s)…</div>
        )}
      </div>

      {/* Row 4: total + actions + print */}
      <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100">
        <div className="mr-1">
          <div className="text-base font-bold text-slate-900 leading-none">{fmt(order.total)}</div>
          <div className="text-[10px] text-slate-400">
            incl. delivery {Number(order.delivery_fee) > 0 ? fmt(order.delivery_fee) : fmt(0)}
          </div>
        </div>

        <span className="flex-1" />

        {actions.length ? (
          actions.map((action) => {
            const meta = ORDER_ACTIONS[action];
            const isBusy = busyForOrder === action;

            return (
              <button
                key={action}
                type="button"
                onClick={() => onAction && onAction(order, action)}
                disabled={Boolean(busyForOrder)}
                aria-busy={isBusy}
                className={`px-2.5 py-1.5 rounded text-xs inline-flex items-center gap-1 ${meta.className} disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                {isBusy && <Loader2 size={12} className="animate-spin" />}
                {isBusy ? meta.busy : meta.label}
              </button>
            );
          })
        ) : (
          <span className="text-xs text-slate-300">
            {TERMINAL_STATUSES.includes(order.status) ? "No actions" : "-"}
          </span>
        )}

        <button
          type="button"
          onClick={() => onPrint && onPrint(order)}
          disabled={Boolean(busyForOrder)}
          title="Print order (kitchen ticket)"
          className="p-1.5 rounded text-slate-500 hover:bg-slate-100 hover:text-slate-700 border border-slate-200 disabled:opacity-60"
        >
          <Printer size={14} />
        </button>
      </div>
    </div>
  );
}
