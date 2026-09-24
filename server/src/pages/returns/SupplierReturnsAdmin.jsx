import { useEffect, useState } from "react";
import { X, RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";

export default function SupplierReturnsAdmin() {
  const [lines, setLines] = useState([]);
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [available, history] = await Promise.all([apiRequest("/api/supplier-returns/available"), apiRequest("/api/returns")]);
      if (!available.success) throw new Error(available.message);
      setLines(available.data || []);
      setReturns((history.data || []).filter((item) => item.return_type === "SUPPLIER"));
    } catch (err) {
      setError(err.message || "Unable to load supplier returns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    const amount = Number(quantity);
    if (!selected || !Number.isFinite(amount) || amount <= 0 || amount > selected.remaining_quantity) {
      setError("Enter a valid quantity within the remaining returnable quantity.");
      return;
    }
    try {
      setSaving(true);
      const data = await apiRequest("/api/returns/supplier", {
        method: "POST",
        body: JSON.stringify({
          purchaseId: selected.purchase_id,
          items: [{ purchaseItemId: selected.purchase_item_id, productId: selected.product_id, quantity: amount }],
          reason,
          requestKey: `supplier-return-${selected.purchase_item_id}-${Date.now()}`,
        }),
      });
      if (!data.success) throw new Error(data.message);
      setMessage("Supplier return processed.");
      setSelected(null);
      setQuantity("");
      setReason("");
      await load();
    } catch (err) {
      setError(err.message || "Unable to process supplier return");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <div><h1 className="text-2xl font-bold">Supplier Returns</h1><p className="text-sm text-slate-500 mt-1">Return received stock through the inventory ledger.</p></div>
        <button onClick={load} className="h-10 px-4 bg-white border rounded-lg text-sm flex items-center gap-2"><RefreshCw size={16} /> Refresh</button>
      </div>
      {message && <div className="mb-4 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm">{message}</div>}
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
      <div className="bg-white border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-400">Loading supplier returns...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50">
                {["Purchase", "Supplier", "Product", "Received", "Returned", "Remaining", "Action"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs uppercase text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.purchase_item_id} className="border-t">
                  <td className="px-4 py-3 text-sm">{line.reference_number || line.purchase_id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm">{line.supplier_name || "-"}</td>
                  <td className="px-4 py-3 text-sm font-medium">{line.product_name}</td>
                  <td className="px-4 py-3 text-sm">{line.received_quantity}</td>
                  <td className="px-4 py-3 text-sm">{line.returned_quantity}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{line.remaining_quantity}</td>
                  <td className="px-4 py-3">
                    {line.remaining_quantity > 0 ? (
                      <button onClick={() => setSelected(line)} className="px-3 py-2 bg-blue-50 text-blue-700 rounded text-sm">Return stock</button>
                    ) : (
                      <span className="text-xs text-slate-400">Fully returned</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="bg-white border rounded-xl mt-5 overflow-hidden">
        <div className="p-4 border-b font-semibold">Return history</div>
        {returns.length ? (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50">
                {["Purchase", "Supplier", "Reason", "Date", "Created by"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs uppercase text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {returns.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="px-4 py-3 text-sm">{item.reference_number || item.purchase_id?.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm">{item.supplier_name || "-"}</td>
                  <td className="px-4 py-3 text-sm">{item.reason || "-"}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{new Date(item.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm">{item.created_by || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-6 text-sm text-slate-500">No supplier returns recorded.</div>
        )}
      </div>
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={submit} className="bg-white rounded-xl w-[440px] max-w-full p-5">
            <div className="flex justify-between mb-4">
              <div><h2 className="font-bold text-lg">Return Stock</h2><p className="text-sm text-slate-500">{selected.product_name} · remaining {selected.remaining_quantity}</p></div>
              <button type="button" onClick={() => setSelected(null)} title="Close"><X size={18} /></button>
            </div>
            <label className="block text-sm mb-3">Return quantity<input required type="number" min="0.001" max={selected.remaining_quantity} step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="block w-full h-10 mt-1 border rounded px-2" /></label>
            <label className="block text-sm">Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows="3" className="block w-full mt-1 border rounded p-2" /></label>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setSelected(null)} className="px-4 py-2 border rounded text-sm">Cancel</button>
              <button disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">{saving ? "Processing..." : "Confirm return"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
