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
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-xl font-bold">Server / API Configuration</h2>
        <p className="text-sm text-slate-500 mt-1">
          Override the default production API server for this device. Only Superadmins can change this.
        </p>

        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Current server</label>
            <div className="h-11 px-3 border border-slate-200 rounded-lg bg-slate-50 text-slate-600 text-sm font-mono break-all">
              {current || "Production Render default (https://onepos.onrender.com)"}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              New server address
              <span className="text-slate-400 font-normal ml-1">(include port if needed)</span>
            </label>
            <input
              value={input}
              onChange={(e) => { setInput(e.target.value); setTestResult(""); setSaveResult(""); }}
              placeholder="https://onepos.onrender.com or http://192.168.1.50:10000"
              inputMode="url"
              autoComplete="off"
              className="w-full h-12 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-600 font-mono text-sm"
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
              className="flex-1 h-12 rounded-lg bg-slate-700 hover:bg-slate-800 text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              data-testid="test-connection-button"
            >
              <RefreshCw size={16} className={testing ? "animate-spin" : ""} />
              {testing ? " Testing…" : " Test Connection"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={testing || !input.trim()}
              className="flex-1 h-12 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              data-testid="save-server-button"
            >
              <Save size={16} />
              {testing ? " Saving…" : " Change Server"}
            </button>
          </div>
        </div>

        {testResult && (
          <div className={`mt-4 p-3 rounded-lg text-sm ${testResult.includes("unreachable") ? "bg-red-50 border border-red-200 text-red-700" : testResult.includes("Saved") ? "bg-amber-50 border border-amber-200 text-amber-700" : "bg-emerald-50 border border-emerald-200 text-emerald-700"}`}>
            {testResult}
          </div>
        )}

        {saveResult && (
          <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">
            {saveResult}
          </div>
        )}
      </div>
    </div>
  );
}
