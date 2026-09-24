import { useEffect, useState } from "react";
import { Printer, RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";

const next = { NEW: "IN_PREPARATION", IN_PREPARATION: "READY", READY: "COMPLETED" };

export default function KitchenDisplay() {
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const r = await apiRequest("/api/hospitality/kds/tickets");
      setTickets(r.data || []);
      setError("");
    } catch (e) { setError(e.message); }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const advance = async (ticket) => {
    const status = next[ticket.status];
    if (!status) return;
    await apiRequest(`/api/hospitality/kds/tickets/${ticket.id}`, { method: "PUT", body: JSON.stringify({ status }) });
    load();
  };

  const printTicket = async (ticket) => {
    const r = await apiRequest(`/api/hospitality/kds/tickets/${ticket.id}/print`);
    const p = r.data;
    const w = window.open("", "_blank", "width=420,height=700");
    if (!w) return;
    const lines = p.items.map((i) => `${i.quantity} x ${i.name}${i.notes ? ` — ${i.notes}` : ""}`).join("\n");
    const text = `${p.title}\n${p.orderNumber}${p.tableNumber ? ` · Table ${p.tableNumber}` : ""}\n\n${lines}${p.notes ? `\n\nNotes: ${p.notes}` : ""}`;
    const pre = w.document.createElement("pre");
    pre.style.font = "16px monospace";
    pre.textContent = text;
    w.document.body.appendChild(pre);
    w.document.close();
    w.print();
  };

  return <main className="onepos-page-enter min-h-screen bg-slate-950 p-4 text-white"><div className="mx-auto max-w-7xl">
    <header className="mb-4 flex items-center justify-between"><div><div className="text-xs text-slate-400">OneKDS</div><h1 className="text-2xl font-semibold">Kitchen Display</h1></div><button className="onepos-btn" onClick={load}><RefreshCw size={16}/> Refresh</button></header>
    {error && <div className="mb-4 rounded-xl bg-red-950 p-3">{error}</div>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{tickets.map((t) => <article key={t.id} className="rounded-2xl bg-white p-4 text-slate-900">
      <div className="flex justify-between"><b>{t.order_number || "Order"}</b><span className="text-xs">{t.status}</span></div>
      <div className="mt-1 text-sm text-slate-500">{t.table_number ? `Table ${t.table_number}` : "Takeaway / counter"}</div>
      <div className="my-4 space-y-2">{(Array.isArray(t.items) ? t.items : []).map((i, n) => <div key={n} className="flex justify-between border-b pb-1"><span>{i.name || i.product_name || "Item"}</span><b>×{i.quantity || 1}</b></div>)}</div>
      <div className="flex gap-2"><button className="onepos-btn" aria-label="Print kitchen ticket" onClick={() => printTicket(t)}><Printer size={15}/></button>{next[t.status] && <button className="onepos-btn onepos-btn-primary flex-1" onClick={() => advance(t)}>{t.status === "NEW" ? "Start preparing" : t.status === "IN_PREPARATION" ? "Mark ready" : "Complete"}</button>}</div>
    </article>)}</div>
  </div></main>;
}
