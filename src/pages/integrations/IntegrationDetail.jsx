/*
 * T9M - Integration detail view.
 *
 * Header (test connection + connection result), endpoints table with
 * per-endpoint actions, the dispatch-status strip for this integration's
 * event endpoints (T9G status contract) and the API logs section.
 */
import { useCallback, useEffect, useState } from "react";
import { Activity, FlaskConical, PlugZap, Plus, Pencil } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { fmtDateTime, Flash } from "./shared.jsx";
import EndpointFormModal from "./EndpointFormModal.jsx";
import MappingEditorModal from "./MappingEditorModal.jsx";
import EndpointTestModal from "./EndpointTestModal.jsx";
import ApiLogsPanel from "./ApiLogsPanel.jsx";

export default function IntegrationDetail({ integration, onBack }) {
  const [endpoints, setEndpoints] = useState([]);
  const [dispatchStatus, setDispatchStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showEndpointForm, setShowEndpointForm] = useState(false);
  const [editingEndpoint, setEditingEndpoint] = useState(null);
  const [mappingEndpoint, setMappingEndpoint] = useState(null);
  const [testEndpoint, setTestEndpoint] = useState(null);
  const [connTest, setConnTest] = useState(null);
  const [testingConn, setTestingConn] = useState(false);

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest(`/api/integrations/${integration.id}/endpoints`);
      setEndpoints(Array.isArray(data?.data) ? data.data : []);
    } catch (err) {
      setError(err.message || "Unable to load endpoints");
    } finally {
      setLoading(false);
    }
  }, [integration.id]);

  const loadDispatchStatus = useCallback(async () => {
    try {
      const data = await apiRequest("/api/integrations/dispatch-status");
      setDispatchStatus(
        (data?.data || []).filter((row) => row.integrationId === integration.id)
      );
    } catch {
      setDispatchStatus([]); // status strip is supplementary — never blocks the page
    }
  }, [integration.id]);

  useEffect(() => {
    loadEndpoints();
    loadDispatchStatus();
  }, [loadEndpoints, loadDispatchStatus]);

  const runConnectionTest = async () => {
    setTestingConn(true);
    setConnTest(null);
    try {
      const data = await apiRequest(`/api/integrations/${integration.id}/test-connection`, { method: "POST" });
      setConnTest(data?.data || null);
      loadDispatchStatus();
    } catch (err) {
      setConnTest({ ok: false, error: err.message });
    } finally {
      setTestingConn(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <button onClick={onBack} className="text-sm text-blue-700 hover:underline mb-1">← All integrations</button>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            {integration.name}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${integration.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {integration.enabled ? "Enabled" : "Disabled"}
            </span>
          </h2>
          <div className="text-xs text-slate-500">
            {integration.providerName ? `${integration.providerName} · ` : ""}{integration.authType} · {integration.baseUrl || "no base URL"} · {integration.storeId ? "store-scoped" : "company-wide"}
          </div>
        </div>
        <button onClick={runConnectionTest} disabled={testingConn} className="h-9 px-4 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50">
          <PlugZap size={15} /> {testingConn ? "Testing…" : "Test Connection"}
        </button>
      </div>

      {connTest && (
        <div className={`mb-3 px-4 py-2.5 rounded-lg border text-sm ${connTest.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>
          <span className="font-medium">{connTest.ok ? "Connection OK" : "Connection failed"}</span>
          {connTest.status ? ` — HTTP ${connTest.status}` : ""}
          {connTest.durationMs != null ? ` · ${connTest.durationMs}ms` : ""}
          {connTest.error ? ` · ${connTest.error}` : ""}
          <span className="block text-xs mt-0.5 opacity-80">Logged (correlation ID {connTest.correlationId}). Credentials are never displayed.</span>
        </div>
      )}
      <Flash message={message} error={error} />

      {/* Dispatch status for this integration's event endpoints. */}
      {dispatchStatus.length > 0 && (
        <div className="mb-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><PlugZap size={15} className="text-blue-600" /> Dispatch status</h3>
            <button onClick={loadDispatchStatus} className="text-xs text-blue-700 hover:underline">Refresh</button>
          </div>
          <div className="divide-y divide-slate-100">
            {dispatchStatus.map((row) => (
              <div key={row.endpointId} className="px-4 py-2 flex items-center justify-between gap-4 text-xs flex-wrap">
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
                  <span className="font-medium text-slate-800">{row.endpointName}</span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[11px]">{row.event || row.entityType}</span>
                </span>
                <span className="text-slate-500">
                  {row.lastAttemptAt
                    ? <>last attempt {fmtDateTime(row.lastAttemptAt)} · <span className={row.lastSuccessAt && (!row.lastFailureAt || row.lastSuccessAt >= row.lastFailureAt) ? "text-emerald-600" : "text-red-600"}>{row.lastSuccessAt && (!row.lastFailureAt || row.lastSuccessAt >= row.lastFailureAt) ? "success" : "failure"}</span>{row.lastHttpStatus ? ` · HTTP ${row.lastHttpStatus}` : ""}</>
                    : "never attempted"}
                  {" · "}{row.successCount}/{row.totalAttempts} ok
                </span>
                {row.lastErrorMessage && <span className="text-red-600 truncate max-w-[16rem]" title={row.lastErrorMessage}>{row.lastErrorMessage}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Activity size={15} /> Endpoints</h3>
          <button onClick={() => { setEditingEndpoint(null); setShowEndpointForm(true); }} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-blue-700">
            <Plus size={13} /> Add Endpoint
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Method</th>
                <th className="px-4 py-2 font-medium">URL</th>
                <th className="px-4 py-2 font-medium">Event / entity</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
              ) : endpoints.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No endpoints yet.</td></tr>
              ) : (
                endpoints.map((endpoint) => (
                  <tr key={endpoint.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-2 font-medium text-slate-800">{endpoint.name}</td>
                    <td className="px-4 py-2"><span className="px-1.5 py-0.5 rounded bg-slate-100 text-xs font-mono">{endpoint.method}</span></td>
                    <td className="px-4 py-2 font-mono text-xs max-w-[16rem] truncate" title={endpoint.path}>{endpoint.path}</td>
                    <td className="px-4 py-2 text-xs">{endpoint.entity_type}</td>
                    <td className="px-4 py-2 text-xs">{endpoint.enabled ? "Enabled" : "Disabled"}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setTestEndpoint(endpoint)} className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50" title="Test endpoint"><FlaskConical size={13} className="inline" /></button>
                        <button onClick={() => setMappingEndpoint(endpoint)} className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50">Mappings</button>
                        <button onClick={() => { setEditingEndpoint(endpoint); setShowEndpointForm(true); }} className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 hover:bg-slate-50" title="Edit"><Pencil size={13} className="inline" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ApiLogsPanel integration={integration} endpoints={endpoints} />

      {showEndpointForm && (
        <EndpointFormModal
          integration={integration}
          endpoint={editingEndpoint}
          onClose={() => setShowEndpointForm(false)}
          onSaved={() => { setShowEndpointForm(false); loadEndpoints(); loadDispatchStatus(); }}
        />
      )}
      {mappingEndpoint && (
        <MappingEditorModal
          integration={integration}
          endpoint={mappingEndpoint}
          onClose={() => setMappingEndpoint(null)}
        />
      )}
      {testEndpoint && (
        <EndpointTestModal
          integration={integration}
          endpoint={testEndpoint}
          onClose={() => setTestEndpoint(null)}
        />
      )}
    </div>
  );
}
