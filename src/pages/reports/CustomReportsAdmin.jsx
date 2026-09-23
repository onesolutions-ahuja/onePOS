import { useEffect, useMemo, useState } from "react";
import ReportTable from "./ReportTable.jsx";
import {
  archiveCustomReport,
  createCustomReport,
  duplicateCustomReport,
  getCustomReportMetadata,
  getPlatformReportFields,
  getCustomReports,
  runCustomReport,
  previewCustomReport,
  updateCustomReport,
  updateCustomReportUsers,
} from "../../services/customReports.js";

const today = () => new Date().toISOString().slice(0, 10);
const initialDefinition = () => ({
  name: "",
  description: "",
  dataSource: "sales",
  fields: ["date", "net_sales", "transactions"],
  filters: [{ field: "date", operator: "this_week" }],
  groupBy: ["date"],
  sort: [{ field: "date", direction: "desc" }],
});
function errorMessage(error) {
  return error?.message || "Unable to load custom reports";
}

function fieldLabel(fields, key) {
  return fields.find((field) => field.key === key)?.label || key;
}

export default function CustomReportsAdmin() {
  const [reports, setReports] = useState([]);
  const [metadata, setMetadata] = useState({ fields: [], filters: [], stores: [], users: [], platformObjects: [], sources: [], canManage: false });
  const [definition, setDefinition] = useState(initialDefinition);
  const [editingId, setEditingId] = useState(null);
  const [running, setRunning] = useState(null);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [platformFields, setPlatformFields] = useState([]);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [list, meta] = await Promise.all([getCustomReports(), getCustomReportMetadata()]);
      if (!list.success) throw new Error(list.message);
      if (!meta.success) throw new Error(meta.message);
      setReports(meta.data?.reports || list.data || []);
      setMetadata({
        fields: meta.data?.fields || [],
        filters: meta.data?.filters || [],
        stores: meta.data?.stores || [],
        users: meta.data?.users || [],
        platformObjects: meta.data?.platformObjects || [],
        sources: meta.data?.sources || [],
        canManage: meta.data?.canManage === true,
      });
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (definition.dataSource !== "platform_object" || !definition.objectId) {
      setPlatformFields([]);
      return;
    }
    let cancelled = false;
    getPlatformReportFields(definition.objectId)
      .then((response) => {
        if (!cancelled) setPlatformFields(response.data?.fields || []);
      })
      .catch(() => {
        if (!cancelled) setPlatformFields([]);
      });
    return () => { cancelled = true; };
  }, [definition.dataSource, definition.objectId]);

  const availableFields = definition.dataSource === "platform_object" ? platformFields : metadata.fields;
  const selectedFields = useMemo(
    () => availableFields.filter((field) => definition.fields.includes(field.key)),
    [availableFields, definition.fields]
  );

  const updateDefinition = (patch) => setDefinition((current) => ({ ...current, ...patch }));

  const changeSource = (dataSource) => {
    if (dataSource === "sales") {
      setPlatformFields([]);
      updateDefinition({ dataSource, objectId: "", fields: ["date", "net_sales", "transactions"], groupBy: ["date"], summaries: [] });
      return;
    }
    const objectId = metadata.platformObjects?.[0]?.id || "";
    updateDefinition({ dataSource, objectId, fields: [], groupBy: [], summaries: [], filters: [], sort: [] });
  };

  const changePlatformObject = (objectId) => {
    updateDefinition({ objectId, fields: [], groupBy: [], summaries: [], filters: [], sort: [] });
  };

  const toggleField = (key) => {
    const fields = definition.fields.includes(key)
      ? definition.fields.filter((field) => field !== key)
      : [...definition.fields, key];
    updateDefinition({ fields });
  };

  const save = async (runAfterSave = false) => {
    try {
      setSaving(true);
      setError("");
      setNotice("");
      if (!definition.name.trim()) throw new Error("Report name is required");
      if (!definition.fields.length) throw new Error("Select at least one field");
      const response = editingId
        ? await updateCustomReport(editingId, definition)
        : await createCustomReport(definition);
      if (!response.success) throw new Error(response.message);
      const saved = response.data;
      setEditingId(saved?.id || editingId);
      setDefinition(saved?.definition ? { ...saved.definition, name: saved.name, description: saved.description || "" } : definition);
      const reportId = saved?.id || editingId;
      if (reportId && metadata.canManage) {
        const mapping = await updateCustomReportUsers(reportId, definition.userIds || []);
        if (!mapping.success) throw new Error(mapping.message);
      }
      setNotice("Report saved.");
      await load();
      if (runAfterSave && (saved?.id || editingId)) await run(saved?.id || editingId, saved?.definition || definition);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const run = async (id, nextDefinition = null) => {
    try {
      setRunning(id);
      setError("");
      const response = await runCustomReport(id, nextDefinition);
      if (!response.success) throw new Error(response.message);
      setResults(response.data || null);
    } catch (runError) {
      setError(errorMessage(runError));
    } finally {
      setRunning(null);
    }
  };

  const preview = async () => {
    try {
      setRunning("preview");
      setError("");
      const response = await previewCustomReport(definition);
      if (!response.success) throw new Error(response.message);
      setResults(response.data || null);
      setNotice("Preview generated from current data.");
    } catch (previewError) {
      setError(errorMessage(previewError));
    } finally {
      setRunning(null);
    }
  };

  const open = (report) => {
    setEditingId(report.id);
    setDefinition({ ...(report.definition || {}), userIds: report.user_ids || [], name: report.name, description: report.description || "" });
    setResults(null);
    setNotice("");
  };

  const duplicate = async (report) => {
    try {
      const response = await duplicateCustomReport(report.id);
      if (!response.success) throw new Error(response.message);
      setNotice("Report duplicated.");
      await load();
    } catch (duplicateError) {
      setError(errorMessage(duplicateError));
    }
  };

  const archive = async (report) => {
    if (!window.confirm(`Archive "${report.name}"?`)) return;
    try {
      const response = await archiveCustomReport(report.id);
      if (!response.success) throw new Error(response.message);
      if (editingId === report.id) {
        setEditingId(null);
        setDefinition(initialDefinition());
        setResults(null);
      }
      await load();
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    }
  };

  const setFilter = (index, patch) => {
    const filters = definition.filters.map((filter, filterIndex) =>
      filterIndex === index ? { ...filter, ...patch } : filter
    );
    updateDefinition({ filters });
  };

  const setGroupBy = (value) => updateDefinition({ groupBy: value ? [value] : [] });
  const setSort = (field, direction) => updateDefinition({ sort: field ? [{ field, direction }] : [] });

  if (loading) return <div className="onepos-empty">Loading custom reports...</div>;

  return (
    <div className="space-y-5">
      <div className="onepos-page-header">
        <div>
          <h1 className="onepos-page-title">My Reports</h1>
          <p className="onepos-page-subtitle">Saved report definitions run against current sales data.</p>
        </div>
        <button type="button" onClick={() => { setEditingId(null); setDefinition(initialDefinition()); setResults(null); setNotice(""); }} className="onepos-btn onepos-btn-primary">
          Create Report
        </button>
      </div>

      {error && <div className="onepos-alert onepos-alert-error">{error}</div>}
      {notice && <div className="onepos-alert onepos-alert-success">{notice}</div>}

      <div className="onepos-card overflow-hidden">
        <div className="onepos-card-header"><span className="onepos-card-title">Available reports</span></div>
        {reports.length ? reports.map((report) => (
          <div key={report.id} className="p-4 border-b last:border-b-0 flex flex-wrap items-center gap-3">
            <div className="min-w-[220px] flex-1">
              <div className="font-medium">{report.name}</div>
              <div className="text-xs text-slate-500">{report.description || "Sales report"} · {report.created_by_name ? `Created by ${report.created_by_name}` : "Sales"}</div>
            </div>
            <button type="button" onClick={() => run(report.id)} disabled={running === report.id} className="onepos-btn onepos-btn-sm onepos-btn-primary">{running === report.id ? "Running..." : "Run"}</button>
            <button type="button" onClick={() => open(report)} className="onepos-btn onepos-btn-sm onepos-btn-secondary">Edit</button>
            <button type="button" onClick={() => duplicate(report)} className="onepos-btn onepos-btn-sm onepos-btn-secondary">Duplicate</button>
            <button type="button" onClick={() => archive(report)} className="onepos-btn onepos-btn-sm onepos-btn-secondary text-red-700">Archive</button>
          </div>
        )) : <div className="onepos-empty"><span className="onepos-empty-title">No saved reports yet.</span></div>}
      </div>

      {/* Report authoring (fields, filters, grouping, sorting) is the report
          schema builder, so it stays a desktop workflow — phones get the list
          and can still open/run any saved report (task §Mobile rule). */}
      <div className="onepos-card onepos-card-body md:hidden">
        <p className="text-sm text-slate-500">
          Creating and editing report definitions is available on a larger screen. You can still open and run any saved report above.
        </p>
      </div>

      <div className="onepos-card onepos-card-body space-y-5 hidden md:block">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{editingId ? "Edit report" : "Create report"}</h2>
          <span className="text-xs text-slate-400">Data source: {definition.dataSource === "platform_object" ? "Platform Object" : "Sales"}</span>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="onepos-label">Report name<input value={definition.name} onChange={(event) => updateDefinition({ name: event.target.value })} className="onepos-input mt-1" /></label>
          <label className="onepos-label">Description<input value={definition.description} onChange={(event) => updateDefinition({ description: event.target.value })} className="onepos-input mt-1" /></label>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="onepos-label">Data source
            <select value={definition.dataSource || "sales"} onChange={(event) => changeSource(event.target.value)} className="onepos-input mt-1">
              <option value="sales">Sales</option>
              {(metadata.platformObjects || []).length > 0 && <option value="platform_object">Platform Object</option>}
            </select>
          </label>
          {definition.dataSource === "platform_object" && (
            <label className="onepos-label">Object
              <select value={definition.objectId || ""} onChange={(event) => changePlatformObject(event.target.value)} className="onepos-input mt-1">
                <option value="">Select object</option>
                {(metadata.platformObjects || []).map((object) => <option key={object.id} value={object.id}>{object.label || object.object_key}</option>)}
              </select>
            </label>
          )}
        </div>
        <fieldset>
          <legend className="text-sm font-medium mb-2">Fields</legend>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {availableFields.map((field) => (
              <label key={field.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={definition.fields.includes(field.key)} onChange={() => toggleField(field.key)} />{field.label}</label>
            ))}
          </div>
        </fieldset>
        {selectedFields.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Selected column order</div>
            {selectedFields.map((field, index) => (
              <div key={field.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{field.label}</span>
                <button type="button" disabled={index === 0} onClick={() => {
                  const next = [...definition.fields];
                  const fieldIndex = next.indexOf(field.key);
                  [next[fieldIndex - 1], next[fieldIndex]] = [next[fieldIndex], next[fieldIndex - 1]];
                  updateDefinition({ fields: next });
                }}>Move up</button>
                <button type="button" disabled={index === selectedFields.length - 1} onClick={() => {
                  const next = [...definition.fields];
                  const fieldIndex = next.indexOf(field.key);
                  [next[fieldIndex], next[fieldIndex + 1]] = [next[fieldIndex + 1], next[fieldIndex]];
                  updateDefinition({ fields: next });
                }}>Move down</button>
              </div>
            ))}
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-4">
          {definition.dataSource === "sales" && definition.filters.map((filter, index) => (
            <label key={`${filter.field}-${index}`} className="text-sm">{index === 0 ? "Date filter" : "Filter"}
              <select value={filter.operator} onChange={(event) => setFilter(index, { operator: event.target.value })} className="onepos-input mt-1">
                {(metadata.filters.length ? metadata.filters : [{ key: "this_week", label: "This week" }]).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
              </select>
              {filter.operator === "custom" && (
                <span className="flex gap-2 mt-2">
                  <input type="date" value={filter.from || ""} onChange={(event) => setFilter(index, { from: event.target.value })} className="onepos-input" />
                  <input type="date" value={filter.to || ""} onChange={(event) => setFilter(index, { to: event.target.value })} className="onepos-input" />
                </span>
              )}
            </label>
          ))}
          <label className="onepos-label">Group by<select value={definition.groupBy?.[0] || ""} onChange={(event) => setGroupBy(event.target.value)} className="onepos-input mt-1"><option value="">No grouping</option>{selectedFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
          <label className="onepos-label">Sort<select value={definition.sort?.[0]?.field || ""} onChange={(event) => setSort(event.target.value, definition.sort?.[0]?.direction || "desc")} className="onepos-input mt-1"><option value="">Default order</option>{selectedFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
          <label className="onepos-label">Direction<select value={definition.sort?.[0]?.direction || "desc"} onChange={(event) => setSort(definition.sort?.[0]?.field || "date", event.target.value)} className="onepos-input mt-1"><option value="desc">Descending</option><option value="asc">Ascending</option></select></label>
        </div>
        {definition.dataSource === "platform_object" && (
          <fieldset className="space-y-3">
            <div className="flex items-center justify-between">
              <legend className="text-sm font-medium">Filters</legend>
              <select value={definition.filterLogic || "all"} onChange={(event) => updateDefinition({ filterLogic: event.target.value })} className="onepos-input w-auto">
                <option value="all">Match all</option>
                <option value="any">Match any</option>
              </select>
            </div>
            {(definition.filters || []).map((filter, index) => {
              const field = availableFields.find((item) => item.key === filter.field);
              const type = String(field?.type || field?.field_type || "text").toLowerCase();
              const operators = ["number", "decimal", "currency"].includes(type)
                ? [["equals", "Equals"], ["not_equals", "Not equals"], ["gt", "Greater than"], ["gte", "Greater/equal"], ["lt", "Less than"], ["lte", "Less/equal"], ["between", "Between"]]
                : ["date", "datetime"].includes(type)
                  ? [["equals", "Equals"], ["gt", "After"], ["lt", "Before"], ["between", "Between"]]
                  : type === "boolean"
                    ? [["equals", "True/false"]]
                    : [["equals", "Equals"], ["not_equals", "Not equals"], ["contains", "Contains"], ["starts_with", "Starts with"], ["is_blank", "Blank"], ["is_not_blank", "Not blank"], ["in", "In"]];
              return <div key={`${filter.field}-${index}`} className="grid md:grid-cols-4 gap-2 items-end">
                <select value={filter.field || ""} onChange={(event) => setFilter(index, { field: event.target.value, operator: "equals", value: "" })} className="onepos-input">
                  <option value="">Select field</option>
                  {availableFields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
                <select value={filter.operator || "equals"} onChange={(event) => setFilter(index, { operator: event.target.value })} className="onepos-input">
                  {operators.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                {!["is_blank", "is_not_blank"].includes(filter.operator) && <input type={["date", "datetime"].includes(type) ? "date" : "text"} value={filter.value ?? ""} onChange={(event) => setFilter(index, { value: event.target.value })} className="onepos-input" placeholder={filter.operator === "between" ? "Use comma-separated from,to" : "Value"} />}
                <button type="button" onClick={() => updateDefinition({ filters: definition.filters.filter((_, itemIndex) => itemIndex !== index) })} className="text-sm text-red-700">Remove</button>
              </div>;
            })}
            <button type="button" onClick={() => updateDefinition({ filters: [...(definition.filters || []), { field: availableFields[0]?.key || "", operator: "equals", value: "" }] })} className="onepos-btn onepos-btn-sm onepos-btn-secondary">Add filter</button>
          </fieldset>
        )}
        {definition.dataSource === "platform_object" && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Summaries</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={running === "preview"} onClick={preview} className="onepos-btn onepos-btn-secondary">{running === "preview" ? "Previewing..." : "Preview"}</button>
              {["COUNT", "SUM", "AVG", "MIN", "MAX"].map((aggregate) => (
                <button type="button" key={aggregate} className="onepos-btn onepos-btn-sm onepos-btn-secondary" onClick={() => updateDefinition({ summaries: [...(definition.summaries || []), { aggregate, field: selectedFields[0]?.key || "" }] })}>{aggregate}</button>
              ))}
            </div>
            {(definition.summaries || []).map((summary, index) => (
              <div key={`${summary.aggregate}-${index}`} className="flex gap-2 items-center">
                <select value={summary.aggregate} onChange={(event) => updateDefinition({ summaries: definition.summaries.map((item, itemIndex) => itemIndex === index ? { ...item, aggregate: event.target.value } : item) })} className="onepos-input">
                  {["COUNT", "SUM", "AVG", "MIN", "MAX"].map((aggregate) => <option key={aggregate}>{aggregate}</option>)}
                </select>
                <select value={summary.field} onChange={(event) => updateDefinition({ summaries: definition.summaries.map((item, itemIndex) => itemIndex === index ? { ...item, field: event.target.value } : item) })} className="onepos-input">
                  {selectedFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                </select>
                <button type="button" onClick={() => updateDefinition({ summaries: definition.summaries.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
              </div>
            ))}
          </div>
        )}
        {metadata.canManage && metadata.users.length > 0 && editingId && (
          <label className="text-sm block">Assign to users<select multiple value={definition.userIds || []} onChange={(event) => updateDefinition({ userIds: [...event.target.selectedOptions].map((option) => option.value) })} className="onepos-input mt-1 min-h-24">{metadata.users.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.username}</option>)}</select></label>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={saving} onClick={() => save(false)} className="onepos-btn onepos-btn-primary">{saving ? "Saving..." : "Save"}</button>
          <button type="button" disabled={saving} onClick={() => save(true)} className="px-4 py-2 border rounded text-sm">Save & Run</button>
        </div>
      </div>

      {results && (() => {
        const columns = (results.columns || definition.fields).map((column) => typeof column === "string" ? { key: column, label: fieldLabel(availableFields, column) } : column);
        return <div className="space-y-4"><div className="onepos-card onepos-card-body"><h2 className="onepos-section-title">{definition.name}</h2><p className="text-xs text-slate-500 mt-1">Generated from the current database at run time.</p></div><ReportTable title="Results" headers={columns.map((column) => column.label)} rows={(results.rows || []).map((row) => columns.map((column) => row[column.key] ?? ""))} exportName="custom-report" /></div>;
      })()}
      <div className="text-xs text-slate-400">Date ranges are evaluated by the server using the company timezone. Today is {today()}.</div>
    </div>
  );
}
