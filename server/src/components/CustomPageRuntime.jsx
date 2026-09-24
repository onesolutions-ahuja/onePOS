import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../services/api.js";
import HospitalityOperations from "../pages/hospitality/HospitalityOperations.jsx";
import KitchenDisplay from "../pages/hospitality/KitchenDisplay.jsx";

function Control({ component }) {
  const key = component.component_key;
  const label = component.label || "Field";
  const base = "onepos-control w-full";
  if (key === "checkbox") return <label className="flex items-center gap-2 text-sm"><input type="checkbox" /> {label}</label>;
  if (key === "picklist") return <label className="onepos-field"><span>{label}</span><select className={base}><option>Select…</option></select></label>;
  if (key === "long_text") return <label className="onepos-field"><span>{label}</span><textarea className={base} rows="4" /></label>;
  if (["text_input","number","currency","date","datetime","lookup"].includes(key)) {
    const type = key === "date" ? "date" : key === "datetime" ? "datetime-local" : key === "number" || key === "currency" ? "number" : "text";
    return <label className="onepos-field"><span>{label}</span><input className={base} type={type} placeholder={key === "lookup" ? "Search…" : ""}/></label>;
  }
  if (key === "button") return <button className="onepos-btn onepos-btn-primary">{label}</button>;
  if (key === "divider") return <hr className="border-slate-200"/>;
  if (key === "spacer") return <div className="h-6" aria-hidden="true"/>;
  if (key === "header") return <h2 className="text-xl font-semibold">{label}</h2>;
  return <div className="text-sm text-slate-700">{label}</div>;
}

export default function CustomPageRuntime({ pageKey, onClose }) {
  const [page, setPage] = useState(null), [error, setError] = useState("");
  useEffect(() => { let live=true; apiRequest(`/api/platform/runtime/pages/${encodeURIComponent(pageKey)}`).then(r => live && setPage(r.data)).catch(e => live && setError(e.message)); return () => { live=false; }; }, [pageKey]);
  const definition = page?.definition || {};
  const sections = useMemo(() => Array.isArray(definition.sections) ? definition.sections : [], [definition]);
  const components = Array.isArray(definition.components) ? definition.components : [];
  const mode = definition.presentation_mode || "landing";
  if (definition.runtime_component === "hospitality_operations") return <HospitalityOperations />;
  if (definition.runtime_component === "kitchen_display") return <KitchenDisplay />;
  if (error) return <div className="onepos-page-enter min-h-screen grid place-items-center"><div className="onepos-card p-6">{error}</div></div>;
  if (!page) return <div className="min-h-screen grid place-items-center text-sm text-slate-500">Loading page…</div>;
  const content = <div className="space-y-4">{sections.map(section => <section key={section.id} className="onepos-card p-5"><h3 className="mb-4 font-semibold">{section.label}</h3><div className={`grid gap-4 ${section.columns===2?'md:grid-cols-2':section.columns===3?'md:grid-cols-3':'grid-cols-1'}`}>{components.filter(c=>c.section_id===section.id && c.visible!==false).map(c=><div key={c.id} className={c.width==='full'?'col-span-full':''}><Control component={c}/></div>)}</div></section>)}</div>;
  if (mode === "landing") return <main className="onepos-page-enter min-h-screen bg-slate-100 p-6"><div className="mx-auto max-w-6xl"><header className="mb-5"><div className="text-xs text-slate-500">{page.app_label}</div><h1 className="text-2xl font-semibold">{page.label}</h1></header>{content}</div></main>;
  return <div className="onepos-overlay-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-label={page.label} className={`onepos-overlay-panel ${mode === 'overlay_square' ? 'onepos-overlay-square' : 'onepos-overlay-rectangle'}`}><header className="onepos-overlay-header"><h2 className="font-semibold">{page.label}</h2><button className="onepos-icon-button" onClick={onClose} aria-label="Close"><X size={18}/></button></header><div className="onepos-overlay-body">{content}</div></section></div>;
}
