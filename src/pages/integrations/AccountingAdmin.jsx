/*
 * T9O - Accounting Integration admin page.
 *
 * A thin, accounting-flavored skin over the generic Integration system:
 * setup (connections), endpoints per event, field mapping (catalogue
 * dropdown), test panel, dispatch status and logs. No second framework, no
 * provider hard-coding - every capability is the existing generic backend
 * (T9A routes, T9G dispatch status, T9M components).
 */
import { useCallback, useEffect, useState } from "react";
import { Calculator, Pencil, PlugZap, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { fmtDateTime, Flash, StatusPill } from "./shared.jsx";
import IntegrationFormModal from "./IntegrationFormModal.jsx";
import IntegrationDetail from "./IntegrationDetail.jsx";

/* Generic endpoint entity -> onePOS business event (dispatcher semantics). */
const EVENT_FOR_ENTITY = {
  sale: "SALE_CREATED",
  purchase: "PURCHASE_CREATED / PURCHASE_RECEIVED",
  custom: "SALES_RETURN_CREATED",
};

export default function AccountingAdmin({ storeId }) {
  const [integrations, setIntegrations] = useState([]);
  const [dispatchRows, setDispatchRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [managing, setManaging] = useState(null);
  const [testingId, setTestingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [integ, status] = await Promise.all([
        apiRequest("/api/integrations"),
        apiRequest("/api/integrations/dispatch-status").catch(() => ({ data: [] })),
      ]);
      setIntegrations(Array.isArray(integ?.data) ? integ.data : []);
      setDispatchRows(Array.isArray(status?.data) ? status.data : []);
    } catch (err) {
      setError(err.message || "Unable to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEnabled = async (integration) => {
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/integrations/${integration.id}/enabled`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !integration.enabled }),
      });
      setMessage(`Accounting integration "${integration.name}" ${integration.enabled ? "disabled" : "enabled"}.`);
      load();
    } catch (err) {
      setError(err.message || "Unable to update integration");
    }
  };

  const deleteIntegration = async (integration) => {
    if (!window.confirm(`Delete accounting integration "${integration.name}"? Endpoints, mappings and logs will also be removed.`)) return;
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/integrations/${integration.id}`, { method: "DELETE" });
      setMessage(`Accounting integration "${integration.name}" deleted.`);
      if (managing?.id === integration.id) setManaging(null);
      load();
    } catch (err) {
      setError(err.message || "Unable to delete integration");
    }
  };

  const testConnection = async (integration) => {
    setTestingId(integration.id);
    setError("");
    setMessage("");
    try {
      const data = await apiRequest(`/api/integrations/${integration.id}/test-connection`, { method: "POST" });
      const r = data?.data || {};
      if (r.ok) {
        setMessage(`Connection OK — HTTP ${r.status} in ${r.durationMs}ms.`);
      } else {
        setError(`Connection test failed — ${r.error || `HTTP ${r.status ?? "no response"}`}.`);
      }
      load();
    } catch (err) {
      setError(err.message || "Unable to run connection test");
    } finally {
      setTestingId(null);
    }
  };

  /* Per-integration dispatch summary for the accounting columns. */
  const statusFor = (id) => dispatchRows.filter((row) => row.integrationId === id);
  const totalsFor = (rows) =>
    rows.reduce(
      (acc, r) => ({ success: acc.success + (r.successCount || 0), failure: acc.failure + (r.failureCount || 0) }),
      { success: 0, failure: 0 }
    );
  const lastActivityFor = (rows) => {
    const withAttempt = rows.filter((r) => r.lastAttemptAt);
    if (!withAttempt.length) return null;
    return withAttempt.reduce((a, b) => (a.lastAttemptAt > b.lastAttemptAt ? a : b));
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Calculator size={20} className="text-blue-600" /> Accounting Integration
          </h1>
          <p className="text-sm text-slate-500">
            Push sales, purchases and returns to your accounting system — built on the generic onePOS
            integration engine. Credentials stay encrypted and are never displayed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50" title="Reload">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700">
            <Plus size={15} /> Add Accounting Integration
          </button>
        </div>
      </div>

      <Flash message={message} error={error} />

      {managing ? (
        <IntegrationDetail integration={managing} onBack={() => setManaging(null)} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-2.5 font-medium">Accounting integration</th>
                  <th className="px-4 py-2.5 font-medium">Provider / auth</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Events</th>
                  <th className="px-4 py-2.5 font-medium">Last success</th>
                  <th className="px-4 py-2.5 font-medium">Last failure</th>
                  <th className="px-4 py-2.5 font-medium">Requests</th>
                  <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
                ) : integrations.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No accounting integrations yet — click "Add Accounting Integration" to connect one.</td></tr>
                ) : (
                  integrations.map((integration) => {
                    const rows = statusFor(integration.id);
                    const totals = totalsFor(rows);
                    const events = [...new Set(rows.map((r) => r.event || r.entityType))];
                    const lastSuccess = rows.filter((r) => r.lastSuccessAt).reduce((a, b) => (!a || a < b.lastSuccessAt ? b.lastSuccessAt : a), null);
                    const lastFailure = rows.filter((r) => r.lastFailureAt).reduce((a, b) => (!a || a < b.lastFailureAt ? b.lastFailureAt : a), null);
                    const last = lastActivityFor(rows);
                    return (
                      <tr key={integration.id} className="border-b border-slate-100 hover:bg-slate-50/60 align-top">
                        <td className="px-4 py-2.5">
                          <button onClick={() => setManaging(integration)} className="font-medium text-blue-700 hover:underline text-left">
                            {integration.name}
                          </button>
                          <div className="text-xs text-slate-400 max-w-[13rem] truncate" title={integration.baseUrl || ""}>{integration.baseUrl || "No base URL"}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div>{integration.providerName || "—"}</div>
                          <div className="text-xs text-slate-400">{integration.authType}{integration.storeId ? " · store" : " · company"}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusPill enabled={integration.enabled} extra={integration.hasCredentials ? null : "no credentials"} />
                          {last?.lastHttpStatus ? (
                            <div className="text-xs text-slate-400 mt-0.5">last HTTP {last.lastHttpStatus}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1 max-w-[10rem]">
                            {events.length === 0 && <span className="text-xs text-slate-300">—</span>}
                            {events.map((ev) => (
                              <span key={ev} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[11px]" title={EVENT_FOR_ENTITY[ev] || ev}>{ev}</span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {lastSuccess ? fmtDateTime(lastSuccess) : <span className="text-slate-300">never</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {lastFailure ? <span className="text-red-600">{fmtDateTime(lastFailure)}</span> : <span className="text-slate-300">never</span>}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className="text-emerald-600">{totals.success} ok</span>
                          {" · "}
                          <span className={totals.failure ? "text-red-600" : "text-slate-400"}>{totals.failure} failed</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => testConnection(integration)} disabled={testingId === integration.id} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50" title="Test connection">
                              <PlugZap size={14} className="inline" />
                            </button>
                            <button onClick={() => setManaging(integration)} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50" title="Endpoints, mappings, tests & logs">Manage</button>
                            <button onClick={() => { setEditing(integration); setShowForm(true); }} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50" title="Edit"><Pencil size={14} className="inline" /></button>
                            <button onClick={() => toggleEnabled(integration)} className={`px-2.5 py-1.5 text-xs rounded-lg border ${integration.enabled ? "border-amber-200 text-amber-700 hover:bg-amber-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>
                              {integration.enabled ? "Disable" : "Enable"}
                            </button>
                            <button onClick={() => deleteIntegration(integration)} className="px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50" title="Delete"><Trash2 size={14} className="inline" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <IntegrationFormModal
          integration={editing}
          storeId={storeId}
          onClose={() => setShowForm(false)}
          onSaved={(saved, created) => {
            setShowForm(false);
            setMessage(`Accounting integration "${saved?.name || "integration"}" ${created ? "created" : "updated"}.`);
            load();
          }}
        />
      )}
    </div>
  );
}
