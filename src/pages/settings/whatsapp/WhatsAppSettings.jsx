/*
 * T9Q-SMALL / T9Q-NEXT - WhatsApp settings page.
 *
 * Test-before-activate UX backed by the server-side gate:
 *  - "Test Connection" performs a REAL credentials probe and returns a
 *    server-issued test token on success; "Save & Activate" stays disabled
 *    until then. Entering a new secret invalidates the previous test.
 *  - Delivery settings (T9Q-NEXT): delivery mode (secure link | PDF) and
 *    the automatic-send toggle. Automatic sending is OFF by default and
 *    must be enabled explicitly.
 *  - Test invoice: "Preview" builds the exact message via the T9P delivery
 *    contract and sends nothing; "Send real test invoice" sends a REAL
 *    WhatsApp message to an admin-supplied demo number (never a stored
 *    customer number) through the same pipeline as automatic delivery.
 *
 * Secrets are never returned by the API - stored ones render as masked
 * hints; leaving a secret field blank keeps the stored value.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { apiRequest } from "../../../services/api.js";

/*
 * Compact recent-delivery list for the settings page. The API already
 * returns only presentation-safe fields (masked recipient, shortened
 * provider id, receipt number) - this component renders exactly that.
 */
function DeliveryHistory() {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    try {
      setError("");
      const data = await apiRequest("/api/whatsapp/delivery-history?limit=20");
      if (!data?.success) throw new Error(data?.message || "Unable to load delivery history");
      setHistory(data.data?.history || []);
    } catch (err) {
      setError(err.message || "Unable to load delivery history");
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const outcomePill = (outcome) =>
    outcome === "sent"
      ? "bg-emerald-50 text-emerald-700"
      : outcome === "failed"
        ? "bg-red-50 text-red-700"
        : "bg-slate-100 text-slate-500";

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Recent invoice deliveries</h3>
        <button
          type="button"
          onClick={loadHistory}
          className="h-8 px-3 border border-slate-200 rounded-lg text-xs text-slate-500 hover:bg-slate-50 flex items-center gap-1"
          title="Refresh delivery history"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : history === null ? (
        <p className="text-sm text-slate-400">Loading delivery history...</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-slate-400">No WhatsApp invoice deliveries yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Invoice</th>
                <th className="py-2 pr-3 font-medium">Mode</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">Message ID</th>
                <th className="py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row, index) => (
                <tr key={index} className="border-b border-slate-50 align-top">
                  <td className="py-2 pr-3 text-xs text-slate-500 whitespace-nowrap">
                    {row.createdAt ? new Date(row.createdAt).toLocaleString() : "-"}
                  </td>
                  <td className="py-2 pr-3 text-slate-700">{row.receiptNumber || "-"}</td>
                  <td className="py-2 pr-3 text-slate-600">{row.modeLabel || "-"}</td>
                  <td className="py-2 pr-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${outcomePill(row.outcome)}`}>
                      {row.outcome === "sent" ? "Sent" : row.outcome === "failed" ? "Failed" : "Skipped"}
                    </span>
                    {row.trigger && row.trigger !== "auto" ? (
                      <span className="ml-1 text-[10px] uppercase text-slate-400">{row.trigger.replace("_", " ")}</span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-slate-600 font-mono text-xs">{row.recipientMasked || "-"}</td>
                  <td className="py-2 pr-3 text-slate-400 font-mono text-xs">{row.providerMessageId || "-"}</td>
                  <td className="py-2 text-xs text-slate-500 max-w-[220px]">
                    {row.error ? (
                      <span className="text-red-600">{String(row.error).slice(0, 120)}</span>
                    ) : row.httpStatus ? (
                      <span>HTTP {row.httpStatus}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-400 mt-3">
        Latest 20 attempts. Customer numbers are masked; full numbers, credentials and secure-link tokens are never shown.
      </p>
    </div>
  );
}

function WhatsAppSettings({ onMessage, onError }) {
  const [config, setConfig] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { success, message }
  const [testToken, setTestToken] = useState(null);
  const [credentialsChanged, setCredentialsChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testSaleId, setTestSaleId] = useState("");
  const [testInvoiceBusy, setTestInvoiceBusy] = useState(false);
  const [testInvoice, setTestInvoice] = useState(null);
  const [testPhone, setTestPhone] = useState("");
  const [testSendBusy, setTestSendBusy] = useState(false);
  const [testSendResult, setTestSendResult] = useState(null);
  const pristineRef = useRef("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiRequest("/api/whatsapp/settings");
      if (!response.success) throw new Error(response.message || "Unable to load WhatsApp settings");
      const { enabled: enabledState, configuration } = response.data;
      const nextForm = {
        phoneNumberId: configuration.phone_number_id || "",
        businessAccountId: configuration.business_account_id || "",
        displayName: configuration.display_name || "",
        defaultCountryCode: configuration.default_country_code || "",
        invoiceMessageTemplate: configuration.invoice_message_template || "",
        deliveryMode: configuration.delivery_mode === "pdf" ? "pdf" : "link",
        autoSendEnabled: configuration.auto_send_enabled === true,
        accessToken: "",
        webhookVerifyToken: "",
      };
      setConfig(configuration);
      setEnabled(Boolean(enabledState));
      setForm(nextForm);
      pristineRef.current = JSON.stringify(nextForm);
      setCredentialsChanged(false);
      setTestResult(null);
      setTestToken(null);
    } catch (err) {
      onError(err.message || "Unable to load WhatsApp settings");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (field, value) =>
    setForm((current) => {
      const next = { ...current, [field]: value };
      return next;
    });

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
      const body = { phoneNumberId: form.phoneNumberId || undefined };
      if (form.accessToken) body.accessToken = form.accessToken;
      if (form.webhookVerifyToken) body.webhookVerifyToken = form.webhookVerifyToken;
      const data = await apiRequest("/api/whatsapp/test-connection", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const result = data?.data || {};
      if (result.status === "connected" && result.testToken) {
        setTestResult({ success: true, message: data.message || "Connection successful." });
        setTestToken(result.testToken || null);
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

  const save = async (activate) => {
    if (saving) return;
    if (activate && (!testResult?.success || credentialsChanged)) return;
    setSaving(true);
    try {
      const body = {
        enabled: enabled || activate ? true : false,
        phoneNumberId: form.phoneNumberId || null,
        businessAccountId: form.businessAccountId || null,
        displayName: form.displayName || null,
        defaultCountryCode: form.defaultCountryCode || null,
        invoiceMessageTemplate: form.invoiceMessageTemplate || null,
        deliveryMode: form.deliveryMode === "pdf" ? "pdf" : "link",
        autoSendEnabled: form.autoSendEnabled === true,
      };
      if (form.accessToken) body.accessToken = form.accessToken;
      if (form.webhookVerifyToken) body.webhookVerifyToken = form.webhookVerifyToken;
      if (testToken) body.testToken = testToken;
      const data = await apiRequest("/api/whatsapp/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!data.success) throw new Error(data.message || "Unable to save WhatsApp settings");
      onMessage(data.message || "WhatsApp settings saved.");
      await load();
    } catch (err) {
      onError(err.message || "Unable to save WhatsApp settings");
    } finally {
      setSaving(false);
    }
  };

  const sendTestInvoice = async () => {
    if (testInvoiceBusy) return;
    setTestInvoiceBusy(true);
    setTestInvoice(null);
    try {
      const data = await apiRequest("/api/whatsapp/test-invoice", {
        method: "POST",
        body: JSON.stringify({ saleId: testSaleId || undefined }),
      });
      if (!data?.success) throw new Error(data?.message || "Test invoice failed");
      setTestInvoice(data.data || null);
    } catch (err) {
      onError(err.message || "Unable to build the test invoice");
    } finally {
      setTestInvoiceBusy(false);
    }
  };

  const sendTestReal = async () => {
    if (testSendBusy) return;
    setTestSendBusy(true);
    setTestSendResult(null);
    try {
      const data = await apiRequest("/api/whatsapp/test-send", {
        method: "POST",
        body: JSON.stringify({
          saleId: testSaleId || undefined,
          recipientPhone: testPhone || undefined,
          deliveryMode: form.deliveryMode,
        }),
      });
      if (!data?.success) throw new Error(data?.message || "Test send failed");
      setTestSendResult({ success: true, data: data.data || {} });
    } catch (err) {
      setTestSendResult({ success: false, message: err.message || "Test send failed" });
    } finally {
      setTestSendBusy(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-400">Loading WhatsApp settings...</div>;
  if (!config || !form) return null;

  const tokenConfigured = Boolean(config.access_token_configured);
  const webhookConfigured = Boolean(config.webhook_verify_token_configured);
  const activationReady = testResult?.success === true && !credentialsChanged;
  const testInvoiceAllowed =
    !credentialsChanged && (activationReady || testToken !== null || (enabled && Boolean(config.configured)));

  const input = (field, label, { secret = false, placeholder, required = false } = {}) => (
    <label className="text-sm text-slate-600">
      <span className="block mb-1 font-medium">
        {label}
        {secret && placeholder ? <span className="ml-2 text-xs text-emerald-600 font-normal">{placeholder}</span> : null}
      </span>
      <input
        type={secret ? "password" : "text"}
        required={required}
        disabled={testing}
        autoComplete="new-password"
        value={form[field] || ""}
        placeholder={secret ? (placeholder ? "Leave blank to keep the stored value" : "Not set") : placeholder || ""}
        onChange={(event) => (secret ? onSecretChange(field, event.target.value) : update(field, event.target.value))}
        className="w-full h-10 px-3 border border-slate-200 rounded-lg disabled:opacity-60"
      />
    </label>
  );

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header: status pills */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <MessageCircle size={18} className="text-emerald-600" />
            <h2 className="font-semibold">WhatsApp Business</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
              {enabled ? "ON" : "OFF"}
            </span>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.configured ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>
              {config.configured ? "Credentials configured" : "Not configured"}
            </span>
            <button
              type="button"
              onClick={load}
              className="h-8 w-8 flex items-center justify-center border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50"
              title="Reload configuration"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Credentials are stored encrypted (AES-256-GCM) and are never returned by the API. Connection must be
          tested successfully before WhatsApp can be switched ON. Automatic invoice sending is OFF unless you
          enable it below.
        </p>
      </div>

      {/* Provider / configuration */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-semibold mb-4">Provider configuration (Meta WhatsApp Cloud API)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {input("phoneNumberId", "Phone Number ID", { required: true, placeholder: config.phone_number_id || "e.g. 123456789012345" })}
          {input("businessAccountId", "WhatsApp Business Account ID", { placeholder: config.business_account_id || "optional" })}
          {input("displayName", "Display name", { placeholder: config.display_name || "optional" })}
          {input("defaultCountryCode", "Default country code", { placeholder: config.default_country_code || "e.g. 44" })}
          {input("accessToken", "Access token", { secret: true, placeholder: tokenConfigured ? config.access_token_masked : null })}
          {input("webhookVerifyToken", "Webhook verify token", { secret: true, placeholder: webhookConfigured ? config.webhook_verify_token_masked : null })}
          <label className="sm:col-span-2 text-sm text-slate-600">
            <span className="block mb-1 font-medium">Invoice message template (optional)</span>
            <textarea
              rows={2}
              disabled={testing}
              value={form.invoiceMessageTemplate || ""}
              placeholder={config.invoice_message_template || "Optional custom text prepended to the invoice message"}
              onChange={(event) => update("invoiceMessageTemplate", event.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg disabled:opacity-60"
            />
          </label>
          <label className="text-sm text-slate-600">
            <span className="block mb-1 font-medium">Delivery mode</span>
            <select
              disabled={testing}
              value={form.deliveryMode}
              onChange={(event) => update("deliveryMode", event.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg disabled:opacity-60"
            >
              <option value="link">Secure invoice link</option>
              <option value="pdf">PDF receipt attachment</option>
            </select>
          </label>
          <label className="text-sm text-slate-600">
            <span className="block mb-1 font-medium">Automatic sending after sale</span>
            <select
              disabled={testing}
              value={form.autoSendEnabled ? "on" : "off"}
              onChange={(event) => update("autoSendEnabled", event.target.value === "on")}
              className="w-full h-10 px-3 border border-slate-200 rounded-lg disabled:opacity-60"
            >
              <option value="off">OFF — send nothing automatically</option>
              <option value="on">ON — send invoice to the customer</option>
            </select>
          </label>
        </div>

        {/* Test + activation actions */}
        <div className="mt-5 pt-4 border-t border-slate-200 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="h-9 px-4 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
          >
            <ShieldCheck size={15} />
            {testing ? "Testing connection… please wait" : "Test Connection"}
          </button>
          {enabled ? (
            <>
              <button
                type="button"
                onClick={() => save(false)}
                disabled={saving}
                className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
              >
                <Save size={15} /> {saving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                onClick={() => save(false)}
                disabled={saving}
                className="h-9 px-4 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Turn OFF (keep credentials)
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => save(true)}
              disabled={!activationReady || saving}
              title={activationReady ? "Save and activate WhatsApp" : "Run a successful connection test first"}
              className="h-9 px-4 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save & Activate"}
            </button>
          )}
          {testResult && (
            <span className={`text-sm font-medium ${testResult.success ? "text-emerald-700" : "text-red-700"}`}>
              {testResult.success ? "✓ " : "✕ "}
              {testResult.message}
            </span>
          )}
        </div>
        {testing && <p className="text-xs text-slate-500 mt-2">Testing connection… please wait. Configuration is locked while testing.</p>}
      </div>

      {/* Test invoice: preview + real test send */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="font-semibold mb-1">Send test invoice</h3>
        <p className="text-xs text-slate-500 mb-4">
          <strong>Preview</strong> builds the exact message via the existing onePOS delivery contract and shows it —
          nothing is sent. <strong>Real test send</strong> sends a real WhatsApp message to the demo number you enter
          (never a stored customer number), using the selected delivery mode. Automatic sending stays OFF unless
          explicitly enabled above.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            value={testSaleId}
            onChange={(event) => setTestSaleId(event.target.value)}
            placeholder="Sale ID (optional for preview)"
            className="h-9 px-3 border border-slate-200 rounded-lg text-sm w-64"
          />
          <button
            type="button"
            onClick={sendTestInvoice}
            disabled={!testInvoiceAllowed || testInvoiceBusy}
            title={testInvoiceAllowed ? "Build the test invoice message" : "Test the connection (or activate) first"}
            className="h-9 px-4 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {testInvoiceBusy ? "Building…" : "Preview test invoice"}
          </button>
        </div>
        {testInvoice && (
          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans">{testInvoice.message}</pre>
            <p className="text-xs text-emerald-700 mt-2">{testInvoice.note}</p>
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-slate-200">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="tel"
              value={testPhone}
              onChange={(event) => setTestPhone(event.target.value)}
              placeholder="Demo number, e.g. +447700900123"
              disabled={!enabled || testSendBusy}
              className="h-9 px-3 border border-slate-200 rounded-lg text-sm w-64 disabled:opacity-50"
            />
            <input
              type="text"
              value={testSaleId}
              onChange={(event) => setTestSaleId(event.target.value)}
              placeholder="Sale ID (required for real send)"
              disabled={!enabled || testSendBusy}
              className="h-9 px-3 border border-slate-200 rounded-lg text-sm w-64 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={sendTestReal}
              disabled={!enabled || testSendBusy || !testPhone || !testSaleId}
              title={
                !enabled
                  ? "Activate WhatsApp first"
                  : "Send a real WhatsApp invoice to the demo number"
              }
              className="h-9 px-4 bg-emerald-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testSendBusy ? "Sending…" : "Send real test invoice"}
            </button>
          </div>
          {testSendResult && (
            <p className={`text-sm mt-3 font-medium ${testSendResult.success ? "text-emerald-700" : "text-red-700"}`}>
              {testSendResult.success
                ? `✓ Sent via WhatsApp (${testSendResult.data.mode || "link"} mode).`
                : `✕ ${testSendResult.message}`}
            </p>
          )}
          <p className="text-xs text-slate-500 mt-2">
            WhatsApp must be ON to test. Automatic sending is not required for a manual test — the message goes only to the number above.
          </p>
        </div>
      </div>

      {/* Recent WhatsApp invoice deliveries (company/store scoped) */}
      <DeliveryHistory />
    </div>
  );
}

export default WhatsAppSettings;
