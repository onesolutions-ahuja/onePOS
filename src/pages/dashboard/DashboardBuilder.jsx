import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import DashboardGrid from "../../components/dashboard/DashboardGrid.jsx";
import { DASHBOARD_COMPONENTS, DASHBOARD_DATE_RANGES, DASHBOARD_SALES_FIELDS } from "../../components/dashboard/platformDashboard.js";

/*
 * The EXISTING Dashboard Builder, extended (not replaced). It offers the same
 * generic component vocabulary the runtime renders, and a Properties panel that
 * configures each component's datasource, metric, grouping, date range,
 * conditions, formatting and size. Everything it writes is dashboard metadata;
 * the Dashboard page renders that metadata through the same runtime.
 */
const empty = { name: "", description: "", components: [], filters: [] };
const AGGREGATE_FIELDS = DASHBOARD_SALES_FIELDS.filter((f) => f.aggregate);
const GROUPABLE_FIELDS = DASHBOARD_SALES_FIELDS.filter((f) => f.groupable);

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

function Properties({ component, onChange }) {
  const config = component.config || {};
  const report = config.report || {};
  const setConfig = (patch) => onChange({ ...component, config: { ...config, ...patch } });
  const setReport = (patch) => setConfig({ report: { ...report, ...patch } });
  const isChart = ["pie", "donut", "bar", "chart"].includes(component.type);
  const chosen = DASHBOARD_SALES_FIELDS.find((f) => f.key === config.valueField);

  return <div className="mt-3 grid gap-3 md:grid-cols-2">
    <div className="md:col-span-2">
      <span className={label}>Title</span>
      <input className={field} style={fieldStyle} value={component.title || ""} onChange={(e) => onChange({ ...component, title: e.target.value })} />
    </div>

    {component.type === "text" ? (
      <div className="md:col-span-2">
        <span className={label}>Content</span>
        <textarea className={field} rows={3} style={fieldStyle} value={config.content || ""} onChange={(e) => setConfig({ content: e.target.value })} />
      </div>
    ) : <>
      <div>
        <span className={label}>Data source</span>
        <select className={field} style={fieldStyle} value={report.dataSource || "sales"} onChange={(e) => setReport({ dataSource: e.target.value })}>
          <option value="sales">Sales (reporting engine)</option>
          <option value="platform_object">Platform Object</option>
        </select>
      </div>
      <div>
        <span className={label}>Metric field</span>
        <select className={field} style={fieldStyle} value={config.valueField || ""} onChange={(e) => setConfig({ valueField: e.target.value })}>
          <option value="">Select a metric</option>
          {AGGREGATE_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        {chosen ? <p className="text-[11px] mt-1" style={{ color: "var(--onepos-text-muted)" }}>Aggregation: SUM ({chosen.label})</p> : null}
      </div>
      <div>
        <span className={label}>{isChart ? "Category / group field" : "Label field (optional)"}</span>
        <select className={field} style={fieldStyle} value={config.labelField || ""} onChange={(e) => { setConfig({ labelField: e.target.value || null }); setReport({ groupBy: e.target.value ? [e.target.value] : [] }); }}>
          <option value="">{isChart ? "Select a grouping" : "None"}</option>
          {GROUPABLE_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </div>
      <div>
        <span className={label}>Date range</span>
        <select className={field} style={fieldStyle} value={config.dateRange || ""} onChange={(e) => setConfig({ dateRange: e.target.value || null })}>
          <option value="">Report default</option>
          {DASHBOARD_DATE_RANGES.map((range) => <option key={range.key} value={range.key}>{range.label}</option>)}
        </select>
      </div>
      <div>
        <span className={label}>Format</span>
        <select className={field} style={fieldStyle} value={config.format || "number"} onChange={(e) => setConfig({ format: e.target.value })}>
          <option value="number">Number</option>
          <option value="currency">Currency</option>
          <option value="percent">Percentage</option>
        </select>
      </div>
      {component.type === "kpi" ? (
        <div>
          <span className={label}>Size</span>
          <select className={field} style={fieldStyle} value={config.size || "medium"} onChange={(e) => setConfig({ size: e.target.value })}>
            <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
          </select>
        </div>
      ) : null}
      {isChart ? (
        <>
          <div>
            <span className={label}>Maximum categories</span>
            <input type="number" min={2} max={25} className={field} style={fieldStyle} value={config.maxCategories ?? 6} onChange={(e) => setConfig({ maxCategories: Number(e.target.value) })} />
          </div>
          <div>
            <span className={label}>Limit (bar chart)</span>
            <input type="number" min={1} max={200} className={field} style={fieldStyle} value={config.limit ?? 12} onChange={(e) => setConfig({ limit: Number(e.target.value) })} />
          </div>
        </>
      ) : null}

export default function DashboardBuilder() {
  const [dashboards, setDashboards] = useState([]);
  const [current, setCurrent] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
    const response = await apiRequest("/api/dashboards/run", { method: "POST", body: JSON.stringify({ ...(current || empty), name: current?.name || "Preview" }) });
    if (response.success) { setRuntime(response.data?.components || []); setPreview(true); }
    else setError(response.message || "Unable to preview this dashboard");
  };

  const addComponent = (type) => setCurrent((value) => ({ ...(value || empty), components: [...(value?.components || []), blankComponent(type)] }));
  const updateComponent = (index, next) => setCurrent((value) => {
    const components = [...(value?.components || [])];
    components[index] = next;
    return { ...value, components };
  });
  const moveComponent = (index, direction) => setCurrent((value) => {

  const cardStyle = { background: "var(--onepos-card-bg, var(--onepos-surface-raised))", border: "1px solid var(--onepos-border)", borderRadius: "var(--onepos-card-radius, 16px)" };

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
          <div key={item.id} className="p-4 flex justify-between items-center" style={cardStyle}>
            <div className="min-w-0">
              <b className="truncate block">{item.name}</b>
              <p className="text-sm truncate" style={{ color: "var(--onepos-text-muted)" }}>{item.description}</p>
            </div>
            <button className="onepos-btn onepos-btn-sm" onClick={() => { setCurrent(item); setRuntime(null); setPreview(false); }}>Open</button>
          </div>
        ))}
        {!dashboards.length ? <div className="p-8 text-center" style={cardStyle}><p style={{ color: "var(--onepos-text-muted)" }}>No saved dashboards yet. Start from the default composition or create a new one.</p></div> : null}
      </div>
      {error ? <p className="text-sm mt-3" style={{ color: "var(--onepos-text-danger, #b91c1c)" }}>{error}</p> : null}
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
        <button className="onepos-btn onepos-btn-sm" onClick={() => { setCurrent(null); setRuntime(null); setPreview(false); }}>Back</button>
      </div>
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
      <div className="min-w-0 space-y-4">
        <div className="p-4" style={cardStyle}>
          <span className={label}>Dashboard name</span>
          <input className={field} style={fieldStyle} value={current.name || ""} onChange={(e) => setCurrent({ ...current, name: e.target.value })} />
          <span className={`${label} mt-3`}>Description</span>
          <textarea className={field} rows={2} style={fieldStyle} value={current.description || ""} onChange={(e) => setCurrent({ ...current, description: e.target.value })} />
        </div>

        <div className="p-4" style={cardStyle}>
          <div className="font-semibold text-sm mb-1">Components</div>
          <p className="text-xs mb-3" style={{ color: "var(--onepos-text-muted)" }}>Add, reorder, resize and configure. These are the same generic components the Dashboard renders.</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {DASHBOARD_COMPONENTS.map((spec) => (
              <button key={spec.key} type="button" className="onepos-btn onepos-btn-sm" onClick={() => addComponent(spec.key)} data-testid={`add-component-${spec.key}`}>
                + {spec.label}
              </button>
            ))}
          </div>

          {(current.components || []).map((component, index) => (
            <div key={component.id} className="rounded-lg p-3 mb-2 border" style={{ borderColor: "var(--onepos-border)" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <b className="capitalize text-sm">{component.type}</b>
                <input className={`${field} flex-1 min-w-[160px]`} style={fieldStyle} placeholder="Component title" value={component.title || ""} onChange={(e) => updateComponent(index, { ...component, title: e.target.value })} />
                <button className="onepos-btn onepos-btn-sm" onClick={() => moveComponent(index, -1)} disabled={index === 0}>Move up</button>
                <button className="onepos-btn onepos-btn-sm" onClick={() => moveComponent(index, 1)} disabled={index === (current.components || []).length - 1}>Move down</button>
                <button className="onepos-btn onepos-btn-sm" onClick={() => removeComponent(index)}>Remove</button>
              </div>
              <Properties component={component} onChange={(next) => updateComponent(index, next)} />
            </div>
          ))}
          {!(current.components || []).length ? <p className="text-sm" style={{ color: "var(--onepos-text-muted)" }}>No components yet — add a Metric, Pie, Donut or Bar.</p> : null}
        </div>
      </div>

      <div className="min-w-0">
        <div className="p-4 lg:sticky" style={{ ...cardStyle, top: 0 }}>
          <div className="font-semibold text-sm mb-1">{preview ? "Preview" : "Layout"}</div>
          <p className="text-xs mb-3" style={{ color: "var(--onepos-text-muted)" }}>
            {preview ? "Live data, rendered by the shared dashboard runtime." : "Use Preview to render this composition with real data."}
          </p>
          <DashboardGrid components={current.components || []} results={preview ? runtime || [] : []} loading={false} />
        </div>
      </div>
    </div>
    {error ? <p className="text-sm mt-3" style={{ color: "var(--onepos-text-danger, #b91c1c)" }}>{error}</p> : null}
  </div>;
}

    const components = [...(value?.components || [])];
    const target = index + direction;
    if (target < 0 || target >= components.length) return value;
    [components[index], components[target]] = [components[target], components[index]];
    return { ...value, components };
  });
  const removeComponent = (index) => setCurrent((value) => ({ ...value, components: (value?.components || []).filter((_, i) => i !== index) }));
  const loadDefault = async () => {
    const response = await apiRequest("/api/dashboards/default");
    if (response.success) setCurrent({ ...response.data, id: null, name: `${response.data.name}` });
    else setError(response.message);
  };

      <div>
        <span className={label}>Width (grid columns, 1–12)</span>
        <input type="number" min={1} max={12} className={field} style={fieldStyle} value={component.layout?.w ?? 6} onChange={(e) => onChange({ ...component, layout: { ...component.layout, w: Number(e.target.value) } })} />
      </div>
      <div>
        <span className={label}>Height</span>
        <input type="number" min={1} max={12} className={field} style={fieldStyle} value={component.layout?.h ?? 4} onChange={(e) => onChange({ ...component, layout: { ...component.layout, h: Number(e.target.value) } })} />
      </div>
    </>}
  </div>;
}


const field = "w-full border rounded-lg px-2 py-1.5 text-sm";
const fieldStyle = { borderColor: "var(--onepos-border)", background: "var(--onepos-surface-raised)", color: "var(--onepos-text-primary)" };
const label = "block text-xs font-semibold mb-1";
