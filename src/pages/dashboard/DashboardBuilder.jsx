import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import DashboardLayoutCanvas from "../../components/dashboard/DashboardLayoutCanvas.jsx";
import DashboardComponentProperties from "../../components/dashboard/DashboardComponentProperties.jsx";
// DashboardComponentProperties (the shared <DashboardGrid> editor surface)
// exposes Data source, Metric field, Category / group field, Date range,
// Format, Size, Maximum categories, Width and Height controls.
import { DASHBOARD_COMPONENTS, DASHBOARD_SALES_FIELDS, applyLayout } from "../../components/dashboard/platformDashboard.js";

/*
 * The EXISTING Dashboard Builder, extended (not replaced). It offers the same
 * generic component vocabulary the runtime renders, and a Properties panel that
 * configures each component's datasource, metric, grouping, date range,
 * conditions, formatting and size. Everything it writes is dashboard metadata;
 * the Dashboard page renders that metadata through the same runtime.
 */
const empty = { name: "", description: "", components: [], filters: [] };
const AGGREGATE_FIELDS = DASHBOARD_SALES_FIELDS.filter((f) => f.aggregate);
const CARD = { background: "var(--onepos-card-bg, var(--onepos-surface-raised))", border: "1px solid var(--onepos-border)", borderRadius: "var(--onepos-card-radius, 16px)" };
const FIELD = "w-full border rounded-lg px-2 py-1.5 text-sm";
const FIELD_STYLE = { borderColor: "var(--onepos-border)", background: "var(--onepos-surface-raised)", color: "var(--onepos-text-primary)" };
const LABEL = "block text-xs font-semibold mb-1";

const blankComponent = (type) => ({
  id: crypto.randomUUID(),
  type,
  title: type.charAt(0).toUpperCase() + type.slice(1),
  config: type === "text"
    ? { content: "" }
    : {
        report: { dataSource: "sales", fields: [], groupBy: [], sort: [], filters: [], filterLogic: "all" },
        valueField: AGGREGATE_FIELDS[0]?.key || null,
        labelField: null,
        format: "number",
        size: "medium",
        maxCategories: 6,
        limit: 12,
        dateRange: "this_month",
      },
  layout: type === "kpi" ? { x: 0, y: 0, w: 3, h: 1 } : { x: 0, y: 0, w: 6, h: 4 },
});


export default function DashboardBuilder() {
  const [dashboards, setDashboards] = useState([]);
  const [current, setCurrent] = useState(null);
  const [runtime, setRuntime] = useState([]);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const selectedIndex = Math.max(0, (current?.components || []).findIndex((component) => component.id === selectedId));
  const selectedComponent = (current?.components || [])[selectedIndex] || null;

  const load = useCallback(async () => {
    const response = await apiRequest("/api/dashboards");
    if (response.success) setDashboards(response.data || []);
    else setError(response.message);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const value = current || empty;
    if (!value.name.trim()) return setError("Dashboard name is required");
    setSaving(true);
    const response = await apiRequest(current?.id ? `/api/dashboards/${current.id}` : "/api/dashboards", {
      method: current?.id ? "PUT" : "POST",
      body: JSON.stringify(value),
    });
    setSaving(false);
    if (!response.success) return setError(response.message);
    setCurrent(response.data);
    load();
  };

  /* Preview runs the UNSAVED definition through the same endpoint the Dashboard
     page uses, so the builder previews exactly what will render. */
  const runPreview = async () => {
    setError("");
    const response = await apiRequest("/api/dashboards/run", {
      method: "POST",
      body: JSON.stringify({ ...(current || empty), name: current?.name || "Preview" }),
    });
    if (response.success) { setRuntime(response.data?.components || []); setPreview(true); }
    else setError(response.message || "Unable to preview this dashboard");
  };

  const loadDefault = async () => {
    const response = await apiRequest("/api/dashboards/default");
    if (response.success) setCurrent({ ...response.data, id: null });
    else setError(response.message);
  };


  const addComponent = (type) => setCurrent((value) => ({ ...(value || empty), components: [...(value?.components || []), blankComponent(type)] }));
  const updateComponent = (index, next) => setCurrent((value) => {
    const components = [...(value?.components || [])];
    components[index] = next;
    return { ...value, components };
  });
  const moveComponent = (index, direction) => setCurrent((value) => {
    const components = [...(value?.components || [])];
    const target = index + direction;
    if (target < 0 || target >= components.length) return value;
    [components[index], components[target]] = [components[target], components[index]];
    return { ...value, components };
  });
  const removeComponent = (index) => setCurrent((value) => ({ ...value, components: (value?.components || []).filter((_, i) => i !== index) }));
  const close = () => { setCurrent(null); setRuntime([]); setPreview(false); };


  if (!current) {
    return <div>
      <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="onepos-page-title">Dashboard Builder</h1>
          <p className="onepos-page-subtitle">Compose dashboards from generic, configurable components.</p>
        </div>
        <div className="flex gap-2">
          <button className="onepos-btn onepos-btn-sm" onClick={loadDefault}>Start from the default</button>
          <button className="onepos-btn onepos-btn-sm onepos-btn-primary" onClick={() => setCurrent({ ...empty })}>New dashboard</button>
        </div>
      </div>
      <div className="grid gap-3">
        {dashboards.map((item) => (
          <div key={item.id} className="p-4 flex justify-between items-center" style={CARD}>
            <div className="min-w-0">
              <b className="truncate block">{item.name}</b>
              <p className="text-sm truncate" style={{ color: "var(--onepos-text-muted)" }}>{item.description}</p>
            </div>
            <button className="onepos-btn onepos-btn-sm" onClick={() => { setCurrent(item); setRuntime([]); setPreview(false); }}>Open</button>
          </div>
        ))}
        {!dashboards.length ? <div className="p-8 text-center" style={CARD}><p style={{ color: "var(--onepos-text-muted)" }}>No saved dashboards yet. Start from the default composition or create a new one.</p></div> : null}
      </div>
      {error ? <p className="text-sm mt-3" style={{ color: "#b91c1c" }}>{error}</p> : null}
    </div>;
  }

  return <div>
    <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 className="onepos-page-title">Dashboard Builder</h1>
        <p className="onepos-page-subtitle">Configure components, then save. The Dashboard renders exactly this metadata.</p>
      </div>
      <div className="flex gap-2">
        <button className="onepos-btn onepos-btn-sm" onClick={runPreview}>Preview</button>
        <button className="onepos-btn onepos-btn-sm onepos-btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button className="onepos-btn onepos-btn-sm" onClick={close}>Back</button>
      </div>
    </div>


    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px] items-start">
      <div className="min-w-0 space-y-4 order-2 xl:order-1">
        <div className="p-4" style={CARD}>
          <span className={LABEL}>Dashboard name</span>
          <input className={FIELD} style={FIELD_STYLE} value={current.name || ""} onChange={(e) => setCurrent({ ...current, name: e.target.value })} />
          <span className={`${LABEL} mt-3`}>Description</span>
          <textarea className={FIELD} rows={2} style={FIELD_STYLE} value={current.description || ""} onChange={(e) => setCurrent({ ...current, description: e.target.value })} />
        </div>

        {/* The layout canvas: drag to reorder, corner-handle to resize. It
            renders through <DashboardGrid>, so what is arranged here is exactly
            what the runtime renders. */}
        <div className="p-4" style={CARD} data-testid="dashboard-layout-panel">
          <div className="font-semibold text-sm mb-1">Layout</div>
          <p className="text-xs mb-3" style={{ color: "var(--onepos-text-muted)" }}>
            {preview ? "Live preview rendered by the shared dashboard runtime." : "Drag components to reorder and resize them. Positions and sizes are saved with the dashboard."}
          </p>
          <DashboardLayoutCanvas
            components={applyLayout(current.components || [])}
            results={preview ? runtime : []}
            loading={false}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={(components) => setCurrent({ ...current, components })}
          />
          <div className="flex flex-wrap gap-2 mt-4">
            {DASHBOARD_COMPONENTS.map((spec) => (
              <button key={spec.key} type="button" className="onepos-btn onepos-btn-sm" data-testid={`add-component-${spec.key}`} onClick={() => addComponent(spec.key)}>
                + {spec.label}
              </button>
            ))}
          </div>
          {!(current.components || []).length ? <p className="text-sm mt-3" style={{ color: "var(--onepos-text-muted)" }}>No components yet — add a Metric, Pie, Donut or Bar.</p> : null}
        </div>
      </div>

      {/* Properties for the selected component. */}
      <div className="min-w-0 order-1 xl:order-2">
        <div className="p-4 xl:sticky" style={{ ...CARD, top: 0 }} data-testid="dashboard-properties-panel">
          <div className="font-semibold text-sm mb-1">Properties</div>
          {selectedComponent ? (
            <>
              <p className="text-xs mb-3 capitalize" style={{ color: "var(--onepos-text-muted)" }}>
                {selectedComponent.type} — {selectedComponent.title || "untitled"}
              </p>
              <div className="flex items-center gap-2 mb-3">
                <button className="onepos-btn onepos-btn-sm" onClick={() => moveComponent(selectedIndex, -1)} disabled={selectedIndex <= 0}>Move up</button>
                <button className="onepos-btn onepos-btn-sm" onClick={() => moveComponent(selectedIndex, 1)} disabled={selectedIndex === (current.components || []).length - 1}>Move down</button>
                <button className="onepos-btn onepos-btn-sm" onClick={() => removeComponent(selectedIndex)}>Remove</button>
              </div>
              <DashboardComponentProperties component={selectedComponent} onChange={(next) => updateComponent(selectedIndex, next)} />
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--onepos-text-muted)" }}>
              Select a component on the layout canvas to configure its data source, metric, grouping, conditions, date range and formatting.
            </p>
          )}
        </div>
      </div>
    </div>
    {error ? <p className="text-sm mt-3" style={{ color: "#b91c1c" }}>{error}</p> : null}
  </div>;
}
