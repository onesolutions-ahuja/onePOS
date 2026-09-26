import MetadataResourcePicker from "./MetadataResourcePicker.jsx";
import { useEffect, useMemo, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "../../../services/api.js";
import {
  componentByKey,
  componentCategoryLabel,
  componentIcon,
  paletteComponents,
  useComponentRegistry,
} from "./componentRegistry.js";

const uid = (prefix = "cmp") => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
const fresh = () => ({
  device: "desktop",
  presentation_mode: "landing",
  sections: [{ id: "section-1", label: "Main", order: 0, columns: 1, visible: true }],
  components: [],
});
const WIDTHS = ["full", "1/2", "1/3", "2/3", "1/4"];
const PRESENTATION_MODES = [
  { key: "landing", label: "Landing / Full Screen" },
  { key: "overlay_rectangle", label: "Rectangle Overlay" },
  { key: "overlay_square", label: "Square / Compact Overlay" },
];
const spanClass = { full: "col-span-full", "1/2": "md:col-span-1", "1/3": "md:col-span-1", "2/3": "md:col-span-2", "1/4": "md:col-span-1" };

function normalizeDefinition(definition) {
  const source = definition && typeof definition === "object" ? definition : {};
  if (Array.isArray(source.sections) && Array.isArray(source.components)) {
    return { device: source.device || "desktop", presentation_mode: source.presentation_mode || "landing", sections: source.sections, components: source.components };
  }
  const legacy = source.builder;
  if (legacy?.regions) {
    return {
      device: legacy.device || "desktop",
      presentation_mode: source.presentation_mode || "landing",
      sections: legacy.regions.map((r, i) => ({ id: r.id || `section-${i + 1}`, label: r.label || "Section", order: i, columns: Number(r.columns) || 1, visible: r.visible !== false })),
      components: legacy.regions.flatMap((r) => (r.components || []).map((c) => ({ ...c, section_id: r.id }))),
    };
  }
  return fresh();
}

export default function PageBuilder({ onMessage, onError }) {
  const [apps, setApps] = useState([]), [appId, setAppId] = useState(""), [pages, setPages] = useState([]), [page, setPage] = useState(null);
  const [definition, setDefinition] = useState(fresh());
  const registry = useComponentRegistry();
  const [selected, setSelected] = useState(""), [preview, setPreview] = useState(false);

  useEffect(() => { apiRequest("/api/platform/apps").then((r) => setApps(r.data || [])).catch((e) => onError?.(e.message)); }, []);
  useEffect(() => { if (!appId) return setPages([]); apiRequest(`/api/platform/apps/${appId}/pages`).then((r) => setPages(r.data || [])).catch((e) => onError?.(e.message)); }, [appId]);

  /* Palette = the ONE shared registry view, ready-to-place components only. */
  const palette = useMemo(() => paletteComponents(registry).filter((c) => c.category !== "layout" || !"section|container|multi_container".split("|").includes(c.key)), [registry]);
  const current = definition.components.find((c) => c.id === selected);
  const selectPage = (next) => { setPage(next); setDefinition(normalizeDefinition(next?.definition)); setSelected(""); };
  const patch = (fn) => setDefinition((value) => fn(value));
  const addSection = () => patch((d) => ({ ...d, sections: [...d.sections, { id: uid("section"), label: `Section ${d.sections.length + 1}`, order: d.sections.length, columns: 1, visible: true }] }));
  const addComponent = (sectionId, componentKey) => {
    const meta = componentByKey(registry, componentKey) || { key: componentKey, label: componentKey };
    const id = uid(componentKey);
    patch((d) => ({ ...d, components: [...d.components, { id, component_key: meta.key, type: meta.kind || meta.category, label: meta.label, section_id: sectionId, order: d.components.length, width: "full", visible: true, props: {} }] }));
    setSelected(id);
  };
  const updateComponent = (changes) => patch((d) => ({ ...d, components: d.components.map((c) => c.id === selected ? { ...c, ...changes, props: { ...c.props, ...(changes.props || {}) } } : c) }));
  const removeComponent = () => { patch((d) => ({ ...d, components: d.components.filter((c) => c.id !== selected) })); setSelected(""); };
  const reorder = (sourceId, targetId, sectionId) => patch((d) => {
    const next = [...d.components];
    const from = next.findIndex((c) => c.id === sourceId), to = targetId ? next.findIndex((c) => c.id === targetId) : next.length;
    if (from < 0) return d;
    const [moved] = next.splice(from, 1);
    const insertAt = Math.max(0, to > from ? to - 1 : to);
    next.splice(targetId ? insertAt : next.length, 0, { ...moved, section_id: sectionId });
    return { ...d, components: next.map((c, order) => ({ ...c, order })) };
  });
  const save = async () => {
    if (!page) return;
    try {
      const next = { ...(page.definition || {}), ...definition };
      delete next.builder;
      const result = await apiRequest(`/api/platform/pages/${page.id}`, { method: "PUT", body: JSON.stringify({ definition: next }) });
      setPage(result.data); setPages((items) => items.map((p) => p.id === result.data.id ? result.data : p)); onMessage?.("Page layout saved.");
    } catch (error) { onError?.(error.message); }
  };

  return <div className="space-y-4 min-w-0">
    <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto text-xl font-semibold">Form & Page Builder</h2>
      <select className="onepos-input w-auto" value={appId} onChange={(e) => { setAppId(e.target.value); setPage(null); }}><option value="">Select app</option>{apps.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
      <select className="onepos-input w-auto" value={page?.id || ""} onChange={(e) => selectPage(pages.find((p) => p.id === e.target.value) || null)}><option value="">Select page</option>{pages.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
      <select className="onepos-input w-auto" value={definition.presentation_mode || "landing"} onChange={(e) => patch((d) => ({ ...d, presentation_mode: e.target.value }))}>{PRESENTATION_MODES.map((mode) => <option key={mode.key} value={mode.key}>{mode.label}</option>)}</select><button className="onepos-btn onepos-btn-secondary" onClick={() => setPreview((v) => !v)}>{preview ? "Edit" : "Preview"}</button><button className="onepos-btn onepos-btn-primary" disabled={!page} title={page ? "Save the page layout" : "Select a page first"} onClick={save}>Save</button>{!page && <span className="text-xs text-slate-500 self-center">Select a page to enable Save</span>}
    </div>
    {!appId ? <div className="onepos-empty"><span className="onepos-empty-title">{apps.length ? "Select an app, then a page to compose." : "No apps available yet — create one under Apps first."}</span></div>
      : appId && !page ? <div className="onepos-empty"><span className="onepos-empty-title">{pages.length ? "Select a page to compose." : "This app has no pages yet — create one in Objects → Page Layouts / Record Pages."}</span></div>
      : <div className="grid gap-4 min-w-0 lg:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_250px]">
      {!preview && <aside className="rounded border bg-white p-3 min-w-0"><div className="mb-2 font-semibold">Components</div><div className="space-y-2">{palette.map((item) => { const Icon = componentIcon(item); return <button key={item.key} draggable title={`${item.label} — ${componentCategoryLabel(item.category)}`} onDragStart={(e) => e.dataTransfer.setData("application/x-onepos-component", item.key)} onClick={() => addComponent(definition.sections[0]?.id, item.key)} className="block w-full rounded border px-3 py-2 text-left text-sm"><span className="flex items-center gap-2"><Icon size={14} className="shrink-0 text-slate-400" aria-hidden="true" />{item.label}</span></button>; })}</div><button className="mt-3 flex items-center gap-1 text-sm" onClick={addSection}><Plus size={14}/> Add section</button></aside>}
      <main className={`rounded border bg-slate-50 p-4 min-w-0 ${definition.device === "mobile" ? "mx-auto w-full max-w-sm" : definition.device === "tablet" ? "mx-auto w-full max-w-3xl" : ""}`}>
        <div className="mb-3 flex flex-wrap gap-2">{["desktop", "tablet", "mobile"].map((x) => <button key={x} aria-pressed={definition.device === x} className={`rounded px-2 py-1 text-xs ${definition.device === x ? "bg-blue-600 text-white" : "onepos-btn onepos-btn-secondary"}`} onClick={() => patch((d) => ({ ...d, device: x }))}>{x}</button>)}</div>
        {definition.sections.map((section, sectionIndex) => {
          const items = definition.components.filter((c) => c.section_id === section.id);
          return <section key={section.id} className="mb-4 rounded border bg-white p-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const componentKey = e.dataTransfer.getData("application/x-onepos-component"); const componentId = e.dataTransfer.getData("application/x-onepos-placed"); if (componentKey) addComponent(section.id, componentKey); else if (componentId) reorder(componentId, "", section.id); }}>
            <div className="mb-3 flex flex-wrap items-center gap-2"><input className="min-w-0 flex-1 bg-transparent font-semibold" value={section.label} onChange={(e) => patch((d) => ({ ...d, sections: d.sections.map((s, i) => i === sectionIndex ? { ...s, label: e.target.value } : s) }))}/><select className="onepos-input w-auto shrink-0" value={section.columns} onChange={(e) => patch((d) => ({ ...d, sections: d.sections.map((s, i) => i === sectionIndex ? { ...s, columns: Number(e.target.value) } : s) }))}><option value="1">1 column</option><option value="2">2 columns</option><option value="3">3 columns</option></select></div>
            <div className={`grid gap-2 ${definition.device === "mobile" ? "grid-cols-1" : section.columns === 2 ? "md:grid-cols-2" : section.columns === 3 ? "md:grid-cols-3" : "grid-cols-1"}`}>{items.map((c) => <button type="button" key={c.id} draggable onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData("application/x-onepos-placed", c.id); }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const source = e.dataTransfer.getData("application/x-onepos-placed"); if (source) reorder(source, c.id, section.id); }} onClick={() => setSelected(c.id)} aria-pressed={selected === c.id} className={`min-h-16 w-full min-w-0 rounded border bg-white p-3 text-left ${spanClass[c.width] || "col-span-full"} ${selected === c.id ? "ring-2 ring-blue-500" : ""}`}><div className="flex items-center gap-2 min-w-0"><GripVertical size={14} className="shrink-0 text-slate-400"/><b className="truncate">{c.label}</b></div><div className="mt-1 text-xs text-slate-500 truncate">{c.component_key}</div></button>)}</div>
            {!items.length && <div className="py-8 text-center text-sm text-slate-400">Drag a component here, or click one in the palette to add it.</div>}
          </section>;
        })}
      </main>
      {!preview && <aside className="rounded border bg-white p-3 min-w-0 lg:col-span-2 xl:col-span-1">{current ? <div className="space-y-3"><b>Properties</b><label className="block text-xs">Label<input className="mt-1 w-full rounded border p-2" value={current.label || ""} onChange={(e) => updateComponent({ label: e.target.value })}/></label><label className="block text-xs">Width<select className="mt-1 w-full rounded border p-2" value={current.width || "full"} onChange={(e) => updateComponent({ width: e.target.value })}>{WIDTHS.map((w) => <option key={w}>{w}</option>)}</select></label><MetadataResourcePicker objectKey={page?.object_key || page?.definition?.object_key || ""} label="Record / field binding" value={current.props?.binding || ""} onChange={(binding) => updateComponent({ props: { binding } })}/><MetadataResourcePicker objectKey={page?.object_key || page?.definition?.object_key || ""} label="Visibility field" value={current.props?.visibility_path || ""} onChange={(visibility_path) => updateComponent({ props: { visibility_path } })}/><button className="flex items-center gap-1 text-sm text-red-700" onClick={removeComponent}><Trash2 size={14}/> Remove component</button></div> : <span className="text-sm text-slate-500">Select a component.</span>}</aside>}
    </div>}
  </div>;
}
