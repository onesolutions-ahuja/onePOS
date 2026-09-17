/*
 * T9F - Integration management page (functional UI over the T9A backend).
 *
 * Compact onePOS admin style: header + banners + rounded-xl container +
 * table + inline modals, matching PurchasesAdmin/SuppliersAdmin. All data
 * comes from the existing /api/integrations* endpoints; credentials are
 * only ever sent to the API, never displayed back (hasCredentials flag).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plug, Plus, Pencil, Trash2, RefreshCw, Activity, PlugZap, FlaskConical,
} from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { getIntegrationFieldCatalogue } from "../../services/integrationFieldCatalogue.js";

const AUTH_TYPES = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer token" },
  { value: "api_key", label: "API key" },
  { value: "basic", label: "Basic auth" },
];

const ENTITY_TYPES = ["sale", "purchase", "product", "customer", "custom"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return text; }
}

export default function IntegrationsAdmin() {
  const [integrations, setIntegrations] = useState([]);
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
      const data = await apiRequest("/api/integrations");
      setIntegrations(Array.isArray(data?.data) ? data.data : []);
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
      setMessage(`Integration "${integration.name}" ${integration.enabled ? "disabled" : "enabled"}.`);
      load();
    } catch (err) {
      setError(err.message || "Unable to update integration");
    }
  };

  const deleteIntegration = async (integration) => {
    if (!window.confirm(`Delete integration "${integration.name}"? Endpoints, mappings and logs will also be removed.`)) return;
    setError("");
    setMessage("");
    try {
      await apiRequest(`/api/integrations/${integration.id}`, { method: "DELETE" });
      setMessage(`Integration "${integration.name}" deleted.`);
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
    } catch (err) {
      setError(err.message || "Unable to run connection test");
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Plug size={20} className="text-blue-600" /> Integrations
          </h1>
          <p className="text-sm text-slate-500">
            Connect onePOS to external systems — credentials are stored encrypted and never displayed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50" title="Reload">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700">
            <Plus size={15} /> Add Integration
          </button>
        </div>
      </div>

      {message && <div className="mb-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{message}</div>}
      {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      {managing ? (
        <IntegrationDetail integration={managing} onBack={() => setManaging(null)} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Integration</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : integrations.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No integrations yet — click "Add Integration" to create one.</td></tr>
              ) : (
                integrations.map((integration) => (
                  <tr key={integration.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <button onClick={() => setManaging(integration)} className="font-medium text-blue-700 hover:underline text-left">
                        {integration.name}
                      </button>
                      <div className="text-xs text-slate-400">{integration.baseUrl || "No base URL"}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div>{integration.providerName || "—"}</div>
                      <div className="text-xs text-slate-400">{integration.integrationType}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${integration.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${integration.enabled ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {integration.enabled ? "Enabled" : "Disabled"}
                        {integration.hasCredentials ? "" : " · no credentials"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => testConnection(integration)} disabled={testingId === integration.id} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50" title="Test connection">
                          <PlugZap size={14} className="inline" />
                        </button>
                        <button onClick={() => setManaging(integration)} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50" title="Endpoints, mappings & logs">Manage</button>
                        <button onClick={() => { setEditing(integration); setShowForm(true); }} className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 hover:bg-slate-50" title="Edit"><Pencil size={14} className="inline" /></button>
                        <button onClick={() => toggleEnabled(integration)} className={`px-2.5 py-1.5 text-xs rounded-lg border ${integration.enabled ? "border-amber-200 text-amber-700 hover:bg-amber-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>
                          {integration.enabled ? "Disable" : "Enable"}
                        </button>
                        <button onClick={() => deleteIntegration(integration)} className="px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50" title="Delete"><Trash2 size={14} className="inline" /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <IntegrationFormModal
          integration={editing}
          onClose={() => setShowForm(false)}
          onSaved={(saved, created) => {
            setShowForm(false);
            setMessage(`Integration "${saved?.name || "integration"}" ${created ? "created" : "updated"}.`);
            load();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add / edit integration modal                                        */
/* ------------------------------------------------------------------ */

function IntegrationFormModal({ integration, onClose, onSaved }) {
  const isEdit = Boolean(integration);
  const [name, setName] = useState(integration?.name || "");
  const [providerName, setProviderName] = useState(integration?.providerName || "");
  const [integrationType, setIntegrationType] = useState(integration?.integrationType || "generic");
  const [baseUrl, setBaseUrl] = useState(integration?.baseUrl || "");
  const [authType, setAuthType] = useState(integration?.authType || "none");
  const [credentials, setCredentials] = useState({ token: "", apiKey: "", headerName: "", username: "", password: "" });
  const [enabled, setEnabled] = useState(integration?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const payload = { name, providerName, integrationType, enabled };
    if (baseUrl.trim()) payload.baseUrl = baseUrl.trim();
    payload.authType = authType;

    // Only send credential fields the user entered; an edit with empty
    // credential fields keeps the stored (encrypted) values untouched.
    const cred = {};
    if (authType === "bearer" && credentials.token.trim()) cred.token = credentials.token.trim();
    if (authType === "api_key") {
      if (credentials.apiKey.trim()) cred.apiKey = credentials.apiKey.trim();
      if (credentials.headerName.trim()) cred.headerName = credentials.headerName.trim();
    }
    if (authType === "basic") {
      if (credentials.username.trim()) cred.username = credentials.username.trim();
      if (credentials.password) cred.password = credentials.password;
    }
    if (Object.keys(cred).length > 0) payload.credentials = cred;

    if (!isEdit && authType !== "none" && Object.keys(cred).length === 0) {
      setError("Enter the credential values for the selected authentication type.");
      return;
    }

    setSaving(true);
    try {
      const data = await apiRequest(
        isEdit ? `/api/integrations/${integration.id}` : "/api/integrations",
        { method: isEdit ? "PUT" : "POST", body: JSON.stringify(payload) }
      );
      onSaved(data?.data || { name }, !isEdit);
    } catch (err) {
      setError(err.message || "Unable to save integration");
      setSaving(false);
    }
  };

  const credInput = (key, label, type = "text", placeholder = "") => (
    <label key={key} className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      <input
        type={type}
        value={credentials[key]}
        placeholder={placeholder}
        onChange={(event) => setCredentials((c) => ({ ...c, [key]: event.target.value }))}
        autoComplete="new-password"
        className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit}>
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">{isEdit ? "Edit Integration" : "Add Integration"}</h2>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
          </div>
          <div className="p-5 space-y-3.5">
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">Name *</span>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Provider label</span>
                <input value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="e.g. Xero, Shopify" className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Integration type</span>
                <input value={integrationType} onChange={(e) => setIntegrationType(e.target.value)} placeholder="generic" className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            </div>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">Base URL</span>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">Authentication</span>
              <select value={authType} onChange={(e) => setAuthType(e.target.value)} className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {AUTH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            {authType === "bearer" && credInput("token", "Token (stored encrypted)", "password")}
            {authType === "api_key" && (
              <div className="grid grid-cols-2 gap-3">
                {credInput("apiKey", "API key (stored encrypted)", "password")}
                {credInput("headerName", "Header name", "text", "X-API-Key")}
              </div>
            )}
            {authType === "basic" && (
              <div className="grid grid-cols-2 gap-3">
                {credInput("username", "Username")}
                {credInput("password", "Password", "password")}
              </div>
            )}
            <p className="text-xs text-slate-400">
              {isEdit ? "Leave credential fields empty to keep the stored values. " : ""}Credentials are AES-256-GCM encrypted and never shown again after saving.
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded" />
              Enabled
            </label>
            {error && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          </div>
          <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Integration"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Integration detail: endpoints, mappings, tests, logs                */
/* ------------------------------------------------------------------ */

function IntegrationDetail({ integration, onBack }) {
  const [endpoints, setEndpoints] = useState([]);
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

  useEffect(() => {
    loadEndpoints();
  }, [loadEndpoints]);

  const runConnectionTest = async () => {
    setTestingConn(true);
    setConnTest(null);
    try {
      const data = await apiRequest(`/api/integrations/${integration.id}/test-connection`, { method: "POST" });
      setConnTest(data?.data || null);
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
            {integration.providerName ? `${integration.providerName} · ` : ""}{integration.authType} · {integration.baseUrl || "no base URL"}
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
      {message && <div className="mb-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{message}</div>}
      {error && <div className="mb-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2"><Activity size={15} /> Endpoints</h3>
          <button onClick={() => { setEditingEndpoint(null); setShowEndpointForm(true); }} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-blue-700">
            <Plus size={13} /> Add Endpoint
          </button>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Method</th>
              <th className="px-4 py-2 font-medium">Path</th>
              <th className="px-4 py-2 font-medium">Entity</th>
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
                  <td className="px-4 py-2 font-mono text-xs">{endpoint.path}</td>
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

      <ApiLogsPanel integration={integration} endpoints={endpoints} />

      {showEndpointForm && (
        <EndpointFormModal
          integration={integration}
          endpoint={editingEndpoint}
          onClose={() => setShowEndpointForm(false)}
          onSaved={() => { setShowEndpointForm(false); loadEndpoints(); }}
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

/* ------------------------------------------------------------------ */
/* Endpoint add/edit modal                                             */
/* ------------------------------------------------------------------ */

function EndpointFormModal({ integration, endpoint, onClose, onSaved }) {
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
                <span className="block text-xs font-medium text-slate-600 mb-1">Method</span>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full h-9 px-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {HTTP_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Entity type</span>
                <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="w-full h-9 px-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {ENTITY_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">Path *</span>
              <input required value={path} onChange={(e) => setPath(e.target.value)} placeholder="/v3/sales" className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="rounded" />
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

/* ------------------------------------------------------------------ */
/* Mapping editor (partner field | onePOS field)                       */
/* ------------------------------------------------------------------ */

function MappingEditorModal({ integration, endpoint, onClose }) {
  const catalogue = useMemo(() => getIntegrationFieldCatalogue(), []);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  const loadMappings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest(`/api/integrations/${integration.id}/endpoints/${endpoint.id}/mappings`);
      setMappings(
        (data?.data || []).map((row) => ({
          partnerFieldPath: row.partner_field_path || "",
          oneposSourcePath: row.onepos_source_path || "",
          mappingType: row.mapping_type || "direct",
          staticValue: row.static_value || "",
        }))
      );
    } catch (err) {
      setError(err.message || "Unable to load mappings");
    } finally {
      setLoading(false);
    }
  }, [integration.id, endpoint.id]);

  useEffect(() => {
    loadMappings();
  }, [loadMappings]);

  const addRow = () => setMappings((rows) => [...rows, { partnerFieldPath: "", oneposSourcePath: "", mappingType: "direct", staticValue: "" }]);

  const removeRow = (index) => setMappings((rows) => rows.filter((_, i) => i !== index));

  const updateRow = (index, patch) => setMappings((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const cleaned = mappings
        .filter((row) => row.partnerFieldPath.trim())
        .map((row) => ({
          partnerFieldPath: row.partnerFieldPath.trim(),
          oneposSourcePath: row.mappingType === "direct" ? row.oneposSourcePath.trim() : null,
          mappingType: row.mappingType || "direct",
          staticValue: row.mappingType === "direct" ? null : row.staticValue || null,
        }));
      await apiRequest(`/api/integrations/${integration.id}/endpoints/${endpoint.id}/mappings`, {
        method: "PUT",
        body: JSON.stringify({ mappings: cleaned }),
      });
      setMessage("Mappings saved.");
      loadMappings();
    } catch (err) {
      setError(err.message || "Unable to save mappings");
    } finally {
      setSaving(false);
    }
  };

  const filteredCatalogue = search.trim()
    ? catalogue.filter((entry) => `${entry.path} ${entry.label}`.toLowerCase().includes(search.trim().toLowerCase()))
    : catalogue;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Field Mappings — {endpoint.name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="py-6 text-center text-slate-400 text-sm">Loading…</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2 px-1 pb-1 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <span>Partner field</span><span>onePOS field</span><span />
              </div>
              <div className="space-y-2">
                {mappings.length === 0 && <div className="text-sm text-slate-400 py-3">No mappings yet — add one below.</div>}
                {mappings.map((row, index) => (
                  <div key={index} className="grid grid-cols-[1fr_1.4fr_auto] gap-2 items-center">
                    <input
                      value={row.partnerFieldPath}
                      onChange={(e) => updateRow(index, { partnerFieldPath: e.target.value })}
                      placeholder="e.g. InvoiceNumber"
                      className="h-9 px-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex items-center gap-1.5 min-w-0">
                      <select
                        value={row.oneposSourcePath || ""}
                        onChange={(e) => updateRow(index, { oneposSourcePath: e.target.value })}
                        className="h-9 px-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[10rem] shrink-0"
                        aria-label="onePOS source field"
                      >
                        <option value="">Custom / none…</option>
                        {catalogue.some((entry) => entry.path === row.oneposSourcePath) || !row.oneposSourcePath
                          ? null
                          : <option value={row.oneposSourcePath}>{row.oneposSourcePath}</option>}
                        {filteredCatalogue.map((entry) => (
                          <option key={entry.path} value={entry.path}>{entry.label} ({entry.path})</option>
                        ))}
                      </select>
                      <input
                        value={row.oneposSourcePath}
                        onChange={(e) => updateRow(index, { oneposSourcePath: e.target.value })}
                        placeholder="sales.customer.name"
                        className="h-9 px-2.5 border border-slate-200 rounded-lg text-sm font-mono flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        aria-label="onePOS source path (custom)"
                      />
                    </div>
                    <button onClick={() => removeRow(index)} className="h-9 w-9 flex items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50" title="Remove mapping"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={addRow} className="h-8 px-3 border border-slate-200 rounded-lg text-xs flex items-center gap-1.5 hover:bg-slate-50"><Plus size={13} /> Add mapping</button>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search onePOS fields…"
                  className="h-8 px-3 border border-slate-200 rounded-lg text-xs flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Source paths support relationship traversal (<code>sales.customer.address.postcode</code>) and collections (<code>purchase.items[].product.ean</code>).
              </p>
              {message && <div className="mt-3 px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{message}</div>}
              {error && <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">Close</button>
          <button type="button" onClick={save} disabled={saving || loading} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save Mappings"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Endpoint test panel                                                 */
/* ------------------------------------------------------------------ */

const SAMPLE_JSON = `{
  "sales": {
    "sale_id": "S-1001",
    "receipt_number": "T01-20260916-0001",
    "total": 42.5,
    "customer": { "name": "Acme Ltd", "address": { "postcode": "SW1A 1AA" } },
    "items": [ { "quantity": 2, "product": { "ean": "5000111000011" } } ]
  }
}`;

function EndpointTestModal({ integration, endpoint, onClose }) {
  const [sampleJson, setSampleJson] = useState(SAMPLE_JSON);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true);
    setError("");
    setResult(null);
    let sampleData;
    try {
      sampleData = JSON.parse(sampleJson);
    } catch {
      setError("Sample JSON is not valid — fix it and try again. The test was not run.");
      setRunning(false);
      return;
    }
    try {
      const data = await apiRequest(`/api/integrations/${integration.id}/endpoints/${endpoint.id}/test`, {
        method: "POST",
        body: JSON.stringify({ sampleData }),
      });
      const testResult = data?.data || null;
      if (testResult?.logId) {
        try {
          const logs = await apiRequest(`/api/integrations/${integration.id}/logs?limit=50`);
          const row = (logs?.data || []).find((r) => r.id === testResult.logId);
          if (row) testResult.log = row;
        } catch { /* log preview is best-effort */ }
      }
      setResult(testResult);
    } catch (err) {
      setError(err.message || "Unable to run endpoint test");
    } finally {
      setRunning(false);
    }
  };

  const generatedPayload = result?.log?.request_body ? safeParse(result.log.request_body) : null;
  const responseBody = result?.log?.response_body ? safeParse(result.log.response_body) : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Test Endpoint — {endpoint.name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">Sample onePOS data (JSON)</span>
            <textarea
              value={sampleJson}
              onChange={(e) => setSampleJson(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <button onClick={run} disabled={running} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            <FlaskConical size={14} /> {running ? "Running…" : "Test Endpoint"}
          </button>
          {error && <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          {result && (
            <div className="space-y-2.5">
              <div className={`px-3 py-2 rounded-lg border text-sm ${result.ok ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>
                <span className="font-medium">{result.ok ? "Success" : "Failed"}</span>
                {result.status ? ` — HTTP ${result.status}` : ""}
                {result.durationMs != null ? ` · ${result.durationMs}ms` : ""}
                {result.error ? ` · ${result.error}` : ""}
              </div>
              {generatedPayload != null && (
                <div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Generated payload (from mappings)</div>
                  <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs overflow-x-auto">{typeof generatedPayload === "string" ? generatedPayload : JSON.stringify(generatedPayload, null, 2)}</pre>
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Response body (secrets redacted by the backend)</div>
                <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs overflow-x-auto max-h-48 overflow-y-auto">{responseBody == null ? "(none)" : typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">Close</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* API logs panel                                                      */
/* ------------------------------------------------------------------ */

const LOG_PAGE_SIZE = 25;

function ApiLogsPanel({ integration, endpoints }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ endpointId: "", success: "", entityType: "", since: "", until: "" });
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(0);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filters.endpointId) params.set("endpointId", filters.endpointId);
      if (filters.success) params.set("success", filters.success);
      if (filters.entityType) params.set("entityType", filters.entityType);
      if (filters.since) params.set("since", filters.since);
      if (filters.until) params.set("until", filters.until);
      params.set("limit", String(LOG_PAGE_SIZE));
      params.set("offset", String(page * LOG_PAGE_SIZE));
      const data = await apiRequest(`/api/integrations/${integration.id}/logs?${params.toString()}`);
      setLogs(Array.isArray(data?.data) ? data.data : []);
    } catch (err) {
      setError(err.message || "Unable to load logs");
    } finally {
      setLoading(false);
    }
  }, [integration.id, filters, page]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const setFilter = (patch) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-slate-800">API Logs</h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          <select value={filters.endpointId} onChange={(e) => setFilter({ endpointId: e.target.value })} className="h-8 px-2 border border-slate-200 rounded-lg text-xs" aria-label="Filter by endpoint">
            <option value="">All endpoints</option>
            {endpoints.map((endpoint) => <option key={endpoint.id} value={endpoint.id}>{endpoint.name}</option>)}
          </select>
          <select value={filters.success} onChange={(e) => setFilter({ success: e.target.value })} className="h-8 px-2 border border-slate-200 rounded-lg text-xs" aria-label="Filter by result">
            <option value="">All results</option>
            <option value="true">Success</option>
            <option value="false">Failed</option>
          </select>
          <select value={filters.entityType} onChange={(e) => setFilter({ entityType: e.target.value })} className="h-8 px-2 border border-slate-200 rounded-lg text-xs" aria-label="Filter by entity type">
            <option value="">All entities</option>
            {ENTITY_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input type="date" value={filters.since} onChange={(e) => setFilter({ since: e.target.value })} className="h-8 px-2 border border-slate-200 rounded-lg text-xs" aria-label="From date" />
          <input type="date" value={filters.until} onChange={(e) => setFilter({ until: e.target.value })} className="h-8 px-2 border border-slate-200 rounded-lg text-xs" aria-label="To date" />
          <button onClick={loadLogs} className="h-8 px-2.5 border border-slate-200 rounded-lg text-xs hover:bg-slate-50" title="Reload"><RefreshCw size={13} /></button>
        </div>
      </div>
      {error && <div className="px-4 py-2.5 bg-red-50 border-b border-red-200 text-red-700 text-sm">{error}</div>}
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
            <th className="px-4 py-2 font-medium">Time</th>
            <th className="px-4 py-2 font-medium">Endpoint</th>
            <th className="px-4 py-2 font-medium">Entity</th>
            <th className="px-4 py-2 font-medium">Result</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
          ) : logs.length === 0 ? (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No API activity logged yet.</td></tr>
          ) : (
            logs.map((row) => (
              <LogRow
                key={row.id}
                row={row}
                endpoints={endpoints}
                expanded={expanded === row.id}
                onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
              />
            ))
          )}
        </tbody>
      </table>
      <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
        <span>{logs.length} shown</span>
        <span className="flex items-center gap-2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40">Prev</button>
          <span>page {page + 1}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={logs.length < LOG_PAGE_SIZE} className="px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40">Next</button>
        </span>
      </div>
    </div>
  );
}

function LogRow({ row, endpoints, expanded, onToggle }) {
  const endpointName = endpoints.find((e) => e.id === row.endpoint_id)?.name || row.entity_type || "—";
  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={onToggle} title="Click for request/response preview">
        <td className="px-4 py-2 text-xs text-slate-500">{fmtDateTime(row.created_at)}</td>
        <td className="px-4 py-2 text-xs">{endpointName}</td>
        <td className="px-4 py-2 text-xs">{row.entity_type || "—"}</td>
        <td className="px-4 py-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {row.success ? "Success" : "Failed"}
          </span>
        </td>
        <td className="px-4 py-2 text-xs font-mono">{row.response_status ?? "—"}</td>
        <td className="px-4 py-2 text-xs text-slate-500">{row.duration_ms != null ? `${row.duration_ms}ms` : "—"}</td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/50">
          <td colSpan={6} className="px-4 py-3">
            <div className="grid md:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="font-medium text-slate-600 mb-1">Request · {row.method} {row.url}</div>
                <pre className="bg-white border border-slate-200 rounded p-2 overflow-x-auto max-h-40">{row.request_headers || ""}{row.request_body ? `\n\n${row.request_body}` : ""}</pre>
              </div>
              <div>
                <div className="font-medium text-slate-600 mb-1">Response</div>
                <pre className="bg-white border border-slate-200 rounded p-2 overflow-x-auto max-h-40">{row.response_headers || ""}{row.response_body ? `\n\n${row.response_body}` : ""}</pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
