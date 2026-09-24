import { useState } from "react";
import { X } from "lucide-react";

export default function StockAdjustmentModal({ product, onClose, onSave }) {
  const [direction, setDirection] = useState("increase");
  const [quantity, setQuantity] = useState("");
  /* T10R: decreases require a canonical reason; increases stay optional. */
  const [reasonCategory, setReasonCategory] = useState("Wastage");
  const [reasonDetail, setReasonDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter an adjustment quantity greater than zero."); return; }
    if (direction === "decrease" && !reasonCategory) { setError("Select a reason: Wastage, Breakage or Other."); return; }
    try {
      setSaving(true); setError("");
      const detail = reasonDetail.trim();
      const reason =
        direction === "decrease"
          ? (detail ? `${reasonCategory} - ${detail}` : reasonCategory)
          : (reasonDetail.trim() || null);
      await onSave(product, direction === "increase" ? amount : -amount, reason);
    } catch (err) { setError(err.message || "Unable to adjust stock"); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[440px] max-w-full shadow-2xl">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div><h2 className="font-bold text-xl">Adjust Stock</h2><p className="text-sm text-slate-500 mt-1">{product.name} · Current stock: {product.stock}</p></div>
          <button onClick={onClose} disabled={saving} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5">
          {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {["increase", "decrease"].map((option) => (
              <button key={option} type="button" onClick={() => setDirection(option)} className={`h-10 rounded-lg border text-sm font-medium capitalize ${direction === option ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>{option} stock</button>
            ))}
          </div>
          <label className="block text-sm text-slate-600 mb-4"><span className="block mb-1 font-medium">Adjustment quantity</span><input autoFocus required type="number" min="0.01" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" /></label>
          {direction === "decrease" ? (
            <>
              <label className="block text-sm text-slate-600 mb-3"><span className="block mb-1 font-medium">Reason (required)</span><select required value={reasonCategory} onChange={(event) => setReasonCategory(event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg outline-none bg-white focus:ring-2 focus:ring-blue-500">{["Wastage", "Breakage", "Other"].map((option) => (<option key={option} value={option}>{option}</option>))}</select></label>
              <label className="block text-sm text-slate-600"><span className="block mb-1 font-medium">Detail (optional)</span><textarea rows="2" value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none resize-none focus:ring-2 focus:ring-blue-500" placeholder="For example: expired milk" /></label>
            </>
          ) : (
            <label className="block text-sm text-slate-600"><span className="block mb-1 font-medium">Reason (optional)</span><textarea rows="3" value={reasonDetail} onChange={(event) => setReasonDetail(event.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg outline-none resize-none focus:ring-2 focus:ring-blue-500" placeholder="For example: delivery received or stock count" /></label>
          )}
          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-200">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 px-4 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">{saving ? "Saving..." : "Save adjustment"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
