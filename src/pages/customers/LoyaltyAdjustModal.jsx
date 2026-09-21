import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

/*
 * Manual loyalty-points adjustment with a mandatory reason. Every
 * adjustment is audited server-side (ledger ADJUST row + adjustments
 * table); requires the customer.loyalty.adjust permission.
 */
export default function LoyaltyAdjustModal({ customer, onClose, onAdjusted }) {
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!customer) return null;

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const value = Number(points);
    if (!Number.isFinite(value) || value === 0) {
      setError("Enter a non-zero number of points (use a minus sign to remove).");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    try {
      setSaving(true);
      const data = await apiRequest(`/api/customers/${customer.id}/loyalty/adjust`, {
        method: "POST",
        body: JSON.stringify({ points: value, reason: reason.trim() }),
      });
      if (!data.success) throw new Error(data.message || "Unable to adjust points");
      if (onAdjusted) onAdjusted(data.data);
      onClose();
    } catch (err) {
      setError(err.message || "Unable to adjust points");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl w-full max-w-md shadow-2xl">
        <div className="p-4 border-b flex justify-between items-center">
          <div>
            <h2 className="font-bold text-lg">Adjust points</h2>
            <p className="text-sm text-slate-500">{customer.name}</p>
          </div>
          <button type="button" onClick={onClose} title="Close" className="p-1 hover:bg-slate-100 rounded"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-3">
          {error && <div role="alert" className="p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Points (negative to remove)</span>
            <input
              autoFocus
              type="number"
              step="0.0001"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="e.g. 50 or -25"
              className="w-full h-10 px-3 border border-slate-200 rounded-lg"
            />
          </label>
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Reason (recorded on the ledger)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Goodwill / correction"
              className="w-full h-10 px-3 border border-slate-200 rounded-lg"
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-10 px-4 border border-slate-200 rounded-lg text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? "Saving…" : "Apply adjustment"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
