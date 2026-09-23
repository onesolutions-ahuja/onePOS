import { useCallback, useEffect, useState } from "react";
import { Mail, MessageSquare, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { apiRequest } from "../../services/api.js";

/*
 * T9D-NEXT - SMS + Email invoice delivery settings (shared component).
 *
 * Same UX contract as the WhatsApp page (T9Q-SMALL):
 *  - credentials render masked only; leaving a secret field blank keeps the
 *    stored value; entering a new secret invalidates the previous test
 *  - Test Connection performs a REAL probe and issues the activation token;
 *    Save & Activate stays disabled until then
 *  - automatic sending defaults OFF and must be enabled explicitly
 *  - real test send goes to an admin-supplied demo recipient only
 */

const CHANNEL_CONFIG = {
  sms: {
    label: "SMS",
    icon: MessageSquare,
    accent: "text-blue-600",
    recipientLabel: "Demo phone number",
    recipientPlaceholder: "e.g. +447700900123",
    fields: [
      ["smsProvider", "sms_provider", "SMS provider (label)"],
      ["senderId", "sender_id", "Sender ID"],
      ["apiBaseUrl", "api_base_url", "API endpoint URL (HTTPS)", true],
      ["defaultCountryCode", "default_country_code", "Default country code"],
    ],
    secretFields: [["authToken", "auth_token", "Auth token / API key"]],
  },
  email: {
    label: "Email",
    icon: Mail,
    accent: "text-purple-600",
    recipientLabel: "Demo email address",
    recipientPlaceholder: "e.g. test@example.com",
    fields: [
      ["emailProvider", "email_provider", "Email provider (label)"],
      ["fromAddress", "from_address", "From address"],
      ["fromName", "from_name", "From name"],
      ["apiBaseUrl", "api_base_url", "API endpoint URL (HTTPS)", true],
    ],
    secretFields: [["authToken", "auth_token", "Auth token / API key"]],
  },
};

function InvoiceDeliverySettings({ channel, onMessage, onError }) {
  const config = CHANNEL_CONFIG[channel];
  const Icon = config.icon;
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testToken, setTestToken] = useState(null);
  const [credentialsChanged, setCredentialsChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [testSaleId, setTestSaleId] = useState("");
  const [testSendBusy, setTestSendBusy] = useState(false);
  const [testSendResult, setTestSendResult] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiRequest(`/api/invoice-delivery/${channel}/settings`);
      if (!response?.success) throw new Error(response?.message || `Unable to load ${config.label} settings`);
      const { enabled: enabledState, configuration } = response.data;
      const nextForm = {
        authToken: "",
        apiKey: "",
      };
      for (const [formKey, cfgKey] of config.fields) {
        nextForm[formKey] = configuration[cfgKey] || "";
      }
      setState(configuration);
      setForm(nextForm);
      setEnabled(Boolean(enabledState));
      setCredentialsChanged(false);
      setTestResult(null);
      setTestToken(null);
    } catch (err) {
      onError(err.message || `Unable to load ${config.label} settings`);
    } finally {
      setLoading(false);
    }
  }, [channel, config, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const onSecretChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (value) {
      setCredentialsChanged(true);
      setTestResult(null);
      setTestToken(null);
    }
  };

  const runTest = async () => {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    setTestToken(null);
    try {
      const body = {};
      for (const [formKey, cfgKey] of config.fields) {
        body[cfgKey.replace(/_([a-z])/g, (m, c) => c.toUpperCase())] = form[formKey] || undefined;
      }
      if (form.authToken) body.authToken = form.authToken;
      if (form.apiKey) body.apiKey = form.apiKey;
      const data = await apiRequest(`/api/invoice-delivery/${channel}/test-connection`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const result = data?.data || {};
      if (result.status === "connected" && result.testToken) {
        setTestResult({ success: true, message: data.message || "Connection successful." });
        setTestToken(result.testToken);
        setCredentialsChanged(false);
      } else {
        setTestResult({ success: false, message: result.error || data.message || "Connection test failed." });
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message || "Connection test failed." });
    } finally {
      setTesting(false);
    }
  };

  const camel = (cfgKey) => cfgKey.replace(/_([a-z])/g, (m, c) => c.toUpperCase());

  const save = async (activate) => {
    if (saving) return;
    if (activate && (!testResult?.success || credentialsChanged)) return;
    setSaving(true);
    try {
      const body = {
        enabled: enabled || activate ? true : false,
        autoSendEnabled: state?.auto_send_enabled === true,
      };
      for (const [formKey, cfgKey] of config.fields) {
        body[camel(cfgKey)] = form[formKey] || null;
      }
      if (form.authToken) body.authToken = form.authToken;
      if (form.apiKey) body.apiKey = form.apiKey;
      if (testToken) body.testToken = testToken;
      const data = await apiRequest(`/api/invoice-delivery/${channel}/settings`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!data?.success) throw new Error(data?.message || `Unable to save ${config.label} settings`);
      onMessage(data.message || `${config.label} settings saved.`);
      await load();
    } catch (err) {
      onError(err.message || `Unable to save ${config.label} settings`);
    } finally {
      setSaving(false);
    }
  };

  const toggleAutoSend = async (value) => {
    // Auto-send is saved immediately as its own explicit action.
    setSaving(true);
    try {
      const body = {
        enabled: enabled,
        autoSendEnabled: value,
      };
      for (const [formKey, cfgKey] of config.fields) {
        body[camel(cfgKey)] = form[formKey] || null;
      }
      const data = await apiRequest(`/api/invoice-delivery/${channel}/settings`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!data?.success) throw new Error(data?.message || "Unable to update automatic sending");
      onMessage(value ? `Automatic ${config.label} delivery ON — invoices will be sent after each sale.` : `Automatic ${config.label} delivery OFF.`);
      await load();
    } catch (err) {
      onError(err.message || "Unable to update automatic sending");
    } finally {
      setSaving(false);
    }
  };

  const sendTestReal = async () => {
    if (testSendBusy) return;
    setTestSendBusy(true);
    setTestSendResult(null);
    try {
      const data = await apiRequest(`/api/invoice-delivery/${channel}/test-send`, {
        method: "POST",
        body: JSON.stringify({ saleId: testSaleId || undefined, recipient: testRecipient || undefined }),
      });
      if (!data?.success) throw new Error(data?.message || "Test send failed");
      setTestSendResult({ success: true });
    } catch (err) {
      setTestSendResult({ success: false, message: err.message || "Test send failed" });
    } finally {
      setTestSendBusy(false);
    }
  };

  if (loading) return <div className="onepos-empty"><span className="onepos-empty-title">Loading {config.label} settings…</span></div>;
  if (!state || !form) return null;

  const activationReady = testResult?.success === true && !credentialsChanged;
  const tokenConfigured = Boolean(state.auth_token_configured || state.api_key_configured);

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="onepos-card onepos-card-body">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Icon size={18} className={config.accent} />
            <h2 className="onepos-card-title">{config.label} invoice delivery</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={`onepos-badge ${enabled ? "onepos-badge-success" : "onepos-badge-neutral"}`}>
              {enabled ? "ON" : "OFF"}
            </span>
            <span className={`onepos-badge ${state.configured ? "onepos-badge-info" : "onepos-badge-neutral"}`}>
              {state.configured ? "Configured" : "Not configured"}
            </span>
            <button type="button" onClick={load} className="onepos-btn onepos-btn-sm onepos-btn-secondary" title="Reload">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Sends customers their invoice as a secure onePOS link ({<code className="text-[11px]">/i/…</code>}). Credentials are
          stored encrypted and never returned by the API. Connection must be tested before activation. Automatic
          sending is OFF unless enabled below.
        </p>
      </div>

      <div className="onepos-card onepos-card-body">
        <h3 className="onepos-section-title">Provider configuration</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {config.fields.map(([formKey, cfgKey, label, required]) => (
            <label key={formKey} className="onepos-label">
              <span className="block mb-1">
                {label}
                {required ? <span className="text-red-400"> *</span> : null}
              </span>
              <input
                type="text"
                required={required}
                disabled={testing}
                value={form[formKey] || ""}
                placeholder={state[cfgKey] || ""}
                onChange={(event) => update(formKey, event.target.value)}
                className="onepos-input disabled:opacity-60"
              />
            </label>
          ))}
          {config.secretFields.map(([formKey, cfgKey, label]) => (
            <label key={formKey} className="onepos-label">
              <span className="block mb-1">
                {label}
                {tokenConfigured && state[`${cfgKey}_masked`] ? (
                  <span className="ml-2 text-xs text-emerald-600 font-normal">{state[`${cfgKey}_masked`]}</span>
                ) : null}
              </span>
              <input
                type="password"
                disabled={testing}
                autoComplete="new-password"
                value={form[formKey] || ""}
                placeholder={tokenConfigured ? "Leave blank to keep the stored value" : "Not set"}
                onChange={(event) => onSecretChange(formKey, event.target.value)}
                className="onepos-input disabled:opacity-60"
              />
            </label>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-slate-200 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="onepos-btn onepos-btn-secondary"
          >
            <ShieldCheck size={15} />
            {testing ? "Testing connection… please wait" : "Test Connection"}
          </button>
          {enabled ? (
            <button
              type="button"
              onClick={() => save(false)}
              disabled={saving}
              className="onepos-btn onepos-btn-primary"
            >
              <Save size={15} /> {saving ? "Saving…" : "Save changes"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={!activationReady || saving}
              title={activationReady ? "Save and activate" : "Run a successful connection test first"}
              className="onepos-btn onepos-btn-primary"
            >
              {saving ? "Saving…" : "Save & Activate"}
            </button>
          )}
          {testResult && (
            <span className={`onepos-alert ${testResult.success ? "onepos-alert-success" : " onepos-alert-error"} inline-flex`} role="status">
              {testResult.success ? "✓ " : "✕ "}
              {testResult.message}
            </span>
          )}
        </div>
        {testing && <p className="text-xs text-slate-500 mt-2">Testing connection… please wait. Configuration is locked while testing.</p>}
      </div>

      <div className="onepos-card onepos-card-body">
        <h3 className="onepos-section-title">Automatic sending after sale</h3>
        <p className="text-xs text-slate-500 mb-3">
          When ON, every completed sale automatically sends the customer their invoice link (if the customer has a
          {channel === "sms" ? " phone number" : "n email address"}). When OFF, invoices are only sent manually from
          the sale view or via the test send below. Default is OFF.
        </p>
        <div className="flex items-center gap-3">
          <select
            value={state.auto_send_enabled ? "on" : "off"}
            disabled={saving || !enabled}
            onChange={(event) => toggleAutoSend(event.target.value === "on")}
            className="onepos-input w-auto disabled:opacity-50"
          >
            <option value="off">OFF — send nothing automatically</option>
            <option value="on">ON — send invoice to the customer after each sale</option>
          </select>
          {!enabled && <span className="text-xs text-slate-400">Activate {config.label} delivery first.</span>}
        </div>
      </div>

      <div className="onepos-card onepos-card-body">
        <h3 className="onepos-section-title">Send real test message</h3>
        <p className="text-xs text-slate-500 mb-4">
          Sends a real {config.label} message with a secure invoice link to the demo recipient you enter — never a
          stored customer. Requires {config.label} delivery to be ON and one of your own sale IDs.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type={channel === "sms" ? "tel" : "email"}
            value={testRecipient}
            onChange={(event) => setTestRecipient(event.target.value)}
            placeholder={config.recipientPlaceholder}
            disabled={!enabled || testSendBusy}
            className="onepos-input w-64 disabled:opacity-50"
          />
          <input
            type="text"
            value={testSaleId}
            onChange={(event) => setTestSaleId(event.target.value)}
            placeholder="Sale ID (required)"
            disabled={!enabled || testSendBusy}
            className="onepos-input w-64 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={sendTestReal}
            disabled={!enabled || testSendBusy || !testRecipient || !testSaleId}
            title={!enabled ? `Activate ${config.label} delivery first` : "Send a real test message"}
            className="onepos-btn onepos-btn-primary"
          >
            {testSendBusy ? "Sending…" : "Send real test message"}
          </button>
        </div>
        {testSendResult && (
          <p className={`onepos-alert ${testSendResult.success ? "onepos-alert-success" : "onepos-alert-error"}`} role="status">
            {testSendResult.success ? `✓ Test message sent via ${config.label}.` : `✕ ${testSendResult.message}`}
          </p>
        )}
        <p className="text-xs text-slate-500 mt-2">The message goes only to the recipient above.</p>
      </div>
    </div>
  );
}

export default InvoiceDeliverySettings;
