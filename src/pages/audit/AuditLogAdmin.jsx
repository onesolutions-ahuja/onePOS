import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search, Shield } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { Badge, Button, Card, PageHeader, Select } from "../../components/ui.jsx";

/*
 * Security & Staff — Audit Log (T10-AUDIT).
 *
 * Read-only listing of every audit_logs row for the current company, gated by
 * the audit.view permission. The backend (GET /api/audit-logs) enforces the
 * permission as the final authority; this page simply renders what it returns.
 *
 * Filters (all server-side, via query-string params):
 *  - action       : free-text match.
 *  - actor        : actor_username filter.
 *  - entityType   : e.g. product, sale, company.
 *  - result       : success / failure / denied.
 *  - date range   : from / to ISO dates.
 *
 * Sensitive columns are never returned to non-admin callers on this endpoint:
 * details are scrubbed server-side (passwords/PINs/tokens/card data stripped),
 * so the detail flyover can render them safely.
 */

function formatDateTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return String(iso);
  }
}

export default function AuditLogAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    action: "",
    actor: "",
    entityType: "",
    result: "",
    from: "",
    to: "",
  });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState(null);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.append(k, v));
    params.set("limit", String(pageSize));
    params.set("offset", String((page - 1) * pageSize));
    try {
      const data = await apiRequest(`/api/audit-logs?${params.toString()}`);
      if (data.success) {
        setRows(data.data?.rows || []);
        setTotal(data.data?.total || 0);
      } else {
        setError(data.message || "Failed to load audit log");
      }
    } catch (e) {
      setError(e.message || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const onFilterChange = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters({ action: "", actor: "", entityType: "", result: "", from: "", to: "" });
    setPage(1);
  };

  const resultBadge = (r) => {
    const tone = r === "success" ? "success" : r === "failure" ? "danger" : r === "denied" ? "warning" : "neutral";
    return <Badge tone={tone}>{r || "success"}</Badge>;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Log"
        subtitle="Records of staff actions and system events. Access is logged and requires the audit.view permission."
        actions={
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </Button>
        }
      />

      <Card>
        <div className="p-4 grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={filters.action}
              onChange={(e) => onFilterChange("action", e.target.value)}
              placeholder="Action"
              className="onepos-input pl-8"
            />
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={filters.actor}
              onChange={(e) => onFilterChange("actor", e.target.value)}
              placeholder="Actor"
              className="onepos-input pl-8"
            />
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              value={filters.entityType}
              onChange={(e) => onFilterChange("entityType", e.target.value)}
              placeholder="Entity type"
              className="onepos-input pl-8"
            />
          </div>
          <Select
            value={filters.result}
            onChange={(e) => onFilterChange("result", e.target.value)}
            className="text-sm"
          >
            <option value="">All results</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="denied">Denied</option>
          </Select>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => onFilterChange("from", e.target.value)}
            className="text-sm border rounded px-2 py-1.5 w-full"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => onFilterChange("to", e.target.value)}
            className="text-sm border rounded px-2 py-1.5 w-full"
          />
        </div>
        <div className="px-4 py-2 border-t flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={resetFilters}>Reset</Button>
          <Button size="sm" onClick={() => { setPage(1); load(); }}>Apply</Button>
        </div>
      </Card>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <Card>
        {selected && (
          <AuditDetailFlyover row={selected} onClose={() => setSelected(null)} />
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="pb-2 text-slate-500 font-medium">When</th>
              <th className="pb-2 text-slate-500 font-medium">Actor</th>
              <th className="pb-2 text-slate-500 font-medium">Action</th>
              <th className="pb-2 text-slate-500 font-medium">Entity</th>
              <th className="pb-2 text-slate-500 font-medium">Result</th>
              <th className="pb-2 text-slate-500 font-medium">Store</th>
              <th className="pb-2 text-slate-500 font-medium text-center">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-2 text-slate-600">{formatDateTime(r.created_at)}</td>
                <td className="py-2 font-mono">{r.actor_username || (r.user_id ? "system user" : <span className="text-slate-400">system</span>)}</td>
                <td className="py-2 font-mono">{r.action}</td>
                <td className="py-2 text-slate-600">{r.entity_type ? `${r.entity_type}:${String(r.entity_id || "").slice(0, 8)}` : "—"}</td>
                <td className="py-2">{resultBadge(r.result)}</td>
                <td className="py-2 text-slate-600">{r.store_id ? String(r.store_id).slice(0, 8) : "—"}</td>
                <td className="py-2 text-center">
                  <Button size="sm" variant="secondary" onClick={() => setSelected(r)}>
                    <Shield size={14} /> View
                  </Button>
                </td>
              </tr>
            ))}
            {!loading && !rows.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  No audit records match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t flex justify-between text-sm text-slate-600">
          <span>Showing {total ? from : 0}-{to} of {total}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page === 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="secondary" disabled={page * pageSize >= total || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function AuditDetailFlyover({ row, onClose }) {
  const details = row.details || {};
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
    >
      <div
        className="onepos-card max-w-2xl w-[90%] max-h-[80vh] overflow-y-auto m-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex justify-between items-center">
          <h3 className="font-semibold">Audit entry {String(row.id || "").slice(0, 8)}</h3>
          <button onClick={onClose} className="px-2 py-1 text-slate-500 hover:text-slate-800">✕</button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div><span className="font-medium text-slate-500">Action:</span> <code className="font-mono">{row.action}</code></div>
          <div><span className="font-medium text-slate-500">Actor:</span> {row.actor_username || row.user_id || "system"}</div>
          <div><span className="font-medium text-slate-500">Entity:</span> {row.entity_type} / {row.entity_id}</div>
          <div><span className="font-medium text-slate-500">Result:</span> {row.result}</div>
          <div><span className="font-medium text-slate-500">When:</span> {formatDateTime(row.created_at)}</div>
          <div><span className="font-medium text-slate-500">IP:</span> {row.ip_address || "—"}</div>
          <div>
            <span className="font-medium text-slate-500">Details (scrubbed):</span>
            <pre className="mt-1 whitespace-pre-wrap break-all text-xs bg-slate-50 border rounded p-2">
              {JSON.stringify(details, null, 2)}
            </pre>
          </div>
        </div>
        <div className="px-5 py-3 border-t flex justify-end">
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
