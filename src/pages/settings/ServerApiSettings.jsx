import { useState } from "react";
import { Save, RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { getServerAddress, setServerAddress, normaliseServerAddress } from "../../services/serverAddress.js";

/*
 * Server / API Configuration — Superadmin-only device-level server override.
 *
 * Reuses the existing serverAddress.js persistence (one localStorage key,
 * single source of truth for services/api.js). Does NOT touch accounts,
 * credentials, customer data, products, sales, the offline queue or the JWT.
 * Logout / user switching never clears this configuration — it belongs to the
 * device, not the user session.
 *
 * Safety: the new address is ALWAYS persisted first (so a failed health check
 * never silently erases the previous working configuration). The health check
 * result is shown but does not gate saving.
 */
export default function ServerApiSettings({ onMessage, onError }) {
  const current = getServerAddress();
  const [input, setInput] = useState(current);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [saveResult, setSaveResult] = useState("");

  const runHealthCheck = async () => {
    setTesting(true);
    setTestResult("");
    try {
      await apiRequest("/api/health", { signal: AbortSignal.timeout(8000) });
      setTestResult("Server reachable — health check passed.");
    } catch (err) {
      setTestResult("Server unreachable — " + (err.message || "connection failed"));
    } finally {
      setTesting(false);
    }
  };

  const handleTest = () => {
    const normalised = normaliseServerAddress(input);
    if (!normalised) {
      setTestResult("Enter a valid server address first.");
      return;
    }
    void runHealthCheck();
  };

  const handleSave = async () => {
    const normalised = normaliseServerAddress(input);
    if (!normalised) {
      onError("Enter a valid server address (e.g. https://onepos.onrender.com or http://192.168.1.50:10000).");
      return;
    }
    /* Persist first — an unreachable server must never erase the previous
       working configuration. */
    setServerAddress(normalised);
    setSaveResult("Saved " + normalised + ".");
    setInput(normalised);
    /* Then optionally verify. Failures are informational only. */
    setTestResult("Saved. Checking connection…");
    setTesting(true);
    try {
      await apiRequest("/api/health", { signal: AbortSignal.timeout(8000) });
      setTestResult("Connected to " + normalised);
    } catch {
      setTestResult("Saved " + normalised + ". Server unreachable right now — offline sign-in still works with the saved address.");
    } finally {
      setTesting(false);
    }
    onMessage("Server configuration updated.");
  };

  return (
    <div className="space-y-5" data-testid="server-api-settings">
      <div className="onepos-card onepos-card-body">
        <h2 className="onepos-page-title">Server / API Configuration</h2>
        <p className="onepos-page-subtitle">
          Override the default production API server for this device. Only Superadmins can change this.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="onepos-label">Current server</label>
            <div className="h-11 px-3 border border-slate-200 rounded-lg bg-slate-50 text-slate-600 text-sm font-mono break-all">
              {current || "Production Render default (https://onepos.onrender.com)"}
            </div>
          </div>

          <div>
            <label className="onepos-label">
              New server address
              <span className="font-normal ml-1">(include port if needed)</span>
            </label>
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); setTestResult(""); setSaveResult(""); }}
              placeholder="https://onepos.onrender.com or http://192.168.1.50:10000"
              inputMode="url"
              autoComplete="off"
              className="onepos-input font-mono"
              data-testid="server-address-input"
            />
            <p className="text-xs text-slate-400 mt-1">
              Examples: https://production-api.example.com · http://192.168.1.50:10000
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !input.trim()}
              className="onepos-btn onepos-btn-primary flex-1 flex items-center justify-center gap-2"
              data-testid="test-connection-button"
            >
              <RefreshCw size={16} className={testing ? "animate-spin" : ""} />
              {testing ? " Testing…" : " Test Connection"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={testing || !input.trim()}
              className="onepos-btn onepos-btn-primary flex-1"
              data-testid="save-server-button"
            >
              <Save size={16} />
              {testing ? " Saving…" : " Change Server"}
            </button>
          </div>
        </div>

        {testResult && (
          <div className={`mt-4 onepos-alert ${testResult.includes("unreachable") ? "onepos-alert-error" : testResult.includes("Saved") ? "onepos-alert-warning" : "onepos-alert-success"}`} role="status">
            {testResult}
          </div>
        )}

        {saveResult && (
          <div className="mt-3 onepos-alert onepos-alert-success" role="status">
            {saveResult}
          </div>
        )}
      </div>
    </div>
  );
}
