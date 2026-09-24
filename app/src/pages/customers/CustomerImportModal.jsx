import { useState } from "react";
import { Upload, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

/*
 * Bulk customer CSV import — two-stage flow:
 *   paste/upload CSV → POST /api/customers/import/preview (validate,
 *   report errors + create/update plan) → choose a mode →
 *   POST /api/customers/import executes exactly that plan.
 * Invalid rows can never be imported silently: the preview marks them and
 * the execute endpoint rejects any plan containing invalid rows.
 */
export default function CustomerImportModal({ onClose, onImported }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState("upsert");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const runPreview = async () => {
    setError("");
    setMessage("");
    setPreview(null);
    try {
      setLoading(true);
      const data = await apiRequest("/api/customers/import/preview", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      if (!data.success) throw new Error(data.message || "Unable to preview import");
      setPreview(data.data);
    } catch (err) {
      setError(err.message || "Unable to preview import");
    } finally {
      setLoading(false);
    }
  };

  const runImport = async () => {
    setError("");
    setMessage("");
    try {
      setLoading(true);
      const rows = preview.rows.filter((r) => {
        if (mode === "create") return r.valid && r.action === "create";
        if (mode === "update") return r.valid && r.action === "update";
        return r.valid; // upsert: both
      });
      if (!rows.length) {
        setError("Nothing to import for the selected mode.");
        return;
      }
      const data = await apiRequest("/api/customers/import", {
        method: "POST",
        body: JSON.stringify({ mode, rows }),
      });
      if (!data.success) throw new Error(data.message || "Import failed");
      setMessage(data.message || "Import complete.");
      setPreview(null);
      setCsv("");
      if (onImported) onImported();
    } catch (err) {
      setError(err.message || "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-3xl max-h-[85vh] shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center shrink-0">
          <div>
            <h2 className="font-bold text-lg">Import customers (CSV)</h2>
            <p className="text-sm text-slate-500">Columns: name (required), companyName, phone, email, address, postcode, notes, creditEnabled, creditLimit</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1 hover:bg-slate-100 rounded"><X size={20} /></button>
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {error && <div role="alert" className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          {message && <div className="mb-3 p-2 bg-emerald-50 text-emerald-700 rounded text-sm">{message}</div>}

          {!preview && (
            <div className="space-y-3">
              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                rows={10}
                placeholder={"name,phone,email,creditEnabled,creditLimit\nAmy Wong,07700900123,amy@example.com,false,\nJohn Smith,07700900456,john@example.com,true,250"}
                className="w-full border border-slate-200 rounded-lg p-3 text-sm font-mono"
              />
              <div className="flex items-center gap-3">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => setCsv(String(reader.result || ""));
                    reader.readAsText(file);
                  }}
                  className="text-sm"
                />
                <button onClick={runPreview} disabled={!csv.trim() || loading} className="ml-auto inline-flex items-center gap-1 h-9 px-4 bg-blue-600 text-white rounded text-sm font-medium disabled:opacity-50">
                  <Upload size={15} /> {loading ? "Validating…" : "Validate & preview"}
                </button>
              </div>
            </div>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>{preview.total} row(s)</span>
                <span className="text-emerald-700">{preview.creates} new</span>
                <span className="text-blue-700">{preview.updates} updates</span>
                {preview.invalid > 0 && <span className="text-red-700 font-medium">{preview.invalid} invalid</span>}
                {preview.unknownColumns?.length > 0 && <span className="text-amber-700">ignored columns: {preview.unknownColumns.join(", ")}</span>}
                <button onClick={() => { setPreview(null); setMessage(""); }} className="ml-auto text-sm text-blue-700 underline">Back</button>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-600">Mode</label>
                <select value={mode} onChange={(e) => setMode(e.target.value)} className="h-9 px-2 border border-slate-200 rounded text-sm">
                  <option value="upsert">Create new + update matched</option>
                  <option value="create">Create new only (skip matched)</option>
                  <option value="update">Update matched only (skip new)</option>
                </select>
                <button onClick={runImport} disabled={loading || preview.invalid > 0} className="ml-auto h-9 px-4 bg-emerald-600 text-white rounded text-sm font-medium disabled:opacity-50">
                  {loading ? "Importing…" : `Import ${preview.creates + preview.updates} row(s)`}
                </button>
              </div>
              {preview.invalid > 0 && (
                <div className="p-2 bg-amber-50 text-amber-800 rounded text-sm">Fix or remove the invalid rows in your CSV, then re-run the preview. Invalid rows are never imported.</div>
              )}

              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <th className="px-3 py-2">Row</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Match</th><th className="px-3 py-2">Problems</th>
                  </tr></thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.row} className={`border-t border-slate-100 ${r.valid ? "" : "bg-red-50"}`}>
                        <td className="px-3 py-1.5">{r.row}</td>
                        <td className="px-3 py-1.5">{r.name || <span className="text-red-600">missing</span>}</td>
                        <td className="px-3 py-1.5">{r.action}</td>
                        <td className="px-3 py-1.5 text-slate-500">{r.matchCustomer ? r.matchCustomer.name : "—"}</td>
                        <td className="px-3 py-1.5 text-red-700">{r.errors.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
