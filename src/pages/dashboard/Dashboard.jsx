import { useCallback, useEffect, useState } from "react";
import { Package, Users, RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import DashboardGrid from "../../components/dashboard/DashboardGrid.jsx";

/*
 * The Dashboard is a RUNTIME, not a composition.
 *
 * It asks the platform for the dashboards this user may see (the existing
 * `/api/dashboards` endpoint already applies permission, company and
 * archive scoping), lets the user pick one, and renders its persisted
 * definition through the shared generic component runtime. When the user has no
 * saved dashboard — or lacks the custom-report permission that lists them — it
 * falls back to the shipped default definition. No KPI, chart or metric is
 * named in this file.
 */
export default function Dashboard({ onNavigate, onAddProduct, canViewReports = true }) {
  const [available, setAvailable] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [definition, setDefinition] = useState(null);
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* Saved dashboards permitted for this user, or an empty list when the user
     cannot see them. Archived and inaccessible dashboards are excluded
     server-side and therefore never offered here. */
  useEffect(() => {
    let alive = true;
    apiRequest("/api/dashboards")
      .then((response) => { if (alive && response.success) setAvailable(response.data || []); })
      .catch(() => { if (alive) setAvailable([]); });
    return () => { alive = false; };
  }, []);

  const loadDashboard = useCallback(async (dashboardId) => {
    try {
      setLoading(true);
      setError("");
      let value = null;
      if (dashboardId) {
        const saved = await apiRequest(`/api/dashboards/${dashboardId}`);
        if (saved.success) {
          value = {
            name: saved.data.name,
            description: saved.data.description,
            components: saved.data.components || [],
            filters: saved.data.filters || [],
          };
        }
      }
      if (!value) {
        /* Sensible default: the shipped default definition. */
        const fallback = await apiRequest("/api/dashboards/default");
        if (!fallback.success) throw new Error(fallback.message || "Unable to load dashboard");
        value = fallback.data;
      }
      setDefinition(value);
      /* One call runs every component through the one reporting engine. */
      if (dashboardId) {
        const run = await apiRequest(`/api/dashboards/${dashboardId}/run`, { method: "POST" });
        setComponents(run.success ? run.data?.components || [] : []);
      } else {
        const run = await apiRequest("/api/dashboards/run", { method: "POST", body: JSON.stringify(value) });
        setComponents(run.success ? run.data?.components || [] : []);
      }
    } catch (err) {
      setError(err.message || "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDashboard(activeId); }, [activeId, loadDashboard]);

  if (loading) {
    return <div data-testid="dashboard-loading">
      <div className="mb-6">
        <h1 className="onepos-page-title">Dashboard</h1>
        <p className="onepos-page-subtitle">Loading your dashboard…</p>
      </div>
      <DashboardGrid components={[1, 2, 3, 4].map((n) => ({ id: `skeleton-${n}`, type: "kpi", title: "", layout: { w: 3, h: 1 } }))} results={[]} loading />
    </div>;
  }

  if (error) {
    return <div className="rounded-xl border p-8 max-w-2xl" style={{ background: "var(--onepos-surface-raised)", borderColor: "var(--onepos-border)" }}>
      <h1 className="text-xl font-bold" style={{ color: "var(--onepos-text-heading)" }}>Unable to load dashboard</h1>
      <p className="text-sm mt-2" style={{ color: "var(--onepos-text-secondary)" }}>{error}</p>
      <button onClick={loadDashboard} className="mt-5 h-10 px-4 rounded-lg text-sm font-medium" style={{ background: "var(--onepos-accent-600)", color: "#fff" }}>
        <RefreshCw size={16} className="inline mr-2" />Refresh
      </button>
    </div>;
  }

  /* A saved dashboard can only be edited by someone who can see it, so the
     action is only framed as "Customise" when one is selected. */
  const canEditActive = !activeId || available.some((item) => item.id === activeId);
  const quickAction = "text-left rounded-xl p-4 transition-colors";
  const quickStyle = { background: "var(--onepos-card-bg, var(--onepos-surface-raised))", border: "1px solid var(--onepos-border)" };

  return <div>
    <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="onepos-page-title">{definition?.name || "Dashboard"}</h1>
        {definition?.description ? <p className="onepos-page-subtitle">{definition.description}</p> : null}
      </div>
      {canViewReports ? (
        <div className="flex items-center gap-2">
          {available.length > 1 ? (
            <select
              data-testid="dashboard-selector"
              aria-label="Choose a dashboard"
              className="onepos-input text-sm"
              style={{ width: "auto", maxWidth: 260 }}
              value={activeId || ""}
              onChange={(event) => setActiveId(event.target.value || null)}
            >
              <option value="">Default dashboard</option>
              {available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          ) : null}
          <button onClick={() => onNavigate("Dashboards")} className="onepos-btn onepos-btn-sm" data-testid="dashboard-edit">
            {canEditActive ? "Customise dashboard" : "Open Dashboard Builder"}
          </button>
        </div>
      ) : null}
    </div>

    <DashboardGrid
      components={definition?.components || []}
      results={components}
      className="onepos-page-enter"
    />

    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <button onClick={onAddProduct} className={quickAction} style={quickStyle}>
        <Package size={19} style={{ color: "var(--onepos-accent-600)" }} />
        <div className="font-semibold mt-2 text-sm" style={{ color: "var(--onepos-text-primary)" }}>Add Product</div>
      </button>
      <button onClick={() => onNavigate("Customers")} className={quickAction} style={quickStyle}>
        <Users size={19} style={{ color: "var(--onepos-accent-600)" }} />
        <div className="font-semibold mt-2 text-sm" style={{ color: "var(--onepos-text-primary)" }}>Add Customer</div>
      </button>
      {canViewReports ? (
        <button onClick={() => onNavigate("Dashboards")} className={quickAction} style={quickStyle}>
          <div className="font-semibold text-sm" style={{ color: "var(--onepos-text-primary)" }}>Customise this dashboard</div>
          <div className="text-xs mt-1" style={{ color: "var(--onepos-text-muted)" }}>
            Open Dashboard Builder to add, resize, reorder or reconfigure components.
          </div>
        </button>
      ) : null}
    </div>
  </div>;
}
