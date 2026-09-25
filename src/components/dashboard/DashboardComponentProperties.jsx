import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import { DASHBOARD_DATE_RANGES, DASHBOARD_SALES_FIELDS, DATE_FILTER_FIELDS, SUMMARY_COLUMN, aggregatesForFieldType, operatorsForFieldType, platformFieldChoices } from "./platformDashboard.js";

const FIELD = "w-full border rounded-lg px-2 py-1.5 text-sm";
const STYLE = { borderColor: "var(--onepos-border)", background: "var(--onepos-surface-raised)", color: "var(--onepos-text-primary)" };
const LABEL = "block text-xs font-semibold mb-1";

function useObjects() {
  const [state, setState] = useState({ objects: [], error: "" });
  useEffect(() => {
    let alive = true;
    apiRequest("/api/reports/custom/metadata").then((response) => {
      if (!alive) return;
      setState(response.success ? { objects: response.data?.platformObjects || [], error: "" } : { objects: [], error: response.message || "Unable to load Objects" });
    }).catch((error) => alive && setState({ objects: [], error: error.message }));
    return () => { alive = false; };
  }, []);
  return state;
}

function useFields(objectId) {
  const [state, setState] = useState({ fields: [], loading: false, error: "" });
  useEffect(() => {
    if (!objectId) { setState({ fields: [], loading: false, error: "" }); return undefined; }
    let alive = true;
    setState({ fields: [], loading: true, error: "" });
    apiRequest(`/api/reports/custom/platform-objects/${encodeURIComponent(objectId)}/metadata`).then((response) => {
      if (!alive) return;
      setState(response.success ? { fields: response.data?.fields || [], loading: false, error: "" } : { fields: [], loading: false, error: response.message || "Unable to load Object fields" });
    }).catch((error) => alive && setState({ fields: [], loading: false, error: error.message }));
    return () => { alive = false; };
  }, [objectId]);
  return state;
}

function ConditionEditor({ component, onChange, fields }) {
  const config = component.config || {};
  const report = config.report || {};
  const conditions = Array.isArray(report.filters) ? report.filters : [];
  const available = report.dataSource === "platform_object" ? platformFieldChoices(fields).all : DATE_FILTER_FIELDS.map((field) => ({ key: field.key, label: field.label, type: field.kind === "date" ? "date" : "text" }));
  const setFilters = (filters) => onChange({ ...component, config: { ...config, report: { ...report, filters } } });
  const isDatePreset = (operator) => DASHBOARD_DATE_RANGES.some((range) => range.key === operator);
  return <div className="md:col-span-2 rounded-lg p-3" style={{ border: "1px solid var(--onepos-border)" }} data-testid="condition-editor">
    <div className="flex items-center justify-between mb-2">
      <span className={LABEL}>Conditions</span>
      <div className="flex items-center gap-2">
        {conditions.length > 1 ? <select aria-label="Filter logic" data-testid="filter-logic" className="onepos-input text-xs" style={{ width: "auto" }} value={report.filterLogic || "all"} onChange={(event) => onChange({ ...component, config: { ...config, report: { ...report, filterLogic: event.target.value } } })}><option value="all">Match all</option><option value="any">Match any</option></select> : null}
        <button type="button" className="onepos-btn onepos-btn-sm" data-testid="add-condition" onClick={() => setFilters([...conditions, { field: available[0]?.key || "", operator: "equals", value: "" }])}>+ Condition</button>
      </div>
    </div>
    {!conditions.length ? <p className="text-xs" style={{ color: "var(--onepos-text-muted)" }}>No conditions — every record in the datasource is included.</p> : null}
    {conditions.map((condition, index) => {
      const field = available.find((entry) => entry.key === condition.field);
      const operators = field?.type === "date" ? DASHBOARD_DATE_RANGES.map((range) => [range.key, range.label]) : operatorsForFieldType(field?.type);
      const needsValue = !["is_blank", "is_not_blank"].includes(condition.operator) && !isDatePreset(condition.operator);
      const update = (patch) => setFilters(conditions.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
      return <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] items-end mb-2" data-testid={`condition-${index}`}>
        <select aria-label="Condition field" className={FIELD} style={STYLE} value={condition.field || ""} onChange={(event) => update({ field: event.target.value, operator: "equals" })}>{available.length ? null : <option value="">No fields available</option>}{available.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</select>
        <select aria-label="Condition operator" className={FIELD} style={STYLE} value={condition.operator || "equals"} onChange={(event) => update({ operator: event.target.value })}>{operators.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        {needsValue ? <input aria-label="Condition value" className={FIELD} style={STYLE} value={Array.isArray(condition.value) ? condition.value.join(", ") : (condition.value ?? "")} placeholder={condition.operator === "in" ? "comma separated" : "value"} onChange={(event) => update({ value: event.target.value })} /> : <span className="text-xs py-2" style={{ color: "var(--onepos-text-muted)" }}>No value needed</span>}
        <button type="button" className="onepos-btn onepos-btn-sm" data-testid={`remove-condition-${index}`} onClick={() => setFilters(conditions.filter((_, i) => i !== index))}>Remove</button>
      </div>;
    })}
  </div>;
}

export default function DashboardComponentProperties({ component, onChange }) {
  const config = component.config || {};
  const report = config.report || {};
  const isPlatform = report.dataSource === "platform_object";
  const isChart = ["pie", "donut", "bar", "chart"].includes(component.type);
  const { objects, error: objectsError } = useObjects();
  const { fields, loading, error: fieldsError } = useFields(isPlatform ? report.objectId : null);
  const choices = platformFieldChoices(fields);
  const metrics = isPlatform ? choices.metricFields : DASHBOARD_SALES_FIELDS.filter((field) => field.aggregate);
  const groups = isPlatform ? choices.groupFields : DASHBOARD_SALES_FIELDS.filter((field) => field.groupable);
  const typeOf = (key) => (isPlatform ? choices.all.find((field) => field.key === key)?.type : DASHBOARD_SALES_FIELDS.find((field) => field.key === key)?.type) || "text";
  const aggregates = isPlatform ? aggregatesForFieldType(typeOf(config.valueField)) : ["SUM"];
  const setConfig = (patch) => onChange({ ...component, config: { ...config, ...patch } });
  const setReport = (patch) => onChange({ ...component, config: { ...config, report: { ...report, ...patch } } });
  const num = (patch) => (event) => setConfig({ [patch]: Number(event.target.value) });
  const layout = (patch) => (event) => onChange({ ...component, layout: { ...component.layout, [patch]: Number(event.target.value) } });
  const selectGroup = (value) => { setConfig({ labelField: value || null }); setReport({ fields: [...new Set([config.valueField, value].filter(Boolean))], groupBy: value ? [value] : [] }); };
  /* Keep the report definition valid: every selected metric must also be in
     `fields`, and a Platform Object metric must carry its aggregate summary. */
  const selectMetric = (value) => {
    if (!value) { setConfig({ valueField: null, aggregate: null }); setReport({ fields: report.groupBy, summaries: [] }); return; }
    const aggregate = isPlatform ? (aggregatesForFieldType(typeOf(value)).includes(config.aggregate) ? config.aggregate : (aggregatesForFieldType(typeOf(value))[0] || "COUNT")) : "SUM";
    setConfig({ valueField: value, aggregate: isPlatform ? aggregate : null });
    setReport({ fields: [...new Set([value, report.groupBy[0]].filter(Boolean))], summaries: isPlatform ? [{ aggregate, field: value }] : [] });
  };
  const selectAggregate = (value) => { setConfig({ aggregate: value }); if (config.valueField) setReport({ summaries: [{ aggregate: value, field: config.valueField }] }); };
  return <div className="mt-3 grid gap-3 md:grid-cols-2">
    <div className="md:col-span-2"><span className={LABEL}>Title</span><input className={FIELD} style={STYLE} value={component.title || ""} onChange={(event) => onChange({ ...component, title: event.target.value })} /></div>
    {component.type === "text" ? <div className="md:col-span-2"><span className={LABEL}>Content</span><textarea className={FIELD} rows={3} style={STYLE} value={config.content || ""} onChange={(event) => setConfig({ content: event.target.value })} /></div> : <>
      <div><span className={LABEL}>Data source</span><select className={FIELD} style={STYLE} value={report.dataSource || "sales"} onChange={(event) => setReport({ dataSource: event.target.value, objectId: null, fields: [], groupBy: [], filters: [] })}><option value="sales">Sales (reporting engine)</option><option value="platform_object">Platform Object</option></select></div>
      {isPlatform ? <div><span className={LABEL}>Object</span><select className={FIELD} style={STYLE} value={report.objectId || ""} onChange={(event) => setReport({ objectId: event.target.value, fields: [], groupBy: [], filters: [] })}><option value="">{objectsError || (loading ? "Loading fields…" : "Select an Object")}</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.label || object.object_key}</option>)}</select>{fieldsError ? <p className="text-xs" style={{ color: "#b91c1c" }}>{fieldsError}</p> : null}</div> : null}
      <div><span className={LABEL}>Metric field</span><select data-testid="metric-field" className={FIELD} style={STYLE} value={config.valueField || ""} onChange={(event) => selectMetric(event.target.value)}><option value="">Select a metric</option>{metrics.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select>{isPlatform && report.objectId && !loading && !metrics.length ? <p className="text-xs" style={{ color: "var(--onepos-text-muted)" }}>This Object has no aggregatable fields.</p> : null}</div>
      {isPlatform ? <div><span className={LABEL}>Aggregation</span><select data-testid="aggregate" className={FIELD} style={STYLE} value={config.aggregate || "COUNT"} onChange={(event) => selectAggregate(event.target.value)}>{aggregates.map((aggregate) => <option key={aggregate} value={aggregate}>{aggregate}</option>)}</select></div> : null}
      <div><span className={LABEL}>{isChart ? "Category / group field" : "Label field (optional)"}</span><select className={FIELD} style={STYLE} value={config.labelField || ""} onChange={(event) => selectGroup(event.target.value)}><option value="">None</option>{groups.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></div>
      <div><span className={LABEL}>Date range</span><select data-testid="date-range" className={FIELD} style={STYLE} value={config.dateRange || ""} onChange={(event) => setConfig({ dateRange: event.target.value || null })}><option value="">Report default</option>{DASHBOARD_DATE_RANGES.map((range) => <option key={range.key} value={range.key}>{range.label}</option>)}</select></div>
      <div><span className={LABEL}>Format</span><select data-testid="format" className={FIELD} style={STYLE} value={config.format || "number"} onChange={(event) => setConfig({ format: event.target.value })}><option value="number">Number</option><option value="currency">Currency</option><option value="percent">Percentage</option></select></div>
      {component.type === "kpi" ? <div><span className={LABEL}>Size</span><select data-testid="size" className={FIELD} style={STYLE} value={config.size || "medium"} onChange={(event) => setConfig({ size: event.target.value })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></div> : null}
      {isChart ? <><div><span className={LABEL}>Maximum categories</span><input type="number" min={2} max={25} data-testid="max-categories" className={FIELD} style={STYLE} value={config.maxCategories ?? 6} onChange={num("maxCategories")} /></div><div><span className={LABEL}>Limit</span><input type="number" min={1} max={200} className={FIELD} style={STYLE} value={config.limit ?? 12} onChange={num("limit")} /></div></> : null}
      <div><span className={LABEL}>Width (grid columns, 1–12)</span><input type="number" min={1} max={12} data-testid="width" className={FIELD} style={STYLE} value={component.layout?.w ?? 6} onChange={layout("w")} /></div>
      <div><span className={LABEL}>Height</span><input type="number" min={1} max={12} className={FIELD} style={STYLE} value={component.layout?.h ?? 4} onChange={layout("h")} /></div>
      <ConditionEditor component={component} onChange={onChange} fields={fields} />
    </>}
    <p className="md:col-span-2 text-xs" data-testid="value-column" style={{ color: "var(--onepos-text-muted)" }}>Value column: <code>{isPlatform && config.aggregate && config.valueField ? SUMMARY_COLUMN(config.aggregate, config.valueField) : config.valueField || "not selected"}</code></p>
  </div>;
}
