import { useEffect, useState } from "react";
import { FileText, MessageCircle, RefreshCw, Search, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
function SalesAdmin() {
  const [sales, setSales] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [search, setSearch] = useState(""); const [detail, setDetail] = useState(null);
  const load = async () => { try { setLoading(true); setError(""); const data = await apiRequest(`/api/sales${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`); if (!data.success) throw new Error(data.message); setSales(data.data || []); } catch (err) { setError(err.message || "Unable to load sales"); } finally { setLoading(false); } };
  useEffect(() => { const timer = setTimeout(load, 250); return () => clearTimeout(timer); }, [search]);
  const open = async (sale) => { try { const data = await apiRequest(`/api/sales/${sale.id}`); if (!data.success) throw new Error(data.message); setDetail(data.data); } catch (err) { setError(err.message || "Unable to load sale"); } };
  return <div><div className="onepos-page-header"><div><h1 className="onepos-page-title">Sales</h1><p className="onepos-page-subtitle">Completed and recorded till transactions.</p></div><button onClick={load} className="onepos-btn onepos-btn-secondary"><RefreshCw size={16} /> Refresh</button></div><div className="onepos-card overflow-hidden"><div className="onepos-toolbar"><div className="relative max-w-md"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search sale, customer or ID..." className="onepos-input pl-10" /></div></div>{loading ? <div className="onepos-empty">Loading sales...</div> : error ? <div className="onepos-empty text-red-600"><span>{error}</span><button onClick={load} className="onepos-btn onepos-btn-primary mt-3">Retry</button></div> : sales.length === 0 ? <div className="onepos-empty"><span className="onepos-empty-title">No sales found.</span></div> : <div className="overflow-x-auto"><table className="onepos-table"><thead><tr>{["Sale", "Date/time", "Store", "Customer", "Items", "Total", "Payment", "Status", "Cashier"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{sales.map((sale) => <tr key={sale.id} onClick={() => open(sale)} className="cursor-pointer"><td className="px-4 py-3 text-sm font-medium">{sale.receipt_number || sale.id.slice(0, 8)}</td><td className="px-4 py-3 text-xs text-slate-500">{new Date(sale.created_at).toLocaleString()}</td><td className="px-4 py-3 text-sm">{sale.store_name || "-"}</td><td className="px-4 py-3 text-sm">{sale.customer_name}</td><td className="px-4 py-3 text-sm">{sale.item_count}</td><td className="px-4 py-3 text-sm font-semibold">£{Number(sale.total).toFixed(2)}</td><td className="px-4 py-3 text-sm">{sale.payment_method || "-"}</td><td className="px-4 py-3 text-sm">{sale.status}</td><td className="px-4 py-3 text-sm">{sale.cashier || "-"}</td></tr>)}</tbody></table></div>}</div>{detail && <SaleDetailModal sale={detail} onClose={() => setDetail(null)} />}</div>;
}

function SaleDetailModal({ sale, onClose }) {
  /*
   * T9Q-NEXT-SMALL: manual "Resend invoice via WhatsApp". Reuses the
   * existing backend delivery pipeline; the backend re-verifies tenant
   * scope, WhatsApp activation and the customer's phone. Confirmation
   * before sending; clear success/failure result; never blocks the modal.
   */
  const [resendState, setResendState] = useState("idle"); // idle | confirm | sending | sent | failed
  const [resendMessage, setResendMessage] = useState("");
  /*
   * T9D-NEXT: Send by SMS / Email actions. Same confirm-then-send UX as the
   * WhatsApp resend; each channel posts to its own tenant-scoped endpoint.
   * The customer's stored contact is always the recipient (no free-text
   * recipient on the sale view - use Settings for demo test sends).
   */
  const [channelState, setChannelState] = useState({ channel: null, phase: "idle", message: "" });

  const sendByChannel = async (channel) => {
    if (channelState.phase === "sending") return;
    if (channelState.channel !== channel || channelState.phase !== "confirm") {
      setChannelState({ channel, phase: "confirm", message: "" });
      return;
    }
    setChannelState({ channel, phase: "sending", message: "" });
    try {
      const data = await apiRequest(`/api/invoice-delivery/${channel}/resend`, {
        method: "POST",
        body: JSON.stringify({ saleId: sale.id }),
      });
      if (!data?.success) throw new Error(data?.message || "Send failed");
      setChannelState({ channel, phase: "sent", message: data.message || "Invoice sent." });
    } catch (err) {
      setChannelState({ channel, phase: "failed", message: err.message || "Send failed" });
    }
  };

  const channelButton = (channel, label) => {
    const st = channelState.channel === channel ? channelState : { phase: "idle", message: "" };
    return (
      <div key={channel} className="flex items-center gap-2">
        {st.phase === "confirm" ? (
          <>
            <span className="text-sm font-medium">Send this invoice by {label}?</span>
            <button
              type="button"
              onClick={() => sendByChannel(channel)}
              disabled={st.phase === "sending"}
              className="h-8 px-3 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {st.phase === "sending" ? "Sending…" : "Yes, send"}
            </button>
            <button
              type="button"
              onClick={() => setChannelState({ channel: null, phase: "idle", message: "" })}
              className="h-8 px-3 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
          </>
        ) : st.phase === "sent" ? (
          <span className="text-sm text-emerald-700 font-medium">✓ {st.message}</span>
        ) : st.phase === "failed" ? (
          <>
            <span className="text-sm text-red-600">✕ {st.message}</span>
            <button
              type="button"
              onClick={() => setChannelState({ channel, phase: "confirm", message: "" })}
              className="h-8 px-3 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
            >
              Try again
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => sendByChannel(channel)}
            className="h-8 px-3 border border-blue-200 text-blue-700 rounded-lg text-sm hover:bg-blue-50"
            title={`Send the customer their invoice by ${label}`}
          >
            Send by {label}
          </button>
        )}
      </div>
    );
  };

  const resendInvoice = async () => {
    if (resendState === "sending") return;
    setResendState("sending");
    setResendMessage("");
    try {
      const data = await apiRequest("/api/whatsapp/resend-invoice", {
        method: "POST",
        body: JSON.stringify({ saleId: sale.id }),
      });
      if (!data?.success) throw new Error(data?.message || "Resend failed");
      setResendState("sent");
      setResendMessage(
        data.data?.mode === "pdf" ? "Sent as PDF receipt." : "Sent as secure invoice link."
      );
    } catch (err) {
      setResendState("failed");
      setResendMessage(err.message || "Resend failed");
    }
  };

  const resendButton = (
    <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-3 flex-wrap">
      {channelButton("sms", "SMS")}
      {channelButton("email", "Email")}
      <span className="text-slate-200">|</span>
      {resendState === "confirm" ? (
        <>
          <span className="text-sm font-medium">Send this invoice via WhatsApp?</span>
          <button
            type="button"
            onClick={resendInvoice}
            disabled={resendState === "sending"}
            className="h-8 px-3 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {resendState === "sending" ? "Sending…" : "Yes, send"}
          </button>
          <button
            type="button"
            onClick={() => setResendState("idle")}
            className="h-8 px-3 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
        </>
      ) : resendState === "sent" ? (
        <span className="text-sm text-emerald-700 font-medium">✓ Invoice sent via WhatsApp{resendMessage ? ` — ${resendMessage}` : ""}</span>
      ) : resendState === "failed" ? (
        <>
          <span className="text-sm text-red-600">✕ {resendMessage}</span>
          <button
            type="button"
            onClick={() => setResendState("confirm")}
            className="h-8 px-3 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
          >
            Try again
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setResendState("confirm")}
          className="h-8 px-3 border border-emerald-200 text-emerald-700 rounded-lg text-sm hover:bg-emerald-50 flex items-center gap-1"
          title="Send the customer their invoice via WhatsApp"
        >
          <MessageCircle size={14} /> Resend invoice via WhatsApp
        </button>
      )}
    </div>
  );

  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="onepos-card w-[760px] max-w-full max-h-[85vh] flex flex-col"><div className="onepos-card-header"><div><h2 className="font-bold text-lg">Sale {sale.receipt_number || sale.id.slice(0, 8)}</h2><p className="text-xs text-slate-500">{new Date(sale.created_at).toLocaleString()} · {sale.store_name || "-"}</p></div><button onClick={onClose} className="p-2" title="Close"><X size={18} /></button></div><div className="p-4 overflow-auto"><div className="grid grid-cols-2 gap-3 text-sm mb-5"><div>Customer<div className="font-medium">{sale.customer_name || "Walk-in Customer"}</div></div><div>Cashier<div className="font-medium">{sale.cashier || "-"}</div></div><div>Status<div className="font-medium">{sale.status}</div></div><div>Payment<div className="font-medium">{sale.payment_method || "-"} · £{Number(sale.payment_amount || 0).toFixed(2)}</div></div></div><table className="onepos-table"><thead><tr>{["Product", "Quantity", "Unit price", "Line total"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{(sale.items || []).map((item) => <tr key={item.id} className="border-t"><td className="px-3 py-2 text-sm">{item.product_name}</td><td className="px-3 py-2 text-sm">{item.quantity}</td><td className="px-3 py-2 text-sm">£{Number(item.unit_price).toFixed(2)}</td><td className="px-3 py-2 text-sm font-semibold">£{Number(item.total).toFixed(2)}</td></tr>)}</tbody></table><div className="text-right mt-5 text-sm">Subtotal £{Number(sale.subtotal).toFixed(2)} · VAT £{Number(sale.tax).toFixed(2)} · Discount £{Number(sale.discount).toFixed(2)} · <strong>Total £{Number(sale.total).toFixed(2)}</strong></div>{resendButton}</div></div></div>;
}

export default SalesAdmin;
