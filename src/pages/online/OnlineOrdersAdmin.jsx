import useOnlineOrderActions from "./useOnlineOrderActions.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, LayoutGrid, Table2, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { fmt } from "../../utils/formatters.js";
import OnlineOrderSummary from "../../components/online/OnlineOrderSummary.jsx";
import OnlineOrderCard from "../../components/online/OnlineOrderCard.jsx";
import CompleteOrderModal from "../../components/online/CompleteOrderModal.jsx";
import { printOnlineOrder } from "../../utils/onlineOrderPrint.js";
import {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  STATUS_BADGES,
  ORDER_ACTIONS,
  STATUS_ACTIONS,
} from "./onlineOrdersShared.js";

/*
 * Admin UI for the Online Orders workflow (Uber Eats / Deliveroo).
 *
 * Two views over the same lifecycle:
 *   - "Processing" (default): till-style summary + compact pending-order
 *     cards for fast one-click order handling;
 *   - "All orders": the original full table with the status filter, item
 *     mapping, order detail and history.
 *
 * Both views share the lifecycle matrix, busy feedback and completion OTP
 * behaviour from onlineOrdersShared / the extracted components, so actions
 * behave identically everywhere.
 */

export default function OnlineOrdersAdmin() {
  const [orders, setOrders] = useState([]);
  /*
   * Unfiltered list (all statuses) that feeds the summary strip and the
   * pending-order processing cards - the summary needs completed/cancelled
   * counts even while the table below is filtered.
   */
  const [allOrders, setAllOrders] = useState([]);
  /* "processing" = pending-order cards (default) | "all" = full table */
  const [viewMode, setViewMode] = useState("processing");
  /* Item lines per order id for the processing cards ({ order, items, events }) */
  const [orderDetails, setOrderDetails] = useState({});
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  /*
   * The action currently in flight, as { orderId, action }. It lets the exact
   * button that was clicked show its own "Processing..." label, and holds back
   * only that order's own row - the rest of the page stays usable.
   */
  const [platformFilter, setPlatformFilter] = useState("");

  // Deliveroo item mapping modal
  const [mapTarget, setMapTarget] = useState(null); // { order, item }
  const [mapSearch, setMapSearch] = useState("");
  const [mapResults, setMapResults] = useState([]);
  const [mapProductId, setMapProductId] = useState("");
  const [mapSaveForFuture, setMapSaveForFuture] = useState(true);
  const [mapBusy, setMapBusy] = useState(false);
  const [mapError, setMapError] = useState("");

  // Platform config: which platforms require a customer OTP on completion.
  const [otpRequired, setOtpRequired] = useState({});

  // Guards the mount-time double fetch (see the statusFilter effect below).
  const initialLoadDone = useRef(false);
  const detailFetches = useRef(new Set());

  const loadOrders = useCallback(async () => {
    const suffix = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
    const data = await apiRequest(`/api/online/orders${suffix}`);
    if (data.success) setOrders(data.data || []);
  }, [statusFilter]);

  const loadAllOrders = useCallback(async () => {
    const data = await apiRequest("/api/online/orders?limit=500");
    if (data.success) setAllOrders(data.data || []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadOrders(), loadAllOrders()]);
      const platformsData = await apiRequest("/api/settings/online-platforms");
      if (platformsData.success) {
        const required = {};
        for (const p of platformsData.data || []) required[p.platform] = p.require_otp_on_completion === true;
        setOtpRequired(required);
      }
    } catch (err) {
      setError(err.message || "Unable to load online orders data");
    } finally {
      setLoading(false);
    }
  }, [loadOrders, loadAllOrders]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Re-loads the table when the status filter changes. The very first run is
   * skipped because loadAll() above already fetched the unfiltered list - this
   * removes the duplicate GET /api/online/orders that fired on mount.
   */
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true;
      return;
    }

    loadOrders().catch((err) => setError(err.message || "Unable to load orders"));
  }, [statusFilter, loadOrders]);

  const applyOrderUpdate = useCallback((updatedOrder) => {
    if (!updatedOrder) return;

    setOrders((current) => {
      const index = current.findIndex((row) => row.id === updatedOrder.id);
      if (index === -1) return current; // not in the current view (filtered out)

      if (statusFilter && updatedOrder.status !== statusFilter) {
        return current.filter((row) => row.id !== updatedOrder.id);
      }

      const next = current.slice();
      next[index] = { ...current[index], ...updatedOrder };
      return next;
    });

    setAllOrders((current) => {
      const index = current.findIndex((row) => row.id === updatedOrder.id);
      if (index === -1) return current;
      const next = current.slice();
      next[index] = { ...current[index], ...updatedOrder };
      return next;
    });

    // Keep an open detail panel in step with its row.
    setDetail((current) =>
      current && current.order && current.order.id === updatedOrder.id
        ? { ...current, order: { ...current.order, ...updatedOrder } }
        : current
    );
  }, [statusFilter]);

  const { busyActions, runAction, completeTarget, setCompleteTarget, otpInput, setOtpInput, otpError, otpBusy, submitComplete } = useOnlineOrderActions({ applyOrderUpdate, otpRequired, setError, setMessage });

  /*
   * Quiet 20s refresh of the summary/card data so the processing view stays
   * current on a till. Skipped while an action or the OTP modal is in flight
   * so an in-flight platform call is never visually disturbed.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (Object.keys(busyActions).length || completeTarget) return;
      loadAllOrders().catch((err) => console.error("Online orders refresh:", err));
    }, 20000);
    return () => clearInterval(timer);
  }, [busyActions, completeTarget, loadAllOrders]);

  /*
   * Applies the order returned by an action response to BOTH loaded lists,
   * so the new status appears without re-fetching anything:
   *   - `orders`   the (possibly status-filtered) table list: a row that no
   *     longer matches the active filter is dropped, exactly as a full
   *     reload would do - a completed order leaves the pending view;
   *   - `allOrders` the unfiltered summary/card list: the row is patched in
   *     place so summary counts stay correct.
   * The list-only columns (item_count / unmapped_count) are kept from the
   * row we already have.
   */
  /*
   * Loads the item lines for a processing card (the list endpoint only
   * returns counts). Each order's detail is fetched once; cards show a
   * compact "N item(s)…" line until their detail arrives. Returns the detail
   * so printing can use fresh data immediately.
   */
  const ensureDetail = useCallback(
    async (orderId) => {
      if (!orderId) return null;
      if (orderDetails[orderId]) return orderDetails[orderId];
      if (detailFetches.current.has(orderId)) return null;

      detailFetches.current.add(orderId);
      try {
        const data = await apiRequest(`/api/online/orders/${orderId}`);
        if (data.success) {
          setOrderDetails((current) => ({ ...current, [orderId]: data.data }));
          return data.data;
        }
      } catch {
        /* card keeps its "N item(s)…" fallback; not fatal for processing */
      } finally {
        detailFetches.current.delete(orderId);
      }
      return null;
    },
    [orderDetails]
  );

  const pendingOrders = allOrders.filter((order) => ACTIVE_STATUSES.includes(order.status) && (!platformFilter || order.platform === platformFilter));

  useEffect(() => {
    for (const order of pendingOrders) {
      ensureDetail(order.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOrders]);

  const handlePrint = async (order) => {
    const freshDetail = await ensureDetail(order.id);
    if (!freshDetail || !Array.isArray(freshDetail.items)) {
      setError("Order items are still loading or unavailable. Please retry printing.");
      return;
    }
    printOnlineOrder(order, freshDetail.items);
  };

  /*
   * Summary chip click: a status key applies that filter and opens the full
   * table; the Pending chip returns to the processing view with no filter.
   */
  const handleSummarySelect = (key) => {
    if (key === "__pending") {
      setPlatformFilter("");
      setStatusFilter("");
      setViewMode("processing");
      return;
    }

    if (key === "__uber" || key === "__deliveroo") {
      setPlatformFilter(key.slice(2));
      setViewMode("processing");
      return;
    }

    setStatusFilter(key);
    setViewMode("all");
  };

  /*
   * Renders the actions an order's current status allows. While one action of
   * this order is running, that row's own buttons are held back (the clicked
   * one shows a spinner and its "Processing..." label); every other row, the
   * status filter, Refresh and the detail view stay fully usable.
   */
  const renderOrderActions = (order) => {
    const actions = STATUS_ACTIONS[order.status] || [];

    if (!actions.length) {
      return (
        <span className="text-xs text-slate-300">
          {TERMINAL_STATUSES.includes(order.status) ? "No actions" : "-"}
        </span>
      );
    }

    const busyForOrder = busyActions[order.id] || null;

    return (
      <span className="inline-flex items-center gap-1">
        {actions.map((action) => {
          const meta = ORDER_ACTIONS[action];
          const isBusy = busyForOrder === action;

          return (
            <button
              key={action}
              type="button"
              onClick={() => runAction(order, action)}
              disabled={Boolean(busyForOrder)}
              aria-busy={isBusy}
              className={`px-3 py-1.5 rounded text-xs inline-flex items-center gap-1.5 ${meta.className} disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {isBusy && <Loader2 size={13} className="animate-spin" />}
              {isBusy ? meta.busy : meta.label}
            </button>
          );
        })}
      </span>
    );
  };

  const openDetail = async (order) => {
    try {
      const data = await apiRequest(`/api/online/orders/${order.id}`);
      if (data.success) setDetail(data.data);
    } catch (err) {
      setError(err.message || "Unable to load order detail");
    }
  };

  const searchMappingProducts = useCallback(async (search) => {
    try {
      const suffix = search ? `?search=${encodeURIComponent(search)}` : "";
      const data = await apiRequest(`/api/online/deliveroo/products${suffix}`);
      if (data.success) setMapResults(data.data || []);
    } catch (err) {
      setMapError(err.message || "Unable to search products");
    }
  }, []);

  const openMap = (order, item) => {
    setMapTarget({ order, item });
    setMapProductId("");
    setMapSearch("");
    setMapSaveForFuture(true);
    setMapError("");
    searchMappingProducts("");
  };

  /*
   * Maps an existing order item to an existing onePOS product. The backend
   * updates the EXISTING order item (never creates a new order/product) and
   * records a Deliveroo item mapping so future orders resolve automatically.
   */
  const submitMapping = async (event) => {
    event.preventDefault();
    if (!mapTarget || !mapProductId) {
      setMapError("Select a onePOS product to map this item to");
      return;
    }

    setMapBusy(true);
    setMapError("");
    try {
      const data = await apiRequest(
        `/api/online/orders/${mapTarget.order.id}/items/${mapTarget.item.id}/map`,
        {
          method: "POST",
          body: JSON.stringify({ productId: mapProductId, saveForFutureDeliveroo: mapSaveForFuture }),
        }
      );
      if (!data.success) throw new Error(data.message || "Unable to map this item");

      setMessage(
        `Mapped "${mapTarget.item.product_name}" to a onePOS product${mapSaveForFuture ? " (saved for future Deliveroo orders)" : ""}`
      );
      const mappedOrderId = mapTarget.order.id;
      setMapTarget(null);
      await Promise.all([loadOrders(), loadAllOrders()]);

      // Refresh the open detail so the item shows as MAPPED.
      if (detail && detail.order.id === mappedOrderId) {
        const refreshed = await apiRequest(`/api/online/orders/${mappedOrderId}`);
        if (refreshed.success) setDetail(refreshed.data);
      }

      // Refresh the processing card's detail for the same reason.
      const cardRefresh = await apiRequest(`/api/online/orders/${mappedOrderId}`);
      if (cardRefresh.success) {
        setOrderDetails((current) => ({ ...current, [mappedOrderId]: cardRefresh.data }));
      }
    } catch (err) {
      setMapError(err.message || "Unable to map this item");
    } finally {
      setMapBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="onepos-page-title">Online Orders</h1>
          <p className="text-sm text-slate-500 mt-1">Uber Eats &amp; Deliveroo foundation - platform calls are stubbed until credentials are added.</p>
        </div>
        <button onClick={loadAll} className="h-10 px-4 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50">
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")} className="p-1 hover:bg-red-100 rounded"><X size={16} /></button>
        </div>
      )}
      {message && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm flex items-center justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage("")} className="p-1 hover:bg-emerald-100 rounded"><X size={16} /></button>
        </div>
      )}

      <OnlineOrderSummary orders={allOrders} selectedStatus={viewMode === "processing" ? platformFilter ? `__${platformFilter}` : "__pending" : statusFilter || "__all"} onSelectStatus={handleSummarySelect} />
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => { setViewMode("processing"); setPlatformFilter(""); }} aria-pressed={viewMode === "processing"} className={`px-3 py-2 rounded text-sm inline-flex gap-2 items-center ${viewMode === "processing" ? "bg-blue-600 text-white" : "bg-white border"}`}><LayoutGrid size={16} />Pending orders</button>
        <button onClick={() => setViewMode("all")} aria-pressed={viewMode === "all"} className={`px-3 py-2 rounded text-sm inline-flex gap-2 items-center ${viewMode === "all" ? "bg-blue-600 text-white" : "bg-white border"}`}><Table2 size={16} />All orders / history</button>
        <span className="text-xs text-slate-500">Counts cover the latest {allOrders.length} loaded orders (maximum 500); platform counts are pending only.</span>
      </div>
      {viewMode === "processing" ? (
        pendingOrders.length ? <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {pendingOrders.map((order) => <OnlineOrderCard key={order.id} order={order} detail={orderDetails[order.id]} busyAction={busyActions[order.id] ? { orderId: order.id, action: busyActions[order.id] } : null} allowedActions={STATUS_ACTIONS[order.status] || []} onAction={runAction} onOpenDetail={openDetail} onPrint={handlePrint} />)}
        </div> : <div className="onepos-card onepos-card-body text-center text-slate-500">{loading ? "Loading orders..." : "No pending orders"}</div>
      ) : (
      <div className="onepos-card overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold">Orders</h2>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 border border-slate-200 rounded-lg bg-white text-sm">
            <option value="">All statuses</option>
            {Object.keys(STATUS_BADGES).map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-5 py-3 font-medium">Platform</th>
                <th className="px-5 py-3 font-medium">External ID</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Items</th>
                <th className="px-5 py-3 font-medium">Total</th>
                <th className="px-5 py-3 font-medium">OTP</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-t border-slate-100">
                  <td className="px-5 py-3 capitalize">{order.platform}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => openDetail(order)} className="text-blue-600 hover:underline font-medium">{order.external_order_id}</button>
                    <div className="text-xs text-slate-400">{new Date(order.created_at).toLocaleString()}</div>
                  </td>
                  <td className="px-5 py-3">{order.customer_name || "-"}<div className="text-xs text-slate-400">{order.customer_phone || ""}</div></td>
                  <td className="px-5 py-3">
                    {order.item_count}
                    {Number(order.unmapped_count) > 0 && (
                      <div className="mt-0.5">
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                          {order.unmapped_count} UNMAPPED
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3">{fmt(order.total)}</td>
                  <td className="px-5 py-3 text-xs">{order.otp_code ? <span className="font-mono">{order.otp_code}</span> : "-"}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_BADGES[order.status] || "bg-slate-100 text-slate-500"}`}>{order.status}</span>
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {renderOrderActions(order)}
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr><td colSpan="8" className="px-5 py-6 text-center text-slate-400">{loading ? "Loading..." : "No online orders yet"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      )}

      {/* ORDER DETAIL */}
      {detail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-xl w-[680px] max-w-full max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">{detail.order.platform.toUpperCase()} order {detail.order.external_order_id}</h2>
                <p className="text-xs text-slate-500 mt-1">Status: {detail.order.status} - {detail.order.fulfilment_type}</p>
              </div>
              <button onClick={() => setDetail(null)} className="p-2 hover:bg-slate-100 rounded"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-5">
              <div>
                <h3 className="text-sm font-semibold mb-2">Items</h3>
                {detail.items.some((item) => item.mapping_status === "UNMAPPED") && (
                  <div className="mb-2 px-3 py-2 bg-amber-50 border-amber-200 text-amber-800 rounded text-xs">
                    {detail.items.filter((item) => item.mapping_status === "UNMAPPED").length} item(s) are not mapped to a onePOS product.
                    Map them to a product so future {detail.order.platform === "uber" ? "Uber Eats" : "Deliveroo"} orders resolve automatically.
                    Unmapped items do not reserve or consume stock.
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                      <th className="py-1 font-medium">Item</th>
                      <th className="py-1 font-medium">PLU / ID</th>
                      <th className="py-1 font-medium text-center">Qty</th>
                      <th className="py-1 font-medium text-right">Total</th>
                      <th className="py-1 font-medium text-right">Mapping</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.items.map((item) => {
                      const unmapped = item.mapping_status === "UNMAPPED";
                      const modifiers = (item.platform_data && item.platform_data.modifiers) || [];
                      return (
                        <tr key={item.id} className="border-b border-slate-100 align-top">
                          <td className="py-2">
                            {item.product_name}
                            {modifiers.length > 0 && (
                              <div className="text-xs text-slate-400">{modifiers.map((m) => m.name).filter(Boolean).join(", ")}</div>
                            )}
                          </td>
                          <td className="py-2 text-xs text-slate-500 font-mono">{item.external_item_id || "-"}</td>
                          <td className="py-2 text-slate-500 text-center">x{item.quantity}</td>
                          <td className="py-2 text-right">{fmt(item.total)}</td>
                          <td className="py-2 text-right">
                            {unmapped ? (
                              <span className="inline-flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">UNMAPPED</span>
                                <button
                                  onClick={() => openMap(detail.order, item)}
                                  className="px-2.5 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                >
                                  Map product
                                </button>
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">MAPPED</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="text-sm text-right mt-2 space-y-1">
                  <div>Subtotal: {fmt(detail.order.subtotal)}</div>
                  <div>Tax: {fmt(detail.order.tax)}</div>
                  {Number(detail.order.delivery_fee) > 0 && <div>Delivery: {fmt(detail.order.delivery_fee)}</div>}
                  <div className="font-bold">Total: {fmt(detail.order.total)}</div>
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-2">Customer</h3>
                <p className="text-sm text-slate-600">{detail.order.customer_name || "-"} {detail.order.customer_phone || ""}</p>
                {detail.order.delivery_address && <p className="text-sm text-slate-500">{detail.order.delivery_address}</p>}
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-2">Events</h3>
                <ul className="text-xs text-slate-500 space-y-1">
                  {detail.events.map((event) => (
                    <li key={event.id}>
                      <span className="font-medium text-slate-700">{event.event_type}</span> - {new Date(event.created_at).toLocaleString()} {event.message ? `- ${event.message}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      <CompleteOrderModal order={completeTarget} otpInput={otpInput} onOtpChange={setOtpInput} otpError={otpError} otpBusy={otpBusy} onSubmit={submitComplete} onClose={() => setCompleteTarget(null)} />

      {/* MAP DELIVEROO ITEM TO A ONEPOS PRODUCT */}
      {mapTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !mapBusy && setMapTarget(null)}>
          <div className="bg-white rounded-xl w-[560px] max-w-full max-h-[85vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">Map {mapTarget.order.platform === "uber" ? "Uber Eats" : "Deliveroo"} item</h2>
                <p className="text-xs text-slate-500 mt-1">Order {mapTarget.order.external_order_id}</p>
              </div>
              <button onClick={() => !mapBusy && setMapTarget(null)} disabled={mapBusy} className="p-2 hover:bg-slate-100 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={submitMapping} className="p-5 space-y-4">
              <div className="px-3 py-2 bg-slate-50 border-slate-200 rounded-lg text-sm">
                <div className="font-medium text-slate-700">{mapTarget.item.product_name}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Deliveroo ID: <span className="font-mono">{mapTarget.item.external_item_id || "(none)"}</span> - x{mapTarget.item.quantity} - {fmt(mapTarget.item.total)}
                </div>
              </div>

              {mapError && <div className="px-3 py-2 bg-red-50 border-red-200 text-red-700 rounded text-sm">{mapError}</div>}

              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Search existing onePOS product</label>
                <input
                  value={mapSearch}
                  onChange={(e) => { setMapSearch(e.target.value); searchMappingProducts(e.target.value); }}
                  placeholder="Search by name, SKU or barcode..."
                  className="w-full h-10 px-3 border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">Only existing products can be selected - mapping never creates a new product.</p>
              </div>

              <div className="border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                {mapResults.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => setMapProductId(p.id)}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${mapProductId === p.id ? "bg-blue-50" : ""}`}
                  >
                    <span className="font-medium text-slate-700">{p.name}</span>
                    <span className="text-xs text-slate-400 ml-2">
                      {p.sku ? `SKU ${p.sku}` : "no SKU"} - {fmt(p.price)}{p.trackStock ? " - tracked" : ""}
                    </span>
                 </button>
                ))}
                {!mapResults.length && (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">No products match this search</div>
                )}
              </div>

              {mapTarget.order.platform === "deliveroo" && mapTarget.item.external_item_id && (
                <label className="flex items-start gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={mapSaveForFuture} onChange={(e) => setMapSaveForFuture(e.target.checked)} className="mt-0.5" />
                  <span>
                    Save this mapping for future Deliveroo orders
                    <span className="block text-xs text-slate-400">
                      Links Deliveroo item {mapTarget.item.external_item_id} to the chosen product, so later orders resolve automatically.
                    </span>
                  </span>
                </label>
              )}

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setMapTarget(null)} disabled={mapBusy} className="h-10 px-4 border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={mapBusy || !mapProductId} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {mapBusy ? "Saving..." : "Map item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
