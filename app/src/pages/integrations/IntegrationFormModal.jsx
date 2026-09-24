/*
 * T9M - Add/Edit integration modal.
 *
 * Fields: name, provider name, integration type, base URL, auth type
 * (none/bearer/api_key/basic) with per-type credential inputs, store scope
 * (own store vs company-wide) and the enabled toggle. Credentials are only
 * sent when entered; on edit, empty fields keep the stored ciphertext.
 * Secrets are never displayed back (server exposes only hasCredentials).
 */
import { useState } from "react";
import { apiRequest } from "../../services/api.js";
import { Toggle } from "../../components/ui.jsx";
import { AUTH_TYPES } from "./shared.jsx";

export default function IntegrationFormModal({ integration, storeId, onClose, onSaved }) {
  const isEdit = Boolean(integration);
  const [name, setName] = useState(integration?.name || "");
  const [providerName, setProviderName] = useState(integration?.providerName || "");
  const [integrationType, setIntegrationType] = useState(integration?.integrationType || "generic");
  const [baseUrl, setBaseUrl] = useState(integration?.baseUrl || "");
  const [authType, setAuthType] = useState(integration?.authType || "none");
  const [credentials, setCredentials] = useState({ token: "", apiKey: "", headerName: "", username: "", password: "" });
  const [storeScope, setStoreScope] = useState(isEdit ? (integration?.storeId ? "store" : "company") : "company");
  const [enabled, setEnabled] = useState(integration?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const payload = { name, providerName, integrationType, enabled };

    if (baseUrl.trim()) payload.baseUrl = baseUrl.trim();
    payload.authType = authType;

    // Store scope: company-wide (storeId omitted/null) or this till's store.
    // The backend only accepts the caller's own store id (403 otherwise).
    payload.storeId = storeScope === "store" && storeId ? storeId : null;

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
                <span className="block text-xs font-medium text-slate-600 mb-1">Provider name</span>
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
            {storeId ? (
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Store scope</span>
                <select value={storeScope} onChange={(e) => setStoreScope(e.target.value)} className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="company">Company-wide (all stores)</option>
                  <option value="store">This store only</option>
                </select>
              </label>
            ) : (
              <p className="text-xs text-slate-400">Store scope: company-wide (no store selected in this session).</p>
            )}
            <p className="text-xs text-slate-400">
              {isEdit ? "Leave credential fields empty to keep the stored values. " : ""}Credentials are AES-256-GCM encrypted and never shown again after saving.
            </p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <Toggle checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
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
