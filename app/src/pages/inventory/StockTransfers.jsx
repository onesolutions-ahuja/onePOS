import { useEffect, useState } from "react";
import { ArrowRight, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

/*
 * Stock Transfers — move stock between a company's own stores.
 *
 * The backend is authoritative: creating a transfer atomically writes the
 * TRANSFER_OUT/TRANSFER_IN movement pair through the shared inventory
 * primitive, so the source can never go negative (existing onePOS rule) and
 * a failed leg rolls back both. This view only composes the request and
 * displays the server's result/history.
 */

const fmtQty = (n) => `${Number(n || 0) % 1 === 0 ? Number(n || 0) : Number(n || 0).toFixed(3)}`;

function CreateTransfer({ stores, onDone, onError, onMessage }) {
  const [fromStoreId, setFromStoreId] = useState("");
  const [toStoreId, setToStoreId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ productId: "", productName: "", quantity: "" }]);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const activePicker = lines.findIndex((l) => !l.productId);

  const searchProducts = async () => {
    if (!search.trim()) return;
    try {
      setSearching(true);
      const data = await apiRequest(`/api/products?search=${encodeURIComponent(search.trim())}`);
      setResults(data.success ? data.data || [] : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const setLine = (index, patch) =>
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const pickProduct = (product) => {
    if (activePicker === -1) return;
    setLine(activePicker, { productId: product.id, productName: product.name });
    setSearch("");
    setResults([]);
    setLines((prev) => (prev.every((l) => l.productId) ? [...prev, { productId: "", productName: "", quantity: "" }] : prev));
  };

  const submit = async () => {
    onError("");
    if (!fromStoreId || !toStoreId) return onError("Choose both locations.");
    if (fromStoreId === toStoreId) return onError("Source and destination must be different.");
    const items = lines
      .filter((l) => l.productId)
      .map((l) => ({ productId: l.productId, quantity: Number(l.quantity) }));
    if (!items.length) return onError("Add at least one product.");
    if (items.some((i) => !Number.isFinite(i.quantity) || i.quantity <= 0)) {
      return onError("Quantities must be greater than zero.");
    }
    try {
      setSubmitting(true);
      const data = await apiRequest("/api/inventory/transfers", {
        method: "POST",
        body: JSON.stringify({ fromStoreId, toStoreId, notes: notes.trim() || null, items }),
      });
      if (!data.success) throw new Error(data.message || "Unable to complete transfer");
      onMessage(`Transfer ${data.data.transferNumber} completed.`);
      onDone();
    } catch (err) {
      onError(err.message || "Unable to complete transfer");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block text-xs uppercase text-slate-500 mb-1">From location</span>
          <select value={fromStoreId} onChange={(e) => setFromStoreId(e.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm">
            <option value="">Select source…</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs uppercase text-slate-500 mb-1">To location</span>
          <select value={toStoreId} onChange={(e) => setToStoreId(e.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm">
            <option value="">Select destination…</option>
            {stores.filter((s) => s.id !== fromStoreId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase text-slate-500">Products</div>
        {lines.map((line, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="flex-1 text-sm border border-slate-200 rounded-lg px-3 h-10 flex items-center justify-between">
              <span className={line.productName ? "" : "text-slate-400"}>{line.productName || "Pick a product…"}</span>
              {line.productId && (
                <button onClick={() => setLine(index, { productId: "", productName: "" })} title="Clear"><X size={14} /></button>
              )}
            </div>
            <input
              type="number"
              min="0"
              step="any"
              placeholder="Qty"
              value={line.quantity}
              onChange={(e) => setLine(index, { quantity: e.target.value })}
              className="w-24 h-10 px-3 border border-slate-200 rounded-lg text-sm"
            />
            {lines.length > 1 && (
              <button onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))} title="Remove line" className="p-2 text-slate-400 hover:text-red-600">
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
        <div className="relative">
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), searchProducts())}
              placeholder="Search products to add…"
              className="flex-1 h-10 px-3 border border-slate-200 rounded-lg text-sm"
            />
            <button onClick={searchProducts} className="h-10 px-3 border border-slate-200 rounded-lg text-sm flex items-center gap-1 hover:bg-slate-50">
              <Plus size={15} /> Add
            </button>
          </div>
          {results.length > 0 && (
            <div className="absolute z-10 mt-1 w-full max-h-56 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg">
              {results.map((p) => (
                <button key={p.id} onClick={() => pickProduct(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                  {p.name} <span className="text-xs text-slate-400">{p.sku || ""}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <label className="block text-sm">
        <span className="block text-xs uppercase text-slate-500 mb-1">Reason / notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
      </label>

      <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
        <div className="text-sm text-slate-500">
          Review: {lines.filter((l) => l.productId).length} product(s)
          {fromStoreId && toStoreId && fromStoreId !== toStoreId && (
            <span className="ml-2 inline-flex items-center gap-1">
              {stores.find((s) => s.id === fromStoreId)?.name} <ArrowRight size={13} /> {stores.find((s) => s.id === toStoreId)?.name}
            </span>
          )}
        </div>
        <button
          onClick={submit}
          disabled={submitting}
          className="onepos-btn onepos-btn-primary"
        >
          {submitting ? "Transferring…" : "Submit transfer"}
        </button>
      </div>
    </div>
  );
}

function TransferHistory({ reloadKey, onOpen }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setError("");
        const data = await apiRequest("/api/inventory/transfers");
        if (!data.success) throw new Error(data.message);
        setRows(data.data || []);
      } catch (err) {
        setError(err.message || "Unable to load transfers");
      }
    })();
  }, [reloadKey]);

  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>;
  if (!rows) return <div className="p-8 text-center text-slate-400"><RefreshCw size={22} className="mx-auto mb-2 animate-spin" />Loading transfers…</div>;
  if (!rows.length) return <div className="p-8 text-center text-slate-400">No transfers yet.</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {["Transfer", "From", "To", "Products", "Qty", "Status", "By", "When", ""].map((h) => (
              <th key={h} className={`px-3 py-2 text-xs uppercase text-slate-500 ${h === "Qty" ? "text-right" : "text-left"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-sm font-mono">{t.transfer_number}</td>
              <td className="px-3 py-2 text-sm">{t.from_store_name}</td>
              <td className="px-3 py-2 text-sm">{t.to_store_name}</td>
              <td className="px-3 py-2 text-sm text-right">{t.item_count}</td>
              <td className="px-3 py-2 text-sm text-right">{fmtQty(t.total_quantity)}</td>
              <td className="px-3 py-2 text-sm">{t.status}</td>
              <td className="px-3 py-2 text-sm">{t.created_by_name || "—"}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{new Date(t.created_at).toLocaleString()}</td>
              <td className="px-3 py-2 text-sm">
                <button onClick={() => onOpen(t.id)} className="text-blue-600 hover:underline">View</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TransferDetail({ id, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest(`/api/inventory/transfers/${id}`);
        if (!res.success) throw new Error(res.message);
        setData(res.data);
      } catch (err) {
        setError(err.message || "Unable to load transfer");
      }
    })();
  }, [id]);

  if (error) return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[720px] max-w-full p-5 text-sm text-red-600">{error}<button onClick={onClose} className="block mt-3 underline">Close</button></div></div>;
  if (!data) return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[720px] max-w-full p-8 text-center"><RefreshCw size={22} className="mx-auto animate-spin" /></div></div>;

  const { transfer, items, movements } = data;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[720px] max-w-full max-h-[85vh] shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <div>
            <h2 className="font-bold text-lg">Transfer {transfer.transfer_number}</h2>
            <p className="text-xs text-slate-500">
              {transfer.from_store_name} → {transfer.to_store_name} · {transfer.status} · by {transfer.created_by_name || "—"} · {new Date(transfer.created_at).toLocaleString()}
            </p>
          </div>
          <button onClick={onClose} title="Close"><X size={18} /></button>
        </div>
        <div className="p-4 overflow-auto space-y-4">
          <table className="w-full">
            <thead><tr className="bg-slate-50">{["Product", "SKU", "Quantity"].map((h) => <th key={h} className={`px-3 py-2 text-xs uppercase text-slate-500 ${h === "Quantity" ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.product_id} className="border-t">
                  <td className="px-3 py-2 text-sm">{i.product_name}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{i.sku || "—"}</td>
                  <td className="px-3 py-2 text-sm text-right">{fmtQty(i.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {transfer.notes && <div className="text-sm text-slate-600">Notes: {transfer.notes}</div>}
          <div>
            <div className="text-xs uppercase text-slate-500 mb-1">Movement audit trail</div>
            <table className="w-full">
              <thead><tr className="bg-slate-50">{["Type", "Store", "Change", "Balance", "User"].map((h) => <th key={h} className={`px-3 py-2 text-xs uppercase text-slate-500 ${h === "Change" || h === "Balance" ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
              <tbody>
                {movements.map((m, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-2 text-sm font-semibold">{m.movement_type}</td>
                    <td className="px-3 py-2 text-sm">{m.store_name || "—"}</td>
                    <td className={`px-3 py-2 text-sm text-right ${m.quantity_change < 0 ? "text-red-700" : "text-emerald-700"}`}>
                      {m.quantity_change > 0 ? "+" : ""}{fmtQty(m.quantity_change)}
                    </td>
                    <td className="px-3 py-2 text-sm text-right">{fmtQty(m.balance_after)}</td>
                    <td className="px-3 py-2 text-sm">{m.username || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StockTransfers() {
  const [stores, setStores] = useState([]);
  const [mode, setMode] = useState("history"); // history | create
  const [reloadKey, setReloadKey] = useState(0);
  const [openTransfer, setOpenTransfer] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const data = await apiRequest("/api/inventory/transfer-stores");
        if (!data.success) throw new Error(data.message);
        setStores(data.data || []);
      } catch (err) {
        setError(err.message || "Unable to load locations");
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
          <button onClick={() => setMode("history")} className={`px-4 h-9 text-sm ${mode === "history" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>History</button>
          <button onClick={() => setMode("create")} className={`px-4 h-9 text-sm ${mode === "create" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>Create Transfer</button>
        </div>
        {mode === "history" && (
          <button onClick={() => setReloadKey((k) => k + 1)} className="h-9 px-3 border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw size={15} /> Refresh
          </button>
        )}
      </div>

      {message && <div className="px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{message}</div>}
      {error && <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {stores.length < 2 && mode === "create" && (
        <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-sm">
          You need access to at least two locations to create a transfer.
        </div>
      )}

      {mode === "create" ? (
        <CreateTransfer
          stores={stores}
          onMessage={(m) => { setMessage(m); setError(""); setReloadKey((k) => k + 1); setMode("history"); }}
          onError={setError}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <TransferHistory reloadKey={reloadKey} onOpen={setOpenTransfer} />
        </div>
      )}

      {openTransfer && <TransferDetail id={openTransfer} onClose={() => setOpenTransfer(null)} />}
    </div>
  );
}
