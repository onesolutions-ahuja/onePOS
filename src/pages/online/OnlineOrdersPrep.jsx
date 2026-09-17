import useOnlineOrderActions from "./useOnlineOrderActions.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import OnlineOrderCard from "../../components/online/OnlineOrderCard.jsx";
import CompleteOrderModal from "../../components/online/CompleteOrderModal.jsx";
import { printOnlineOrder } from "../../utils/onlineOrderPrint.js";
import {
  PREP_STATUS_ACTIONS,
} from "./onlineOrdersShared.js";

/*
 * Restricted Online Orders processing view ("Order Prep").
 *
 * A focused order-preparation screen for a restricted user (an order-handling
 * role created with the EXISTING permissions model - no special/hard-coded
 * role). It shows ONLY the orders being worked on: ACCEPTED / PREPARING /
 * READY, and offers only that workflow's actions:
 *   ACCEPTED  -> Mark Ready / Cancel  (internally already PREPARING - accept
 *                                    auto-advances into preparation)
 *   PREPARING -> Mark Ready / Cancel
 *   READY     -> Complete Order (only when the user may manage orders) / Cancel
 *
 * Gating uses the same permission codes the backend enforces
 * (online_orders.view / online_orders.manage); the UI merely hides what the
 * API would reject anyway - every endpoint keeps its own authorize() check.
 *
 * Reuses the shared action matrix and the SAME completion OTP behaviour as
 * the admin page. It deliberately has NO accept/reject and NO item-mapping
 * UI - new orders stay with the full admin page.
 */

const PREP_FILTER_STATUSES = ["ACCEPTED", "PREPARING", "READY"];

export default function OnlineOrdersPrep({ permissions = { isAdmin: false, permissions: [] } }) {
  const canView =
    permissions.isAdmin ||
    (permissions.permissions || []).includes("online_orders.view");
  const canManage =
    permissions.isAdmin ||
    (permissions.permissions || []).includes("online_orders.manage");

  const [orders, setOrders] = useState([]);
  const [details, setDetails] = useState({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [otpRequired, setOtpRequired] = useState({});

  const detailFetches = useRef(new Set());

  const loadOrders = useCallback(async () => {
    const data = await apiRequest("/api/online/orders?limit=500");
    if (data.success) setOrders(data.data || []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await loadOrders();
      const platformsData = await apiRequest("/api/settings/online-platforms");
      if (platformsData.success) {
        const required = {};
        for (const p of platformsData.data || []) {
          required[p.platform] = p.require_otp_on_completion === true;
        }
        setOtpRequired(required);
      }
    } catch (err) {
      setError(err.message || "Unable to load orders");
    } finally {
      setLoading(false);
    }
  }, [loadOrders]);

  useEffect(() => {
    if (canView) loadAll();
  }, [canView, loadAll]);

  /*
   * Loads the item lines for the visible cards (the list endpoint only
   * returns counts). Each order's detail is fetched once; cards show a
   * compact "N item(s)…" line until their detail arrives. Returns the
   * detail ({ order, items, events }) so callers (printing) can use the
   * fresh data immediately.
   */
  const ensureDetail = useCallback(
    async (orderId) => {
      if (!orderId) return null;
      if (details[orderId]) return details[orderId];
      if (detailFetches.current.has(orderId)) return null;

      detailFetches.current.add(orderId);
      try {
        const data = await apiRequest(`/api/online/orders/${orderId}`);
        if (data.success) {
          setDetails((current) => ({ ...current, [orderId]: data.data }));
          return data.data;
        }
      } catch {
        /* items stay on the "N item(s)…" fallback; not fatal for processing */
      } finally {
        detailFetches.current.delete(orderId);
      }
      return null;
    },
    [details]
  );

  const pendingOrders = orders.filter((order) => PREP_FILTER_STATUSES.includes(order.status));

  useEffect(() => {
    for (const order of pendingOrders) {
      ensureDetail(order.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const applyOrderUpdate = useCallback((updatedOrder) => {
    if (!updatedOrder) return;
    setOrders((current) => {
      const index = current.findIndex((row) => row.id === updatedOrder.id);
      if (index === -1) return current;
      const next = current.slice();
      next[index] = { ...current[index], ...updatedOrder };
      return next;
    });
  }, []);

  const { busyActions, runAction, completeTarget, setCompleteTarget, otpInput, setOtpInput, otpError, otpBusy, submitComplete } = useOnlineOrderActions({ applyOrderUpdate, otpRequired, setError, setMessage });

  /*
   * Quiet 20s refresh so the processing screen stays current on a till -
   * skipped while an action/OTP modal is in flight, so an in-flight platform
   * call can never be visually disturbed or its order row removed.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (Object.keys(busyActions).length || completeTarget) return;
      loadOrders().catch((err) => console.error("Order Prep refresh:", err));
    }, 20000);
    return () => clearInterval(timer);
  }, [busyActions, completeTarget, loadOrders]);

  const handlePrint = async (order) => {
    const freshDetail = await ensureDetail(order.id);
    if (!freshDetail || !Array.isArray(freshDetail.items)) {
      setError("Order items are still loading or unavailable. Please retry printing.");
      return;
    }
    printOnlineOrder(order, freshDetail.items);
  };

  if (!canView) {
    return (
      <div className="bg-white rounded-xl border p-10 text-center">
        <h2 className="text-xl font-bold">Order Prep</h2>
        <p className="text-sm text-slate-400 mt-2">
          You do not have permission to view online orders.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Order Prep</h1>
          <p className="text-sm text-slate-500 mt-1">
            Accepted, preparing and ready orders - update each order as it moves along.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Auto-refreshes every 20s</span>
          <button onClick={loadAll} className="h-10 px-4 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="p-1 hover:bg-red-100 rounded text-red-700">✕</button>
        </div>
      )}
      {message && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm flex items-center justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage("")} className="p-1 hover:bg-emerald-100 rounded text-emerald-700">✕</button>
        </div>
      )}

      {!canManage && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
          You have view-only access to online orders - ask an administrator for the
          &quot;Manage Online Orders&quot; permission to update orders here.
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400">Loading orders...</div>
      ) : pendingOrders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400">
          No accepted, preparing or ready orders right now.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pendingOrders.map((order) => (
            <OnlineOrderCard
              key={order.id}
              order={order}
              detail={details[order.id] || null}
              busyAction={busyActions[order.id] ? { orderId: order.id, action: busyActions[order.id] } : null}
              allowedActions={canManage ? PREP_STATUS_ACTIONS[order.status] || [] : []}
              onAction={runAction}
              onPrint={handlePrint}
            />
          ))}
        </div>
      )}

      {completeTarget && (
        <CompleteOrderModal
          order={completeTarget}
          otpInput={otpInput}
          onOtpChange={setOtpInput}
          otpError={otpError}
          otpBusy={otpBusy}
          onSubmit={submitComplete}
          onClose={() => setCompleteTarget(null)}
        />
      )}
    </div>
  );
}
