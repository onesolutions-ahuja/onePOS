import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import { getCustomReports } from "../../services/customReports.js";

const empty = { name: "", description: "", components: [], filters: [] };
export default function DashboardBuilder() {
  const [dashboards, setDashboards] = useState([]);
  const [current, setCurrent] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState("");
  const [reports, setReports] = useState([]);
  const load = async () => { const r = await apiRequest("/api/dashboards"); if (r.success) setDashboards(r.data || []); else setError(r.message); };
  useEffect(() => {
    load();
    getCustomReports().then((response) => setReports(response.data || [])).catch(() => setReports([]));
  }, []);
  const save = async () => {
    const value = current || empty;
    if (!value.name.trim()) return setError("Dashboard name is required");
    const r = await apiRequest(current?.id ? `/api/dashboards/${current.id}` : "/api/dashboards", { method: current?.id ? "PUT" : "POST", body: JSON.stringify(value) });
    if (!r.success) return setError(r.message); setCurrent(r.data); load();
  };
  const run = async () => { if (!current?.id) return; const r = await apiRequest(`/api/dashboards/${current.id}/run`, { method: "POST" }); setRuntime(r.data); };
  const add = (type) => setCurrent((d) => ({ ...(d || empty), components: [...(d?.components || []), { id: crypto.randomUUID(), type, title: type.toUpperCase(), config: type === "text" ? { content: "Add text" } : { reportId: "" }, layout: { x: 0, y: 0, w: 4, h: 3 } }] }));
  return <div>
    <div className="flex justify-between items-center mb-5"><div><h1 className="text-2xl font-bold">Dashboard Builder</h1><p className="text-sm text-slate-500">Compose dashboards from saved custom reports.</p></div><button className="px-3 py-2 bg-blue-600 text-white rounded-lg" onClick={() => setCurrent(empty)}>New dashboard</button></div>
    {!current ? <div className="grid gap-3">{dashboards.map((d) => <div key={d.id} className="bg-white border rounded-xl p-4 flex justify-between"><div><b>{d.name}</b><p className="text-sm text-slate-500">{d.description}</p></div><button className="text-blue-600" onClick={() => setCurrent(d)}>Open</button></div>)}{!dashboards.length && <div className="bg-white border rounded-xl p-8 text-slate-500">No dashboards yet.</div>}</div> :
      <div className="bg-white border rounded-xl p-5"><input className="border rounded-lg p-2 w-full mb-3" placeholder="Dashboard name" value={current.name} onChange={(e) => setCurrent({ ...current, name: e.target.value })} /><textarea className="border rounded-lg p-2 w-full mb-4" placeholder="Description" value={current.description || ""} onChange={(e) => setCurrent({ ...current, description: e.target.value })} /><div className="flex gap-2 mb-4">{["kpi", "chart", "table", "text"].map((type) => <button key={type} className="px-3 py-2 border rounded-lg" onClick={() => add(type)}>+ {type}</button>)}</div>{current.components.map((c, i) => <div className="border rounded-lg p-3 mb-2" key={c.id}><div className="flex items-center gap-2"><b className="capitalize">{c.type}</b><input className="border rounded p-1 flex-1" placeholder="Component title" value={c.title || ""} onChange={(e) => { const components = [...current.components]; components[i] = { ...c, title: e.target.value }; setCurrent({ ...current, components }); }} />{i > 0 && <button className="text-sm" onClick={() => { const components = [...current.components]; [components[i - 1], components[i]] = [components[i], components[i - 1]]; setCurrent({ ...current, components }); }}>Move up</button>}{i < current.components.length - 1 && <button className="text-sm" onClick={() => { const components = [...current.components]; [components[i], components[i + 1]] = [components[i + 1], components[i]]; setCurrent({ ...current, components }); }}>Move down</button>}</div>{c.type !== "text" && <select className="border rounded p-1 mt-2 w-full" value={c.config.reportId || ""} onChange={(e) => { const components = [...current.components]; components[i] = { ...c, config: { ...c.config, reportId: e.target.value } }; setCurrent({ ...current, components }); }}><option value="">Select a saved report</option>{reports.map((report) => <option key={report.id} value={report.id}>{report.name}</option>)}</select>}{c.type === "text" && <textarea className="border rounded p-1 mt-2 w-full" value={c.config.content || ""} onChange={(e) => { const components = [...current.components]; components[i] = { ...c, config: { ...c.config, content: e.target.value } }; setCurrent({ ...current, components }); }} />}</div>)}<div className="flex gap-2 mt-4"><button className="px-4 py-2 bg-blue-600 text-white rounded-lg" onClick={save}>Save</button><button className="px-4 py-2 border rounded-lg" onClick={run}>Preview</button><button className="px-4 py-2 border rounded-lg" onClick={() => setCurrent(null)}>Back</button></div>{runtime?.components?.map((c) => <div className="mt-3 p-3 bg-slate-50 rounded" key={c.id}>{c.error || c.data?.content || `${c.data?.rows?.length || 0} rows loaded`}</div>)}</div>}
    {error && <div className="text-red-600 mt-3">{error}</div>}
  </div>;
}
