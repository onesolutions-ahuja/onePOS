import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../services/api.js";
import ObjectPage from "./ObjectPage.jsx";

const inputClass = "w-full rounded border border-slate-300 px-3 py-2 text-sm";
const emptyReport = { label: "", description: "", config: { fields: [], filters: [], sort: [], groupBy: "", metrics: [{ type: "count" }] } };

function fieldName(field) { return field.api_name || field.apiName; }
function fieldLabel(field) { return field.label || fieldName(field); }

function ReportBuilder({ onMessage, onError }) {
  const [objects, setObjects] = useState([]);
  const [object, setObject] = useState(null);
  const [fields, setFields] = useState([]);
  const [reports, setReports] = useState([]);
  const [form, setForm] = useState(emptyReport);
  const [running, setRunning] = useState(null);

  const loadObjects = async () => {
    try {
      const response = await apiRequest("/api/platform/objects");
      setObjects(response.data || []);
    } catch (error) { onError(error.message); }
  };
  const loadObject = async (nextObject) => {
    setObject(nextObject);
    if (!nextObject) return;
    try {
      const [metadata, reportResponse] = await Promise.all([
        apiRequest(`/api/platform/objects/${nextObject.id}`),
        apiRequest(`/api/platform/objects/${encodeURIComponent(nextObject.object_key)}/reports?includeInactive=true`),
      ]);
      setFields((metadata.data?.fields || []).filter((field) => field.active !== false && field.readable !== false));
      setReports(reportResponse.data || []);
    } catch (error) { onError(error.message); }
  };
  useEffect(() => { loadObjects(); }, []);
  const updateConfig = (patch) => setForm((current) => ({ ...current, config: { ...current.config, ...patch } }));
  const editReport = (report) => setForm({ ...report, config: { ...emptyReport.config, ...(report.config || {}) } });
  const save = async () => {
    if (!object || !form.label.trim()) return onError("Select an object and enter a report name.");
    try {
      const payload = { label: form.label, description: form.description, config: form.config };
      if (form.id) await apiRequest(`/api/platform/reports/${form.id}`, { method: "PUT", body: JSON.stringify(payload) });
      else await apiRequest(`/api/platform/objects/${encodeURIComponent(object.object_key)}/reports`, { method: "POST", body: JSON.stringify(payload) });
      onMessage("Platform report saved."); setForm(emptyReport); await loadObject(object);
    } catch (error) { onError(error.message); }
  };
  const run = async (report) => {
    try {
      const response = await apiRequest(`/api/platform/objects/${encodeURIComponent(object.object_key)}/reports/${encodeURIComponent(report.report_key)}`);
      setRunning(response.data);
    } catch (error) { onError(error.message); }
  };
  const remove = async (report) => {
    try { await apiRequest(`/api/platform/reports/${report.id}`, { method: "DELETE" }); onMessage("Platform report deactivated."); await loadObject(object); }
    catch (error) { onError(error.message); }
  };
  return <div className="grid lg:grid-cols-[220px_1fr] gap-4">
    <section className="bg-white border rounded-xl p-4"><h3 className="font-semibold mb-3">Platform objects</h3>{objects.map((item) =>
      <button key={item.id} type="button" onClick={() => loadObject(item)} className={`block w-full text-left px-3 py-2 rounded text-sm ${object?.id === item.id ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50"}`}>{item.label}</button>)}</section>
    <section className="space-y-4">
      <div className="bg-white border rounded-xl p-4"><div className="flex justify-between items-center"><h3 className="font-semibold">{object ? `${object.label} reports` : "Select a Platform object"}</h3>{object && <button type="button" onClick={() => setForm(emptyReport)} className="text-sm text-blue-700">New report</button>}</div>
        {object && reports.map((report) => <div key={report.id} className="flex items-center justify-between border-t py-3 text-sm"><span><b>{report.label}</b><span className="block text-slate-500">{report.description || "No description"}{report.active === false ? " · inactive" : ""}</span></span><span className="flex gap-2">{report.active !== false && <button type="button" onClick={() => run(report)} className="text-blue-700">Run</button>}<button type="button" onClick={() => editReport(report)} className="text-slate-700">Edit</button><button type="button" onClick={() => report.active === false ? apiRequest(`/api/platform/reports/${report.id}`, { method: "PUT", body: JSON.stringify({ active: true }) }).then(() => loadObject(object)) : remove(report)} className="text-red-700">{report.active === false ? "Activate" : "Deactivate"}</button></span></div>)}</div>
      {object && <div className="bg-white border rounded-xl p-4 space-y-4"><h3 className="font-semibold">{form.id ? "Edit report" : "Create report"}</h3><input className={inputClass} placeholder="Report name" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /><textarea className={inputClass} placeholder="Description" value={form.description || ""} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        <div><p className="text-sm font-medium mb-2">Permitted fields</p><div className="grid sm:grid-cols-2 gap-2">{fields.map((field) => <label key={fieldName(field)} className="text-sm flex gap-2"><input type="checkbox" checked={form.config.fields.includes(fieldName(field))} onChange={(event) => updateConfig({ fields: event.target.checked ? [...form.config.fields, fieldName(field)] : form.config.fields.filter((name) => name !== fieldName(field)) })} />{fieldLabel(field)}</label>)}</div></div>
        <div className="grid md:grid-cols-3 gap-3"><label className="text-sm">Group by<select className={inputClass} value={form.config.groupBy || ""} onChange={(event) => updateConfig({ groupBy: event.target.value || null })}><option value="">No grouping</option>{fields.map((field) => <option key={fieldName(field)} value={fieldName(field)}>{fieldLabel(field)}</option>)}</select></label><label className="text-sm">Sort field<select className={inputClass} value={form.config.sort[0]?.field || ""} onChange={(event) => updateConfig({ sort: event.target.value ? [{ field: event.target.value, direction: form.config.sort[0]?.direction || "asc" }] : [] })}><option value="">No sort</option>{fields.map((field) => <option key={fieldName(field)} value={fieldName(field)}>{fieldLabel(field)}</option>)}</select></label><label className="text-sm">Direction<select className={inputClass} value={form.config.sort[0]?.direction || "asc"} onChange={(event) => updateConfig({ sort: form.config.sort[0]?.field ? [{ ...form.config.sort[0], direction: event.target.value }] : [] })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label></div>
        <div className="grid md:grid-cols-3 gap-3"><label className="text-sm">Filter field<select className={inputClass} value={form.config.filters[0]?.field || ""} onChange={(event) => updateConfig({ filters: event.target.value ? [{ field: event.target.value, operator: form.config.filters[0]?.operator || "eq", value: form.config.filters[0]?.value || "" }] : [] })}><option value="">No filter</option>{fields.map((field) => <option key={fieldName(field)} value={fieldName(field)}>{fieldLabel(field)}</option>)}</select></label><label className="text-sm">Filter operator<select className={inputClass} value={form.config.filters[0]?.operator || "eq"} onChange={(event) => updateConfig({ filters: form.config.filters[0]?.field ? [{ ...form.config.filters[0], operator: event.target.value }] : [] })}><option value="eq">Equals</option><option value="neq">Not equal</option><option value="contains">Contains</option><option value="gt">Greater than</option><option value="gte">At least</option><option value="lt">Less than</option><option value="lte">At most</option><option value="is_null">Is empty</option></select></label><label className="text-sm">Filter value<input className={inputClass} value={form.config.filters[0]?.value || ""} onChange={(event) => updateConfig({ filters: form.config.filters[0]?.field ? [{ ...form.config.filters[0], value: event.target.value }] : [] })} /></label></div>
        <label className="text-sm block max-w-xs">Aggregate<select className={inputClass} value={form.config.metrics[0]?.type || "count"} onChange={(event) => updateConfig({ metrics: [{ type: event.target.value, field: form.config.metrics[0]?.field || form.config.groupBy || null }] })}><option value="count">Count</option><option value="sum">Sum</option><option value="avg">Average</option><option value="min">Minimum</option><option value="max">Maximum</option></select></label>
        <div className="flex gap-2"><button type="button" onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Save report</button>{form.id && <button type="button" onClick={() => setForm(emptyReport)} className="px-4 py-2 border rounded text-sm">Cancel</button>}</div>
      </div>}
      {running && <div className="bg-white border rounded-xl p-4 overflow-auto"><h3 className="font-semibold mb-3">Preview: {running.report.label}</h3><table className="w-full text-sm"><thead><tr>{Object.keys(running.rows?.[0] || {}).map((key) => <th key={key} className="text-left border-b p-2">{key}</th>)}</tr></thead><tbody>{(running.rows || []).map((row, index) => <tr key={index}>{Object.values(row).map((value, cell) => <td key={cell} className="border-b p-2">{String(value ?? "—")}</td>)}</tr>)}</tbody></table></div>}
    </section>
  </div>;
}

function AppBuilder({ onMessage, onError }) {
  const [apps, setApps] = useState([]);
  const [app, setApp] = useState(null);
  const [pages, setPages] = useState([]);
  const [objects, setObjects] = useState([]);
  const [pageForm, setPageForm] = useState({ label: "", pageType: "object", definition: {} });
  const [references, setReferences] = useState({ listViews: [], reports: [] });
  const [runtime, setRuntime] = useState(null);
  const load = async () => { try { const [appsResponse, objectsResponse] = await Promise.all([apiRequest("/api/platform/apps"), apiRequest("/api/platform/objects")]); setApps(appsResponse.data || []); setObjects(objectsResponse.data || []); } catch (error) { onError(error.message); } };
  const open = async (nextApp) => { try { const response = await apiRequest(`/api/platform/apps/${nextApp.id}`); const order = response.data.config?.pageOrder || []; const loadedPages = response.data.pages || []; loadedPages.sort((left, right) => (order.indexOf(left.id) < 0 ? 999 : order.indexOf(left.id)) - (order.indexOf(right.id) < 0 ? 999 : order.indexOf(right.id))); setApp(response.data); setPages(loadedPages); } catch (error) { onError(error.message); } };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!pageForm.definition.objectKey) return;
    const selected = objects.find((item) => item.object_key === pageForm.definition.objectKey);
    if (!selected) return;
    Promise.all([
      apiRequest(`/api/platform/objects/${selected.id}/list-views`),
      apiRequest(`/api/platform/objects/${encodeURIComponent(selected.object_key)}/reports`),
    ]).then(([listViews, reports]) => setReferences({ listViews: listViews.data || [], reports: reports.data || [] })).catch((error) => onError(error.message));
  }, [pageForm.definition.objectKey, objects]);
  const saveApp = async () => { try { const payload = { label: app?.label || "New app", description: app?.description || "", active: app?.active !== false, config: { ...(app?.config || {}), pageOrder: pages.map((page) => page.id) } }; const response = app?.id ? await apiRequest(`/api/platform/apps/${app.id}`, { method: "PUT", body: JSON.stringify(payload) }) : await apiRequest("/api/platform/apps", { method: "POST", body: JSON.stringify(payload) }); setApp({ ...response.data, pages: pages || [] }); onMessage("Platform app saved."); await load(); } catch (error) { onError(error.message); } };
  const toggleApp = async () => { try { const nextActive = app.active === false; const response = await apiRequest(`/api/platform/apps/${app.id}`, { method: "PUT", body: JSON.stringify({ active: nextActive, config: { ...(app.config || {}), pageOrder: pages.map((page) => page.id) } }) }); setApp({ ...app, ...response.data }); onMessage(nextActive ? "Platform app activated." : "Platform app deactivated."); await load(); } catch (error) { onError(error.message); } };
  const addPage = async () => { if (!app?.id || !pageForm.label.trim()) return onError("Save the app and enter a page label first."); try { const definition = pageForm.pageType === "object" ? { objectKey: pageForm.definition.objectKey } : pageForm.definition; const response = await apiRequest(`/api/platform/apps/${app.id}/pages`, { method: "POST", body: JSON.stringify({ label: pageForm.label, pageType: pageForm.pageType, definition }) }); setPages([...pages, response.data]); setPageForm({ label: "", pageType: "object", definition: {} }); } catch (error) { onError(error.message); } };
  const removePage = async (page) => { try { await apiRequest(`/api/platform/pages/${page.id}`, { method: "DELETE" }); setPages(pages.filter((item) => item.id !== page.id)); } catch (error) { onError(error.message); } };
  return <div className="grid lg:grid-cols-[220px_1fr] gap-4">
    <section className="bg-white border rounded-xl p-4"><div className="flex justify-between mb-3"><h3 className="font-semibold">Apps</h3><button type="button" onClick={() => { setApp({ label: "", description: "", config: {} }); setPages([]); }} className="text-blue-700 text-sm">New</button></div>{apps.map((item) => <button key={item.id} type="button" onClick={() => open(item)} className={`block w-full text-left px-3 py-2 rounded text-sm ${app?.id === item.id ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50"}`}>{item.label}</button>)}</section>
    <section className="bg-white border rounded-xl p-4 space-y-4">{app ? <><input className={inputClass} placeholder="App name" value={app.label || ""} onChange={(event) => setApp({ ...app, label: event.target.value })} /><textarea className={inputClass} placeholder="Description" value={app.description || ""} onChange={(event) => setApp({ ...app, description: event.target.value })} /><div className="flex gap-2"><button type="button" onClick={saveApp} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Save app</button>{app.id && <button type="button" onClick={toggleApp} className="px-4 py-2 border rounded text-sm">{app.active === false ? "Activate" : "Deactivate"}</button>}{app.id && <button type="button" onClick={() => setRuntime(app)} className="px-4 py-2 border rounded text-sm">Open app</button>}{app.id && <button type="button" onClick={async () => { await apiRequest(`/api/platform/apps/${app.id}`, { method: "DELETE" }); setApp(null); setPages([]); await load(); }} className="px-4 py-2 border rounded text-sm text-red-700">Delete</button>}</div><h3 className="font-semibold border-t pt-4">Navigation pages</h3>{pages.map((page, index) => <div key={page.id} className="flex justify-between items-center border rounded p-3 text-sm"><span>{page.label} <span className="text-slate-400">({page.page_type})</span></span><span className="flex gap-2"><button type="button" disabled={index === 0} onClick={() => { const next = [...pages]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setPages(next); }} className="text-slate-600">↑</button><button type="button" disabled={index === pages.length - 1} onClick={() => { const next = [...pages]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; setPages(next); }} className="text-slate-600">↓</button><button type="button" onClick={() => removePage(page)} className="text-red-700">Delete</button></span></div>)}<div className="grid md:grid-cols-3 gap-2"><input className={inputClass} placeholder="Navigation label" value={pageForm.label} onChange={(event) => setPageForm({ ...pageForm, label: event.target.value })} /><select className={inputClass} value={pageForm.pageType} onChange={(event) => setPageForm({ ...pageForm, pageType: event.target.value, definition: {} })}><option value="object">Platform Object</option><option value="list_view">List View</option><option value="report">Report</option></select><select className={inputClass} value={pageForm.definition.objectKey || ""} onChange={(event) => setPageForm({ ...pageForm, definition: { ...pageForm.definition, objectKey: event.target.value, referenceId: "" } })}><option value="">Select object</option>{objects.map((item) => <option key={item.id} value={item.object_key}>{item.label}</option>)}</select>{pageForm.pageType !== "object" && <select className={inputClass} value={pageForm.definition.referenceId || ""} onChange={(event) => setPageForm({ ...pageForm, definition: { ...pageForm.definition, referenceId: event.target.value, ...(pageForm.pageType === "report" ? { reportKey: references.reports.find((item) => item.id === event.target.value)?.report_key } : {}) } })}><option value="">Select {pageForm.pageType === "report" ? "report" : "list view"}</option>{(pageForm.pageType === "report" ? references.reports : references.listViews).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>}</div><button type="button" onClick={addPage} className="px-4 py-2 border rounded text-sm">Add navigation item</button></> : <p className="text-slate-500">Select an app or create a new one.</p>}</section>
    {runtime && <RuntimeApp app={runtime} pages={pages} onClose={() => setRuntime(null)} />}
  </div>;
}

function RuntimeApp({ app, pages, onClose }) {
  const [page, setPage] = useState(pages[0] || null);
  if (!page) return <div className="fixed inset-0 bg-white z-20 p-8"><button type="button" onClick={onClose}>Close</button><p className="mt-4">This app has no active pages.</p></div>;
  const definition = page.definition || {};
  return <div className="fixed inset-0 bg-slate-50 z-20 overflow-auto p-6"><div className="max-w-6xl mx-auto"><div className="flex justify-between items-center mb-4"><div><h2 className="text-2xl font-bold">{app.label}</h2><p className="text-slate-500">{app.description}</p></div><button type="button" onClick={onClose} className="border rounded px-3 py-2">Close</button></div><nav className="flex gap-2 mb-5">{pages.map((item) => <button type="button" key={item.id} onClick={() => setPage(item)} className={`px-3 py-2 rounded text-sm ${item.id === page.id ? "bg-blue-600 text-white" : "bg-white border"}`}>{item.label}</button>)}</nav>{page.page_type === "object" || page.page_type === "list_view" ? <ObjectPage objectKey={definition.objectKey} /> : <RuntimeReport objectKey={definition.objectKey} reportKey={definition.reportKey} />}</div></div>;
}

function RuntimeReport({ objectKey, reportKey }) {
  const [state, setState] = useState({ loading: true, rows: [], error: "" });
  useEffect(() => { apiRequest(`/api/platform/objects/${encodeURIComponent(objectKey)}/reports/${encodeURIComponent(reportKey)}`).then((response) => setState({ loading: false, rows: response.data?.rows || [], error: "" })).catch((error) => setState({ loading: false, rows: [], error: error.message })); }, [objectKey, reportKey]);
  if (state.loading) return <div className="bg-white border rounded-xl p-6">Loading report...</div>;
  if (state.error) return <div className="bg-white border rounded-xl p-6 text-red-700">{state.error}</div>;
  return <div className="bg-white border rounded-xl p-6 overflow-auto"><table className="w-full text-sm"><tbody>{state.rows.map((row, index) => <tr key={index}>{Object.values(row).map((value, cell) => <td key={cell} className="border-b p-2">{String(value ?? "—")}</td>)}</tr>)}</tbody></table></div>;
}

export default function PlatformStudio({ onMessage, onError }) {
  const [tab, setTab] = useState("reports");
  return <div className="space-y-4"><div className="flex gap-2 border-b">{[["reports", "Platform Reports"], ["apps", "Platform Apps"]].map(([key, label]) => <button type="button" key={key} onClick={() => setTab(key)} className={`px-3 py-2 text-sm ${tab === key ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500"}`}>{label}</button>)}</div>{tab === "reports" ? <ReportBuilder onMessage={onMessage} onError={onError} /> : <AppBuilder onMessage={onMessage} onError={onError} />}</div>;
}
