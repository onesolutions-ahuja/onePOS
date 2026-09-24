import { useEffect, useMemo, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "../../../services/api.js";

const FIELDS = [
  ["profile", "User profile"],
  ["role_id", "Role"],
  ["store_id", "Store"],
  ["company_id", "Company"],
  ["user_id", "Specific user"],
];
const newRule = () => ({ id: `landing_${Date.now()}_${Math.random().toString(16).slice(2)}`, label: "New landing rule", active: true, conditions: [{ field: "profile", operator: "equals", value: "" }], destination: "/app/dashboard" });

export default function LandingFlowBuilder({ onMessage, onError }) {
  const [flow, setFlow] = useState({ rules: [], defaultDestination: "/app/dashboard" });
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([apiRequest("/api/settings/runtime"), apiRequest("/api/platform/pages")])
      .then(([runtime, pageResult]) => {
        if (!live) return;
        setFlow(runtime.data?.landingFlow || { rules: [], defaultDestination: "/app/dashboard" });
        setPages((pageResult.data || []).filter((p) => p.active !== false));
      })
      .catch((e) => onError?.(e.message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  const destinations = useMemo(() => [
    ["/app", "POS / Till"],
    ["/app/dashboard", "Dashboard"],
    ...pages.map((p) => [`/app/pages/${p.api_name || p.page_key || p.id}`, `Custom Page · ${p.label || p.name}`]),
  ], [pages]);
  const patchRule = (index, patch) => setFlow((f) => ({ ...f, rules: f.rules.map((r, i) => i === index ? { ...r, ...patch } : r) }));
  const patchCondition = (ri, ci, patch) => setFlow((f) => ({ ...f, rules: f.rules.map((r, i) => i !== ri ? r : ({ ...r, conditions: r.conditions.map((c, j) => j === ci ? { ...c, ...patch } : c) })) }));
  const move = (index, delta) => setFlow((f) => { const rules=[...f.rules]; const next=index+delta; if(next<0||next>=rules.length)return f; [rules[index],rules[next]]=[rules[next],rules[index]]; return {...f,rules}; });
  const save = async () => {
    setSaving(true);
    try {
      const current = await apiRequest("/api/settings/runtime");
      await apiRequest("/api/settings/runtime", { method: "PUT", body: JSON.stringify({
        companyDefault: current.data?.companyDefault || "dashboard",
        roleDefault: current.data?.roleDefault ?? null,
        appProfile: current.data?.deviceProfile || "admin",
        landingFlow: flow,
      }) });
      onMessage?.("Login / Landing Flow saved.");
    } catch (e) { onError?.(e.message); } finally { setSaving(false); }
  };
  if (loading) return <div className="onepos-card p-6 text-sm text-slate-500">Loading landing flow…</div>;
  return <div className="space-y-4 onepos-page-enter">
    <header><div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Post authentication</div><h2 className="text-2xl font-semibold">Login / Landing Flow</h2><p className="mt-1 text-sm text-slate-600">First matching rule wins. Destinations remain permission checked by the application.</p></header>
    <div className="onepos-card p-4 flex flex-wrap items-center gap-3"><span className="text-sm font-medium">Default destination</span><select className="onepos-control min-w-56" value={flow.defaultDestination || "/app/dashboard"} onChange={(e)=>setFlow({...flow,defaultDestination:e.target.value})}>{destinations.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><button className="onepos-btn onepos-btn-primary ml-auto" disabled={saving} onClick={save}>{saving?"Saving…":"Save Flow"}</button></div>
    <div className="space-y-3">{flow.rules.map((rule,ri)=><section key={rule.id || ri} className="onepos-card p-4 transition-all duration-200">
      <div className="flex items-center gap-2"><GripVertical size={17} className="text-slate-400"/><input className="onepos-control font-medium" value={rule.label || ""} onChange={(e)=>patchRule(ri,{label:e.target.value})}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rule.active!==false} onChange={(e)=>patchRule(ri,{active:e.target.checked})}/> Active</label><button className="onepos-icon-button" onClick={()=>move(ri,-1)} aria-label="Move up">↑</button><button className="onepos-icon-button" onClick={()=>move(ri,1)} aria-label="Move down">↓</button><button className="onepos-icon-button" onClick={()=>setFlow(f=>({...f,rules:f.rules.filter((_,i)=>i!==ri)}))} aria-label="Delete"><Trash2 size={17}/></button></div>
      <div className="mt-3 space-y-2">{(rule.conditions||[]).map((c,ci)=><div key={ci} className="grid gap-2 md:grid-cols-[1fr_150px_1fr_auto]"><select className="onepos-control" value={c.field} onChange={(e)=>patchCondition(ri,ci,{field:e.target.value})}>{FIELDS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><select className="onepos-control" value={c.operator||"equals"} onChange={(e)=>patchCondition(ri,ci,{operator:e.target.value})}><option value="equals">Equals</option><option value="not_equals">Does not equal</option></select><input className="onepos-control" value={c.value??""} placeholder="Value" onChange={(e)=>patchCondition(ri,ci,{value:e.target.value})}/><button className="onepos-icon-button" onClick={()=>patchRule(ri,{conditions:rule.conditions.filter((_,i)=>i!==ci)})} aria-label="Remove condition">×</button></div>)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2"><button className="onepos-btn onepos-btn-secondary" onClick={()=>patchRule(ri,{conditions:[...(rule.conditions||[]),{field:"profile",operator:"equals",value:""}]})}>+ Condition</button><span className="ml-auto text-sm text-slate-500">Open</span><select className="onepos-control min-w-56" value={rule.destination} onChange={(e)=>patchRule(ri,{destination:e.target.value})}>{destinations.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
    </section>)}</div>
    <button className="onepos-btn onepos-btn-secondary" onClick={()=>setFlow(f=>({...f,rules:[...f.rules,newRule()]}))}><Plus size={16}/> Add landing rule</button>
  </div>;
}
