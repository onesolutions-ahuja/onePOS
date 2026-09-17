/*
 * T9M - API logs section.
 *
 * Timestamp, endpoint, event/entity, result pill, HTTP status, correlation
 * ID and error message; filters (endpoint / result / entity / date range)
 * and server-side pagination. Rows expand to the redacted request/response
 * preview — credentials are redacted by the backend before storage.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { ENTITY_TYPES, fmtDateTime } from "./shared.jsx";

const LOG_PAGE_SIZE = 25;

export default function ApiLogsPanel({ integration, endpoints }) {
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
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Endpoint</th>
              <th className="px-4 py-2 font-medium">Event / entity</th>
              <th className="px-4 py-2 font-medium">Result</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Correlation ID</th>
              <th className="px-4 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No API activity logged yet.</td></tr>
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
      </div>
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
      <tr className="border-b border-slate-100 hover:bg-slate-50/60 cursor-pointer align-top" onClick={onToggle} title="Click for request/response preview">
        <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(row.created_at)}</td>
        <td className="px-4 py-2 text-xs">{endpointName}</td>
        <td className="px-4 py-2 text-xs">{row.entity_type || "—"}</td>
        <td className="px-4 py-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${row.success ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {row.success ? "Success" : "Failed"}
          </span>
        </td>
        <td className="px-4 py-2 text-xs font-mono">{row.response_status ?? "—"}{row.duration_ms != null && <span className="text-slate-400"> · {row.duration_ms}ms</span>}</td>
        <td className="px-4 py-2 text-xs font-mono text-slate-500 max-w-[10rem] truncate" title={row.correlation_id || ""}>{row.correlation_id || "—"}</td>
        <td className="px-4 py-2 text-xs text-red-600 max-w-[14rem] truncate" title={row.error_message || ""}>{row.error_message || "—"}</td>
      </tr>
      {expanded && (
        <tr className="bg-slate-50/50">
          <td colSpan={7} className="px-4 py-3">
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
