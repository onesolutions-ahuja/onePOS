import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { fmt } from "../../utils/formatters.js";

/*
 * Basic admin UI for the Online Orders foundation (Uber Eats / Deliveroo).
 * Functionality first: product platform configuration, simulated incoming
 * orders and the order lifecycle actions. Will be polished later.
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
  const [platforms, setPlatforms] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  // Simulated incoming order form
  const [simPlatform, setSimPlatform] = useState("uber");
  const [simProductId, setSimProductId] = useState("");
  const [simQty, setSimQty] = useState(1);
  const [simName, setSimName] = useState("");
  const [simOtp, setSimOtp] = useState("");
  const [simBusy, setSimBusy] = useState(false);

  // Completion OTP modal
  const [completeTarget, setCompleteTarget] = useState(null);
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);

  const loadPlatforms = useCallback(async () => {
    try {
      const data = await apiRequest("/api/online/platforms");
      if (data.success) setPlatforms(data.data || []);
    } catch (err) {
      console.error("Load platforms error:", err);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    const data = await apiRequest("/api/online/products");
    if (data.success) setProducts(data.data || []);
  }, []);

  const loadOrders = useCallback(async () => {
    const suffix = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
    const data = await apiRequest(`/api/online/orders${suffix}`);
    if (data.success) setOrders(data.data || []);
  }, [statusFilter]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadPlatforms(), loadProducts(), loadOrders()]);
    } catch (err) {
      setError(err.message || "Unable to load online orders data");
    } finally {
      setLoading(false);
    }
  }, [loadPlatforms, loadProducts, loadOrders]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadOrders().catch((err) => setError(err.message || "Unable to load orders"));
  }, [statusFilter, loadOrders]);

  const toggleProductPlatform = async (product, key) => {
    try {
      setError("");
      const body = { [key]: !product[key] };
      const data = await apiRequest(`/api/online/products/${product.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!data.success) throw new Error(data.message || "Unable to save configuration");
      setMessage(`${product.name}: ${key === "availableOnUber" ? "Uber Eats" : "Deliveroo"} ${product[key] ? "unpublished" : "published"} (simulated)`);
      await loadProducts();
    } catch (err) {
      setError(err.message || "Unable to save configuration");
    }
  };

  const simulateOrder = async () => {
    if (!simProductId) {
      setError("Choose a product that is configured for a platform");
      return;
    }

    setSimBusy(true);
    setError("");
    try {
      const data = await apiRequest("/api/online/orders", {
        method: "POST",
        body: JSON.stringify({
          platform: simPlatform,
          customer: { name: simName || "Simulated Customer" },
          otp: simOtp.trim() || undefined,
          items: [{ productId: simProductId, quantity: Number(simQty) || 1 }],
        }),
      });
      if (!data.success) throw new Error(data.message || "Unable to receive order");
      setMessage(`Order received (${data.data.order.platform}, ${data.data.order.external_order_id}) - inventory reserved`);
      await loadOrders();
      await loadProducts();
    } catch (err) {
      setError(err.message || "Unable to receive order");
    } finally {
      setSimBusy(false);
    }
  };

  const orderAction = async (order, action, body) => {
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
    }
  };

  const openComplete = (order) => {
    setCompleteTarget(order);
    setOtpInput("");
    setOtpError("");
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
      setMessage(`Order ${completeTarget.external_order_id} completed - OTP verified by the ${completeTarget.platform} platform`);
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

      <div className="flex gap-2 mb-4">
        {platforms.map((platform) => (
          <span key={platform.platform} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${platform.mode === "DISABLED" ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
            {platform.name}: {platform.mode}
          </span>
        ))}
      </div>

      {/* SIMULATE INCOMING ORDER */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-5">
        <h2 className="font-bold mb-1">Simulate incoming order</h2>
        <p className="text-xs text-slate-500 mb-4">Stands in for the platform webhook. Creates a RECEIVED order and reserves stock.</p>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm text-slate-600">
            <span className="block mb-1 font-medium">Platform</span>
            <select value={simPlatform} onChange={(e) => setSimPlatform(e.target.value)} className="h-10 px-3 border border-slate-200 rounded-lg bg-white">
              <option value="uber">Uber Eats</option>
              <option value="deliveroo">Deliveroo</option>
            </select>
          </label>
          <label className="text-sm text-slate-600 min-w-[220px]">
            <span className="block mb-1 font-medium">Product (configured for the platform)</span>
            <select value={simProductId} onChange={(e) => setSimProductId(e.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg bg-white">
              <option value="">Select product...</option>
              {products
                .filter((p) => (simPlatform === "uber" ? p.availableOnUber : p.availableOnDeliveroo))
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
          </label>
          <label className="text-sm text-slate-600">
            <span className="block mb-1 font-medium">Qty</span>
            <input type="number" min="1" value={simQty} onChange={(e) => setSimQty(e.target.value)} className="w-20 h-10 px-3 border border-slate-200 rounded-lg" />
          </label>
          <label className="text-sm text-slate-600">
            <span className="block mb-1 font-medium">Customer</span>
            <input value={simName} onChange={(e) => setSimName(e.target.value)} placeholder="Name (optional)" className="h-10 px-3 border border-slate-200 rounded-lg" />
          </label>
          <label className="text-sm text-slate-600">
            <span className="block mb-1 font-medium">OTP</span>
            <input value={simOtp} onChange={(e) => setSimOtp(e.target.value)} placeholder="e.g. 1234" className="w-24 h-10 px-3 border border-slate-200 rounded-lg" />
          </label>
          <button onClick={simulateOrder} disabled={simBusy} className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {simBusy ? "Receiving..." : "Receive order"}
          </button>
        </div>
      </div>

      {/* PRODUCT PLATFORM CONFIG */}
      <div className="bg-white border border-slate-200 rounded-xl mb-5 overflow-hidden">
        <div className="p-5 border-b border-slate-100">
          <h2 className="font-bold">Product platform configuration</h2>
          <p className="text-xs text-slate-500 mt-1">Toggle availability independently per platform. Publishing is delegated to the platform service (simulated).</p>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th className="px-5 py-3 font-medium">Product</th>
                <th className="px-5 py-3 font-medium">Price</th>
                <th className="px-5 py-3 font-medium">Uber Eats</th>
                <th className="px-5 py-3 font-medium">Deliveroo</th>
                <th className="px-5 py-3 font-medium">Item IDs</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-t border-slate-100">
                  <td className="px-5 py-3">{product.name}<span className="text-slate-400 text-xs ml-2">{product.sku}</span></td>
                  <td className="px-5 py-3">{fmt(product.price)}</td>
                  <td className="px-5 py-3">
                    <input type="checkbox" checked={product.availableOnUber} onChange={() => toggleProductPlatform(product, "availableOnUber")} className="w-4 h-4 accent-blue-600" />
                  </td>
                  <td className="px-5 py-3">
                    <input type="checkbox" checked={product.availableOnDeliveroo} onChange={() => toggleProductPlatform(product, "availableOnDeliveroo")} className="w-4 h-4 accent-blue-600" />
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-400">{product.uberItemId || "-"} / {product.deliverooItemId || "-"}</td>
                </tr>
              ))}
              {!products.length && (
                <tr><td colSpan="5" className="px-5 py-6 text-center text-slate-400">{loading ? "Loading..." : "No products yet"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
                  <td className="px-5 py-3">{order.item_count}</td>
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
                <table className="w-full text-sm">
                  <tbody>
                    {detail.items.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100">
                        <td className="py-2">{item.product_name}</td>
                        <td className="py-2 text-slate-500">x{item.quantity}</td>
                        <td className="py-2 text-right">{fmt(item.total)}</td>
                      </tr>
                    ))}
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
    </div>
  );
}
