/*
 * T9M - Endpoint add/edit modal.
 *
 * Name, URL/path, HTTP method, entity/event type (the dispatcher consumes
 * entity_type to route SALE_CREATED / PURCHASE_CREATED / PURCHASE_RECEIVED /
 * SALES_RETURN_CREATED) and enabled. Authentication is always inherited from
 * the parent connection — deliberately not editable here.
 */
import { useState } from "react";
import { apiRequest } from "../../services/api.js";
import { Toggle } from "../../components/ui.jsx";
import { ENTITY_TYPES, ENTITY_EVENT_HINT } from "./shared.jsx";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export default function EndpointFormModal({ integration, endpoint, onClose, onSaved }) {
  const isEdit = Boolean(endpoint);
  const [name, setName] = useState(endpoint?.name || "");
  const [method, setMethod] = useState(endpoint?.method || "POST");
  const [path, setPath] = useState(endpoint?.path || "");
  const [entityType, setEntityType] = useState(endpoint?.entity_type || "sale");
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSaving(true);
    const payload = { name, method, path, entityType, enabled };
    try {
      if (isEdit) {
        await apiRequest(`/api/integrations/${integration.id}/endpoints/${endpoint.id}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiRequest(`/api/integrations/${integration.id}/endpoints`, { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Unable to save endpoint");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <form onSubmit={submit}>
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">{isEdit ? "Edit Endpoint" : "Add Endpoint"}</h2>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
          </div>
          <div className="p-5 space-y-3.5">
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">Name *</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">HTTP method</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full h-9 px-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {HTTP_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Entity / event type</span>
                <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="w-full h-9 px-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {ENTITY_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <p className="text-xs text-slate-400 -mt-1.5">{ENTITY_EVENT_HINT}</p>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">URL / path *</span>
              <input required value={path} onChange={(e) => setPath(e.target.value)} placeholder="/v3/sales" className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <p className="text-xs text-slate-400">Authentication is inherited from the connection.</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <Toggle checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled
            </label>
            {error && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          </div>
          <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Endpoint"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
