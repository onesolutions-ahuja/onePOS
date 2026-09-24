/*
 * T10Q - Supplier feed preview panel (read-only integration boundary).
 * Pastes a small JSON array of generic supplier rows, POSTs to
 * /api/integrations/supplier-feed/preview and renders validation plus
 * matches. Follow-through stays on EXISTING screens (Products, Purchases).
 */
import { useState } from "react";
import { apiRequest } from "../../services/api.js";
import { Flash, StatusPill } from "./shared.jsx";

export default function SupplierFeedPreview() {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setError("");
    setResult(null);
    let rows;
    try {
      const parsed = JSON.parse(text || "[]");
      rows = Array.isArray(parsed) ? parsed : parsed?.rows;
    } catch {
      setError("Feed must be a JSON array of supplier rows.");
      return;
    }
    if (!Array.isArray(rows)) {
      setError("Feed must be a JSON array of supplier rows.");
      return;
    }
    setRunning(true);
    try {
      const data = await apiRequest("/api/integrations/supplier-feed/preview", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
      setResult(data?.data || null);
    } catch (err) {
      setError(err.message || "Unable to preview supplier feed");
    } finally {
      setRunning(false);
    }
  };
  const summary = result?.summary || null;
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  return (
    <div className="mt-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-slate-800">Supplier feed preview</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Validate a generic supplier feed against this company&apos;s Product Master.
          Read-only: nothing is created here.
        </p>
      </div>
      <div className="p-4 space-y-3">
        <Flash message="" error={error} />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          spellCheck={false}
          className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={running}
            className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {running ? "Checking…" : "Preview feed"}
          </button>
          {summary && (
            <span className="text-xs text-slate-500">
              {summary.valid}/{summary.total} valid · {summary.matched} matched
            </span>
          )}
        </div>
        {errors.length > 0 && (
          <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
            {errors.map((e, i) => (
              <div key={i}>Row {e?.row ?? "?"}: {(e?.errors || []).join("; ")}</div>
            ))}
          </div>
        )}
        {matches.length > 0 && (
          <div className="overflow-x-auto border border-slate-100 rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] text-slate-500 uppercase">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Feed product</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Next step</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-400">{m.row ?? "—"}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{m.productName || "—"}</td>
                    <td className="px-3 py-2">
                      {m.status === "matched"
                        ? <StatusPill enabled extra={`via ${m.resolvedVia}`} />
                        : <span className="text-slate-500">{m.status === "ambiguous" ? "Needs review" : "New"}</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {m.status === "matched" ? "Add via Purchases" : "Create via Products"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
