/*
 * T9M - Endpoint test panel.
 *
 * Sample onePOS JSON in, then: backend builds the partner payload from the
 * saved mappings, performs the real authenticated request and logs it. Shows
 * success/failure + HTTP status, the generated payload (read back from the
 * stored log row) and the redacted response body. Invalid JSON never calls
 * the API.
 */
import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { safeParse } from "./shared.jsx";

export const SAMPLE_JSON = `{
  "sales": {
    "sale_id": "S-1001",
    "receipt_number": "T01-20260916-0001",
    "total": 42.5,
    "customer": { "name": "Acme Ltd", "address": { "postcode": "SW1A 1AA" } },
    "items": [ { "quantity": 2, "product": { "ean": "5000111000011" } } ]
  }
}`;

export default function EndpointTestModal({ integration, endpoint, onClose }) {
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
                <span className="block text-xs mt-0.5 opacity-80">Trace: {result.correlationId} · logged with credentials redacted</span>
              </div>
              {generatedPayload != null && (
                <div>
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Generated payload (from mappings)</div>
                  <pre className="bg-gray-900 text-gray-100 rounded-lg p-3 text-xs overflow-x-auto">{typeof generatedPayload === "string" ? generatedPayload : JSON.stringify(generatedPayload, null, 2)}</pre>
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
