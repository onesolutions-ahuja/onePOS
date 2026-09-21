import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History, RefreshCw, Search, ShoppingCart, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { getConnectivity, SERVER_STATES, subscribeConnectivity } from "../../services/connectivity.js";

/*
 * T9M-SMALL - Sales Returns UI.
 *
 * Two tabs:
 *  - "Process return": find a completed sale by receipt number (or sale ID),
 *    see customer/payment/already-returned/remaining quantities, pick items,
 *    review the refund total, confirm. All displayed quantities come from the
 *    authoritative GET /returns/lookup; totals are recalculated server-side
 *    on submit (browser values are display-only).
 *  - "Return history": every customer + supplier return for the tenant with
 *    an expandable per-item detail view.
 *
 * The supplier returns view (existing) is unchanged and exported separately.
 */

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

function ProcessReturnTab({ onMessage, onError }) {
  const [search, setSearch] = useState("");
  const [lookup, setLookup] = useState(null); // { sale, items }
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState("");
  const [step, setStep] = useState("select"); // select | review
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  /* Refunds are online-only: they must be validated and recorded by the
     backend in one transaction, which the offline queue cannot offer. */
  const [serverConnected, setServerConnected] = useState(
    getConnectivity().server === SERVER_STATES.CONNECTED,
  );
  useEffect(() => subscribeConnectivity((snapshot) => {
    setServerConnected(snapshot.server === SERVER_STATES.CONNECTED);
  }), []);

  const doLookup = async (term) => {
    const value = String(term || "").trim();
    if (!value) return;
    setBusy(true);
    setError("");
    setResult(null);
    setStep("select");
    try {
      const data = await apiRequest(`/api/returns/lookup?receipt=${encodeURIComponent(value)}`);
      if (!data?.success) throw new Error(data?.message || "Sale not found.");
      const sale = data.data.sale;
      if (!sale.returnable) {
        throw new Error(`This sale cannot be returned (status: ${sale.status}).`);
      }
      setLookup(data.data);
      setQuantities({});
      setReason("");
    } catch (err) {
      setLookup(null);
      setError(err.message || "Sale not found.");
    } finally {
      setBusy(false);
    }
  };

  const setQty = (itemId, value) => {
    const item = lookup.items.find((row) => row.id === itemId);
    if (!item) return;
    let qty = Number(value);
    if (!Number.isFinite(qty) || qty < 0) qty = 0;
    if (qty > item.remainingQuantity) qty = item.remainingQuantity;
    setQuantities((current) => ({ ...current, [itemId]: qty }));
  };

  const selectedLines = lookup
    ? lookup.items
        .map((item) => ({ item, quantity: Number(quantities[item.id] || 0) }))
        .filter((entry) => entry.quantity > 0)
    : [];
  const reviewTotal = selectedLines.reduce((sum, entry) => sum + entry.item.unitRefundValue * entry.quantity, 0);

  const submit = async () => {
    if (busy || !selectedLines.length) return;
    if (!serverConnected) {
      setError("Refunds require a connection to the onePOS server. Reconnect and try again — offline refunds are not supported.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await apiRequest("/api/returns/customer", {
        method: "POST",
        body: JSON.stringify({
          saleId: lookup.sale.id,
          items: selectedLines.map(({ item, quantity }) => ({
            saleItemId: item.id,
            productId: item.productId,
            quantity,
          })),
          reason: reason || null,
          // Stable per-sale+cart key: a double-submit or a retry of the same
          // cart hits the server-side idempotency guard instead of creating
          // a second return.
          requestKey: `return-${lookup.sale.id}-${selectedLines.map((l) => `${l.item.id}:${l.quantity}`).join("_")}`,
        }),
      });
      if (!data?.success) throw new Error(data?.message || "Unable to process the return.");
      setResult(data.data || {});
      setLookup(null);
      setSearch("");
      setQuantities({});
      setReason("");
      setStep("select");
      if (onMessage) onMessage(data.message || "Return processed.");
    } catch (err) {
      setError(err.message || "Unable to process the return.");
      if (onError) onError(err.message || "Unable to process the return.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Receipt lookup */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <label className="text-sm font-medium text-slate-700">Find sale by receipt number</label>
        <div className="flex gap-2 mt-2">
          <div className="relative flex-1 max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && doLookup(search)}
              placeholder="e.g. T01-20260917-0001"
              className="w-full h-10 pl-9 pr-3 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => doLookup(search)}
            disabled={busy || !search.trim()}
            className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40"
          >
            {busy ? "Searching…" : "Find sale"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      {/* Success banner */}
      {result && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm">
          <div className="font-medium text-emerald-800">
            Return {result.returnNumber} processed successfully.
          </div>
              {result.refund?.amount > 0 && (
            <div className="text-emerald-700 mt-1">
              Refund recorded: {money(result.refund.amount)}
              {result.refund.allocation?.length > 1
                ? ` · via ${result.refund.allocation.map((part) => `${part.method} ${money(part.amount)}`).join(" + ")}`
                : result.refund.method
                  ? ` · via ${result.refund.method}`
                  : ""}
              .
              {/card/i.test(result.refund.method || "") && " Process the card-terminal refund separately."}
            </div>
          )}
        </div>
      )}

      {/* Sale + item selection */}
      {lookup && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/60">
            <div className="flex justify-between items-start flex-wrap gap-2">
              <div>
                <div className="font-semibold">Sale {lookup.sale.receiptNumber || lookup.sale.id.slice(0, 8)}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {lookup.sale.saleDate ? new Date(lookup.sale.saleDate).toLocaleString() : "-"} · Total {money(lookup.sale.totals.total)} · Refunded so far {money(lookup.sale.refunded)}
                </div>
              </div>
              <button type="button" onClick={() => setLookup(null)} className="p-1.5 text-slate-400 hover:text-slate-600" title="Clear">
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 text-xs">
              <div>
                <span className="text-slate-400 block">Customer</span>
                <span className="text-slate-700">{lookup.sale.customer ? lookup.sale.customer.name : "Walk-in"}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Payment</span>
                <span className="text-slate-700">
                  {lookup.sale.payments?.length
                    ? lookup.sale.payments.map((p) => `${p.method} · ${money(p.amount)}`).join("  +  ")
                    : lookup.sale.payment
                      ? `${lookup.sale.payment.method} · ${money(lookup.sale.payment.amount)}`
                      : "-"}
                </span>
                {lookup.sale.payments?.length > 1 && (
                  <span className="text-amber-700 block">Split payment — refund is allocated across the original methods</span>
                )}
              </div>
              <div>
                <span className="text-slate-400 block">Returnable value</span>
                <span className="text-slate-700 font-medium">{money(lookup.sale.returnableValue)}</span>
              </div>
            </div>
          </div>

          {step === "select" ? (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-100">
                    <th className="px-4 py-2 font-medium">Product</th>
                    <th className="px-2 py-2 font-medium text-right">Sold</th>
                    <th className="px-2 py-2 font-medium text-right">Returned</th>
                    <th className="px-2 py-2 font-medium text-right">Remaining</th>
                    <th className="px-2 py-2 font-medium text-right">Unit value</th>
                    <th className="px-4 py-2 font-medium text-right">Return qty</th>
                  </tr>
                </thead>
                <tbody>
                  {lookup.items.map((item) => (
                    <tr key={item.id} className="border-b border-slate-50">
                      <td className="px-4 py-2 text-slate-700">{item.productName}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{item.quantity}</td>
                      <td className="px-2 py-2 text-right text-slate-500">{item.returnedQuantity}</td>
                      <td className="px-2 py-2 text-right font-medium text-slate-700">{item.remainingQuantity}</td>
                      <td className="px-2 py-2 text-right text-slate-600">{money(item.unitRefundValue)}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          max={item.remainingQuantity}
                          step="0.001"
                          disabled={item.remainingQuantity <= 0 || busy}
                          value={quantities[item.id] ?? ""}
                          onChange={(event) => setQty(item.id, event.target.value)}
                          placeholder={item.remainingQuantity <= 0 ? "—" : "0"}
                          className="w-20 h-8 border border-slate-200 rounded px-2 text-sm text-right disabled:opacity-40"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-4 border-t border-slate-100 flex items-center justify-between flex-wrap gap-3">
                <label className="text-sm text-slate-600 flex-1 min-w-[220px]">
                  <span className="block mb-1 text-xs font-medium">Return reason (optional)</span>
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="e.g. Faulty, wrong size"
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm"
                  />
                </label>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-600">
                    Refund total: <strong>{money(reviewTotal)}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep("review")}
                    disabled={!selectedLines.length}
                    className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Review return
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="p-4">
              <h3 className="font-semibold text-sm mb-3">Review before confirming</h3>
              {!serverConnected && (
                <p role="status" className="mb-3 rounded bg-amber-50 p-2.5 text-xs text-amber-800">
                  Offline — refunds are online-only. The refund must be validated and recorded by the onePOS server.
                </p>
              )}
              <table className="w-full text-sm mb-4">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-100">
                    <th className="py-2 pr-3 font-medium">Product</th>
                    <th className="py-2 pr-3 font-medium text-right">Qty</th>
                    <th className="py-2 font-medium text-right">Refund</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedLines.map(({ item, quantity }) => (
                    <tr key={item.id} className="border-b border-slate-50">
                      <td className="py-2 pr-3">{item.productName}</td>
                      <td className="py-2 pr-3 text-right">{quantity}</td>
                      <td className="py-2 text-right">{money(item.unitRefundValue * quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="text-sm text-slate-600">
                  {reason ? <span>Reason: <em>{reason}</em> · </span> : null}
                  Total refund: <strong className="text-slate-900">{money(reviewTotal)}</strong>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setStep("select")} className="h-9 px-3 border border-slate-300 rounded-lg text-sm hover:bg-slate-50">
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={busy || !serverConnected}
                    className="h-9 px-4 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                  >
                    {busy ? "Processing…" : "Confirm return"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReturnHistoryTab() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [expanded, setExpanded] = useState(null); // return id
  const [detail, setDetail] = useState(null); // return id -> items

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest("/api/returns");
      if (!data?.success) throw new Error(data?.message || "Unable to load returns");
      setReturns(data.data || []);
    } catch (err) {
      setError(err.message || "Unable to load returns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleDetail = async (returnId) => {
    if (expanded === returnId) {
      setExpanded(null);
      return;
    }
    setExpanded(returnId);
    if (!detail?.[returnId]) {
      try {
        const data = await apiRequest(`/api/returns/${returnId}`);
        if (data?.success) {
          setDetail((current) => ({ ...current, [returnId]: data.data.items || [] }));
        }
      } catch {
        /* detail stays collapsed-empty; list row still shows summary */
      }
    }
  };

  const filtered = returns.filter((row) => {
    if (typeFilter !== "ALL" && row.returnType !== typeFilter) return false;
    if (!search.trim()) return true;
    const haystack = [row.returnNumber, row.originalInvoice, row.customerName, row.reason]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  const statusPill = (status) =>
    status === "COMPLETED"
      ? "bg-emerald-50 text-emerald-700"
      : status === "CANCELLED"
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-500";

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search return number, invoice, customer, reason…"
              className="w-full h-10 pl-9 pr-3 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="h-10 px-3 border border-slate-200 rounded-lg text-sm"
          >
            <option value="ALL">All returns</option>
            <option value="CUSTOMER">Customer returns</option>
            <option value="SUPPLIER">Supplier returns</option>
          </select>
          <button type="button" onClick={load} className="h-10 px-3 border border-slate-200 rounded-lg text-sm text-slate-500 hover:bg-slate-50 flex items-center gap-1">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Loading returns…</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-sm">No returns found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-100 bg-slate-50/60">
                <th className="px-4 py-2.5 font-medium"></th>
                <th className="px-2 py-2.5 font-medium">Return</th>
                <th className="px-2 py-2.5 font-medium">Original invoice</th>
                <th className="px-2 py-2.5 font-medium">Date</th>
                <th className="px-2 py-2.5 font-medium">Customer</th>
                <th className="px-2 py-2.5 font-medium text-right">Items</th>
                <th className="px-2 py-2.5 font-medium text-right">Refund</th>
                <th className="px-2 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <>
                  <tr
                    key={row.id}
                    className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer"
                    onClick={() => toggleDetail(row.id)}
                  >
                    <td className="px-4 py-2.5 w-8">
                      {expanded === row.id ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                    </td>
                    <td className="px-2 py-2.5 font-medium text-slate-700">{row.returnNumber || row.id.slice(0, 8)}</td>
                    <td className="px-2 py-2.5 text-slate-600">{row.originalInvoice || "-"}</td>
                    <td className="px-2 py-2.5 text-xs text-slate-500 whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="px-2 py-2.5 text-slate-600">{row.customerName || "-"}</td>
                    <td className="px-2 py-2.5 text-right text-slate-600">{row.itemCount} ({row.quantity})</td>
                    <td className="px-2 py-2.5 text-right font-medium text-slate-700">
                      {row.returnType === "CUSTOMER" && row.refundAmount !== null ? money(row.refundAmount) : "-"}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusPill(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 max-w-[200px] truncate" title={row.reason || ""}>
                      {row.reason || "-"}
                    </td>
                  </tr>
                  {expanded === row.id && (
                    <tr key={`${row.id}-detail`} className="border-b border-slate-50 bg-slate-50/40">
                      <td colSpan={9} className="px-8 py-3">
                        {detail?.[row.id]?.length ? (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-slate-400">
                                <th className="py-1 pr-4 font-medium">Product</th>
                                <th className="py-1 pr-4 font-medium text-right">Qty</th>
                                <th className="py-1 pr-4 font-medium text-right">Unit price</th>
                                <th className="py-1 font-medium">Item reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail[row.id].map((item, index) => (
                                <tr key={index}>
                                  <td className="py-1 pr-4 text-slate-700">{item.product_name || item.productId}</td>
                                  <td className="py-1 pr-4 text-right text-slate-600">{item.quantity}</td>
                                  <td className="py-1 pr-4 text-right text-slate-600">
                                    {item.unit_price ? money(item.unit_price) : "-"}
                                  </td>
                                  <td className="py-1 text-slate-500">{item.reason || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <span className="text-xs text-slate-400">Loading items…</span>
                        )}
                        <div className="text-xs text-slate-400 mt-2">
                          Processed by {row.createdBy || "-"} · {row.returnType === "CUSTOMER" ? "Customer return" : "Supplier return"}
                          {row.refundMethod ? ` · refund via ${row.refundMethod}` : ""}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ReturnsAdmin({ onMessage, onError }) {
  const [tab, setTab] = useState("process");
  return (
    <div>
      <div className="mb-5 flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Returns</h1>
          <p className="text-sm text-slate-500 mt-1">Process customer returns and review return history.</p>
        </div>
        <div className="flex gap-1 border border-slate-200 rounded-lg p-1 bg-white">
          <button
            type="button"
            onClick={() => setTab("process")}
            className={`h-8 px-3 rounded-md text-sm flex items-center gap-1.5 ${tab === "process" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            <ShoppingCart size={14} /> Process return
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            className={`h-8 px-3 rounded-md text-sm flex items-center gap-1.5 ${tab === "history" ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            <History size={14} /> Return history
          </button>
        </div>
      </div>
      {tab === "process" ? (
        <ProcessReturnTab onMessage={onMessage} onError={onError} />
      ) : (
        <ReturnHistoryTab />
      )}
    </div>
  );
}

function SupplierReturnsAdmin() {
  const [lines, setLines] = useState([]); const [returns, setReturns] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [selected, setSelected] = useState(null); const [quantity, setQuantity] = useState(""); const [reason, setReason] = useState(""); const [saving, setSaving] = useState(false);
  const load = async () => { try { setLoading(true); setError(""); const [available, history] = await Promise.all([apiRequest("/api/supplier-returns/available"), apiRequest("/api/returns")]); if (!available.success) throw new Error(available.message); setLines(available.data || []); setReturns((history.data || []).filter((item) => item.return_type === "SUPPLIER" || item.returnType === "SUPPLIER")); } catch (err) { setError(err.message || "Unable to load supplier returns"); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const submit = async (event) => { event.preventDefault(); const amount=Number(quantity); if (!selected || !Number.isFinite(amount) || amount <= 0 || amount > selected.remaining_quantity) { setError("Enter a valid quantity within the remaining returnable quantity."); return; } try { setSaving(true); const data=await apiRequest("/api/returns/supplier",{method:"POST",body:JSON.stringify({purchaseId:selected.purchase_id,items:[{purchaseItemId:selected.purchase_item_id,productId:selected.product_id,quantity:amount}],reason,requestKey:`supplier-return-${selected.purchase_item_id}-${Date.now()}`})}); if(!data.success) throw new Error(data.message); setMessage("Supplier return processed."); setSelected(null); setQuantity(""); setReason(""); await load(); } catch(err){setError(err.message||"Unable to process supplier return");} finally{setSaving(false);} };
  return <div><div className="flex justify-between items-center mb-5"><div><h1 className="text-2xl font-bold">Supplier Returns</h1><p className="text-sm text-slate-500 mt-1">Return received stock through the inventory ledger.</p></div><button onClick={load} className="h-10 px-4 bg-white border rounded-lg text-sm flex items-center gap-2"><RefreshCw size={16}/> Refresh</button></div>{message&&<div className="mb-4 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm">{message}</div>}{error&&<div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}<div className="bg-white border rounded-xl overflow-hidden">{loading?<div className="p-10 text-center text-slate-400">Loading supplier returns...</div>:<table className="w-full"><thead><tr className="bg-slate-50">{["Purchase","Supplier","Product","Received","Returned","Remaining","Action"].map(h=><th key={h} className="text-left px-4 py-3 text-xs uppercase text-slate-500">{h}</th>)}</tr></thead><tbody>{lines.map(line=><tr key={line.purchase_item_id} className="border-t"><td className="px-4 py-3 text-sm">{line.reference_number||line.purchase_id.slice(0,8)}</td><td className="px-4 py-3 text-sm">{line.supplier_name||"-"}</td><td className="px-4 py-3 text-sm font-medium">{line.product_name}</td><td className="px-4 py-3 text-sm">{line.received_quantity}</td><td className="px-4 py-3 text-sm">{line.returned_quantity}</td><td className="px-4 py-3 text-sm font-semibold">{line.remaining_quantity}</td><td className="px-4 py-3">{line.remaining_quantity>0?<button onClick={()=>setSelected(line)} className="px-3 py-2 bg-blue-50 text-blue-700 rounded text-sm">Return stock</button>:<span className="text-xs text-slate-400">Fully returned</span>}</td></tr>)}</tbody></table>}</div><div className="bg-white border rounded-xl mt-5 overflow-hidden"><div className="p-4 border-b font-semibold">Return history</div>{returns.length?<table className="w-full"><thead><tr className="bg-slate-50">{["Purchase","Supplier","Reason","Date","Created by"].map(h=><th key={h} className="text-left px-4 py-3 text-xs uppercase text-slate-500">{h}</th>)}</tr></thead><tbody>{returns.map(item=><tr key={item.id} className="border-t"><td className="px-4 py-3 text-sm">{item.originalInvoice||item.purchase_id?.slice(0,8)}</td><td className="px-4 py-3 text-sm">{item.customerName||item.supplier_name||"-"}</td><td className="px-4 py-3 text-sm">{item.reason||"-"}</td><td className="px-4 py-3 text-sm">{new Date(item.createdAt||item.created_at).toLocaleString()}</td><td className="px-4 py-3 text-sm">{item.createdBy||item.created_by||"-"}</td></tr>)}</tbody></table>:<div className="p-6 text-sm text-slate-500">No supplier returns recorded.</div>}</div>{selected&&<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><form onSubmit={submit} className="bg-white rounded-xl w-[440px] max-w-full p-5"><div className="flex justify-between mb-4"><div><h2 className="font-bold text-lg">Return Stock</h2><p className="text-sm text-slate-500">{selected.product_name} · remaining {selected.remaining_quantity}</p></div><button type="button" onClick={()=>setSelected(null)} title="Close"><X size={18}/></button></div><label className="block text-sm mb-3">Return quantity<input required type="number" min="0.001" max={selected.remaining_quantity} step="0.001" value={quantity} onChange={e=>setQuantity(e.target.value)} className="block w-full h-10 mt-1 border rounded px-2"/></label><label className="block text-sm">Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} rows="3" className="block w-full mt-1 border rounded p-2"/></label><div className="flex justify-end gap-2 mt-5"><button type="button" onClick={()=>setSelected(null)} className="px-4 py-2 border rounded text-sm">Cancel</button><button disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">{saving?"Processing...":"Confirm return"}</button></div></form></div>}</div>;
}

export default ReturnsAdmin;
export { SupplierReturnsAdmin };
