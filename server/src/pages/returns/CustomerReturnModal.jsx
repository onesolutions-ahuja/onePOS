import { X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

export default function CustomerReturnModal({ sale, onClose, onSaved }) {
  const [quantities, setQuantities] = useState({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const returned = sale.returns || [];
  const already = (item) => returned.filter((row) => row.product_id === item.product_id).reduce((sum, row) => sum + Number(row.quantity), 0);
  const submit = async (event) => {
    event.preventDefault();
    const items = sale.items.map((item) => ({ item, quantity: Number(quantities[item.id] || 0) })).filter((entry) => entry.quantity > 0).map(({ item, quantity }) => ({ saleItemId: item.id, productId: item.product_id, quantity }));
    if (!items.length) { setError("Enter a return quantity"); return; }
    try { setSaving(true); const data = await apiRequest("/api/returns/customer", { method: "POST", body: JSON.stringify({ saleId: sale.id, items, reason, requestKey: `return-${sale.id}-${Date.now()}` }) }); if (!data.success) throw new Error(data.message); onSaved(); } catch (err) { setError(err.message || "Unable to process return"); } finally { setSaving(false); }
  };
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[680px] max-w-full shadow-2xl"><div className="p-4 border-b flex justify-between"><h2 className="font-bold text-lg">Return Sale {sale.receipt_number || sale.id.slice(0, 8)}</h2><button onClick={onClose} title="Close"><X size={18} /></button></div><form onSubmit={submit} className="p-4">{error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}<table className="w-full"><thead><tr className="bg-slate-50">{["Product", "Original", "Returned", "Remaining", "Return qty"].map((heading) => <th key={heading} className="text-left px-2 py-2 text-xs uppercase text-slate-500">{heading}</th>)}</tr></thead><tbody>{sale.items.map((item) => { const used = already(item); const remaining = Math.max(0, Number(item.quantity) - used); return <tr key={item.id} className="border-t"><td className="px-2 py-2 text-sm">{item.product_name}</td><td className="px-2 py-2 text-sm">{item.quantity}</td><td className="px-2 py-2 text-sm">{used}</td><td className="px-2 py-2 text-sm">{remaining}</td><td className="px-2 py-2"><input type="number" min="0" max={remaining} step="0.001" disabled={!remaining} value={quantities[item.id] || ""} onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))} className="w-24 h-8 border rounded px-2 text-sm" /></td></tr>; })}</tbody></table><label className="block text-sm text-slate-600 mt-4">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows="2" className="w-full mt-1 border rounded p-2" /></label><div className="flex justify-end gap-2 mt-5"><button type="button" onClick={onClose} className="h-9 px-3 border rounded text-sm">Cancel</button><button disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded text-sm">{saving ? "Processing..." : "Confirm return"}</button></div></form></div></div>;
}
