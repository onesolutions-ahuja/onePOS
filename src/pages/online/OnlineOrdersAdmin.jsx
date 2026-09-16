import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { fmt } from "../../utils/formatters.js";

/*
 * Admin UI for the Online Orders workflow (Uber Eats / Deliveroo).
 * Focuses on incoming orders, item mapping and the order lifecycle actions.
 */

const STATUS_BADGES = {
  RECEIVED: "bg-blue-50 text-blue-700",
  ACCEPTED: "bg-indigo-50 text-indigo-700",
  PREPARING: "bg-amber-50 text-amber-700",
  READY: "bg-emerald-50 text-emerald-700",
  COMPLETED: "bg-slate-100 text-slate-500",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-red-50 text-red-700",
};

const ACTIVE_STATUSES = ["RECEIVED", "ACCEPTED", "PREPARING", "READY"];

export default function OnlineOrdersAdmin() {
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [busyOrderId, setBusyOrderId] = useState(null);

  // Completion OTP modal
  const [completeTarget, setCompleteTarget] = useState(null);
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);

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

  const loadOrders = useCallback(async () => {
    const suffix = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
    const data = await apiRequest(`/api/online/orders${suffix}`);
    if (data.success) setOrders(data.data || []);
  }, [statusFilter]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await loadOrders();
      const platformsData = await apiRequest("/api/settings/online-platforms");
      if (platformsData.success) {
        const required = {};
        for (const p of platformsData.data || []) required[p.platform] = !!p.requireOtpOnCompletion;
        setOtpRequired(required);
      }
    } catch (err) {
      setError(err.message || "Unable to load online orders data");
    } finally {
      setLoading(false);
    }
  }, [loadOrders]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadOrders().catch((err) => setError(err.message || "Unable to load orders"));
  }, [statusFilter, loadOrders]);

  const orderAction = async (order, action, body) => {
    if (busyOrderId) return; // prevent duplicate accept/reject requests
    setBusyOrderId(order.id);
    try {
      setError("");
      const data = await apiRequest(`/api/online/orders/${order.id}/${action}`, {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!data.success) throw new Error(data.message || "Action failed");
      setMessage(`Order ${order.external_order_id}: ${data.message}`);
      await loadOrders();
    } catch (err) {
      setError(err.message || "Action failed");
    } finally {
      setBusyOrderId(null);
    }
  };

  const openComplete = (order) => {
    // OTP modal only opens when this platform requires a customer OTP on
    // completion (Settings → Online Platforms). Otherwise complete directly.
    if (otpRequired[order.platform]) {
      setCompleteTarget(order);
      setOtpInput("");
      setOtpError("");
    } else {
      completeDirect(order);
    }
  };

  const completeDirect = async (order) => {
    if (busyOrderId) return;
    setBusyOrderId(order.id);
    try {
      const data = await apiRequest(`/api/online/orders/${order.id}/complete`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!data.success) throw new Error(data.message || "Unable to complete order");
      setMessage(`Order ${order.external_order_id} completed`);
      await loadOrders();
    } catch (err) {
      setError(err.message || "Unable to complete order");
    } finally {
      setBusyOrderId(null);
    }
  };

  const submitComplete = async (event) => {
    event.preventDefault();
    if (!completeTarget) return;

    setOtpBusy(true);
    setOtpError("");
    try {
      const data = await apiRequest(`/api/online/orders/${completeTarget.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ otp: otpInput.trim() }),
      });
      if (!data.success) {
        throw Object.assign(new Error(data.message || "Unable to complete order"), { code: data.code });
      }
      setMessage(`Order ${completeTarget.external_order_id} completed - OTP verified by the platform`);
      setCompleteTarget(null);
      await loadOrders();
    } catch (err) {
      setOtpError(
        err.code === "INVALID_OTP"
          ? "The platform rejected this OTP. Enter the correct handover code."
          : err.message || "Unable to complete order"
      );
    } finally {
      setOtpBusy(false);
    }
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
      setMapTarget(null);
      await loadOrders();

      // Refresh the open detail so the item shows as MAPPED.
      if (detail && detail.order.id === mapTarget.order.id) {
        const refreshed = await apiRequest(`/api/online/orders/${mapTarget.order.id}`);
        if (refreshed.success) setDetail(refreshed.data);
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
          <h1 className="text-2xl font-bold">Online Orders</h1>
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

      {/* ORDERS LIST */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
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
                    {order.status === "RECEIVED" && (
                      <>
                        <button onClick={() => orderAction(order, "accept")} className="mr-1 px-3 py-1.5 bg-indigo-600 text-white rounded text-xs hover:bg-indigo-700">Accept</button>
                        <button onClick={() => orderAction(order, "reject", { reason: "Rejected by store" })} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs hover:bg-red-100">Reject</button>
                      </>
                    )}
                    {order.status === "ACCEPTED" && (
                      <button onClick={() => orderAction(order, "preparing")} className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">Preparing</button>
                    )}
                    {order.status === "PREPARING" && (
                      <button onClick={() => orderAction(order, "ready")} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700">Ready</button>
                    )}
                    {ACTIVE_STATUSES.includes(order.status) && (
                      <button onClick={() => { if (window.confirm("Cancel this order and release reserved stock?")) orderAction(order, "cancel", { reason: "Cancelled by store" }); }} className="ml-1 px-3 py-1.5 bg-slate-100 text-slate-600 rounded text-xs hover:bg-slate-200">Cancel</button>
                    )}
                    {["READY", "PREPARING"].includes(order.status) && (
                      <button onClick={() => openComplete(order)} className="ml-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">Complete</button>
                    )}
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

      {/* COMPLETE WITH OTP */}
      {completeTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !otpBusy && setCompleteTarget(null)}>
          <div className="bg-white rounded-xl w-[440px] max-w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-lg">Complete order</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {completeTarget.platform === "uber" ? "Uber Eats" : "Deliveroo"} order {completeTarget.external_order_id}
                </p>
              </div>
              <button onClick={() => !otpBusy && setCompleteTarget(null)} disabled={otpBusy} className="p-2 hover:bg-slate-100 rounded"><X size={20} /></button>
            </div>
            <form onSubmit={submitComplete} className="p-5">
              <p className="text-sm text-slate-600 mb-1">Enter the handover OTP from the {completeTarget.platform === "uber" ? "Uber" : "Deliveroo"} app/customer.</p>
              <p className="text-xs text-slate-400 mb-4">
                The OTP is verified by the {completeTarget.platform === "uber" ? "Uber" : "Deliveroo"} platform
                {completeTarget.otp_code ? " (code was supplied with the order)" : " (no OTP was recorded on this order - in stub mode any code is accepted)"}.
                The order is only marked completed after the platform confirms.
              </p>
              {otpError && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{otpError}</div>}
              <label className="block text-sm text-slate-600">
                <span className="block mb-1 font-medium">Handover OTP</span>
                <input autoFocus value={otpInput} onChange={(event) => setOtpInput(event.target.value)} placeholder="e.g. 1234" className="w-full h-12 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-lg tracking-[0.3em] font-mono" />
              </label>
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" onClick={() => setCompleteTarget(null)} disabled={otpBusy} className="h-10 px-4 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={otpBusy || !otpInput.trim()} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {otpBusy ? "Verifying with platform..." : "Verify & complete"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
