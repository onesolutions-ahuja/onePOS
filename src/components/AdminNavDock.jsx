import { useEffect, useRef, useState } from "react";
import { BarChart3, LayoutGrid, Search, Store, X } from "lucide-react";
import JarvisCorner from "./jarvis/JarvisCorner.jsx";

function BarChartIcon() { return <BarChart3 size={19} className="shrink-0 text-emerald-100/80" />; }

const DOCK_PRIMARY = ["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports", "Payments", "Returns", "Suppliers", "Employees", "Order Prep"];
const SIDE_SLOTS = 6;
const MAX_QUICK_ACCESS = 11; // menu + 5 quick links | JARVES | 6 quick links
const GROUPS = [
  { title: "Operations", pages: ["Sales", "Returns", "Supplier Returns", "Order Prep", "Payments", "Open Till"] },
  { title: "Catalogue & Supply", pages: ["Products", "Global Products", "Categories", "Purchases", "Suppliers", "Inventory", "Replenishment"] },
  { title: "Business", pages: ["Customers", "Employees", "Stores", "Reports"] },
];

function LauncherPopup({ items, objectItems = [], reportItems = [], page, onNavigate, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 80); return () => clearTimeout(t); }, []);
  const available = new Set(items.map(([name]) => name));
  const q = query.trim().toLowerCase();
  const match = (name) => !q || name.toLowerCase().includes(q);
  const visibleReports = reportItems.filter((item) => !q || item.title.toLowerCase().includes(q));
  const visibleObjects = objectItems.filter(([name]) => match(name));
  return <>
    <div className="fixed inset-0 z-[1050]" onClick={onClose} aria-hidden="true" />
    <div role="menu" aria-label="Applications" className="fixed left-1/2 -translate-x-1/2 bottom-[68px] z-[1060] w-[620px] max-w-[94vw] rounded-2xl border border-white/10 shadow-2xl overflow-hidden" style={{ background: "rgba(13,52,49,0.94)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10"><Search size={16} className="text-emerald-300/70 shrink-0"/><input ref={inputRef} value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search applications and objects..." aria-label="Search applications" className="flex-1 bg-transparent outline-none text-[15px] text-emerald-50 placeholder:text-emerald-200/40"/><button onClick={onClose} aria-label="Close menu" className="p-1.5 rounded-lg text-emerald-100/70 hover:bg-white/10"><X size={16}/></button></div>
      <div className="px-3 py-3 max-h-[58vh] overflow-y-auto">
        {GROUPS.map(({title,pages}) => { const visible=pages.filter((p)=>available.has(p)&&match(p)); if(!visible.length)return null; return <div key={title} className="mb-2"><div className="text-[10px] font-bold tracking-[0.14em] uppercase text-emerald-200/50 px-2 pt-2 pb-1.5">{title}</div><div className="grid grid-cols-2 gap-1">{visible.map((name)=>{const Icon=items.find(([n])=>n===name)?.[1]; const active=page===name; return <button key={name} role="menuitem" onClick={()=>onNavigate(name)} className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left ${active?"bg-white/20 text-white":"text-emerald-50 hover:bg-white/10"}`}>{Icon&&<Icon size={19}/>}<span className="text-[15px] font-medium truncate">{name}</span></button>;})}</div></div>;})}
        {visibleReports.length>0&&<div className="mb-2"><div className="text-[10px] font-bold tracking-[0.14em] uppercase text-emerald-200/50 px-2 pt-2 pb-1.5">Reports</div><div className="grid grid-cols-2 gap-1">{visibleReports.map((item)=><button key={item.key} role="menuitem" onClick={()=>onNavigate(item.key)} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left ${page===item.key?"bg-white/20 text-white":"text-emerald-50 hover:bg-white/10"}`}><BarChartIcon/><span className="text-[15px] font-medium truncate">{item.title}</span></button>)}</div></div>}
        {visibleObjects.length>0&&<div><div className="text-[10px] font-bold tracking-[0.14em] uppercase text-emerald-200/50 px-2 pt-2 pb-1.5">Objects</div><div className="grid grid-cols-2 gap-1">{visibleObjects.map(([name,Icon])=><button key={name} role="menuitem" onClick={()=>onNavigate(name)} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left ${page===name?"bg-white/20 text-white":"text-emerald-50 hover:bg-white/10"}`}>{Icon&&<Icon size={19}/>}<span className="text-[15px] font-medium truncate">{name}</span></button>)}</div></div>}
      </div>
    </div>
  </>;
}

function DockButton({ slot, Icon, active, onClick }) { return <button onClick={onClick} aria-current={active?"page":undefined} title={slot} className={`relative w-[52px] h-[46px] shrink-0 rounded-xl grid place-items-center transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${active?"bg-white/20 text-white":"text-emerald-50/85 hover:bg-white/10 active:bg-white/15"}`}><Icon size={22}/>{active&&<span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-emerald-300"/>}</button>; }

export default function AdminNavDock({ items, objectItems=[], reportItems=[], page, onNavigate, onOpenTill, quickAccess }) {
  const [open,setOpen]=useState(false);
  const configured=(Array.isArray(quickAccess)&&quickAccess.length?quickAccess:DOCK_PRIMARY).filter((name)=>!["Settings","Integrations","Audit Log","Licensing"].includes(name)).slice(0,MAX_QUICK_ACCESS);
  const leftSlots=configured.slice(0,SIDE_SLOTS-1);
  const rightSlots=configured.slice(SIDE_SLOTS-1,MAX_QUICK_ACCESS);
  useEffect(()=>{if(!open)return; const onKey=(e)=>{if(e.key==="Escape")setOpen(false);}; document.addEventListener("keydown",onKey); return()=>document.removeEventListener("keydown",onKey);},[open]);
  const byName=new Map(items.map(([name,icon])=>[name,icon]));
  const navigate=(name)=>{setOpen(false); if(name==="Open Till"){onOpenTill?.();return;} onNavigate(name);};
  return <div className="fixed bottom-[5px] inset-x-0 flex justify-center z-[900] pointer-events-none">
    <nav aria-label="Main navigation" className="relative grid grid-cols-[repeat(6,52px)_72px_repeat(6,52px)] items-center gap-1 max-w-[calc(100vw-8px)] overflow-x-auto px-2.5 py-1.5 rounded-2xl border border-white/15 shadow-2xl pointer-events-auto" style={{background:"var(--onepos-dock-bg)",backdropFilter:"blur(18px) saturate(160%)",WebkitBackdropFilter:"blur(18px) saturate(160%)",boxShadow:"0 14px 40px rgba(4,26,24,.45),0 3px 10px rgba(4,26,24,.30),inset 0 1px 0 rgba(255,255,255,.10)"}}>
      <button onClick={()=>setOpen(v=>!v)} aria-haspopup="menu" aria-expanded={open} aria-label={open?"Close applications menu":"Open applications menu"} title="Applications" className="w-[52px] h-[46px] rounded-xl grid place-items-center text-emerald-50/85 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/10 active:scale-95"><LayoutGrid size={22}/></button>
      {leftSlots.map((slot)=>{const Icon=byName.get(slot)||(slot==="Open Till"?Store:null); return Icon?<DockButton key={slot} slot={slot} Icon={Icon} active={page===slot} onClick={()=>navigate(slot)}/>:<span key={slot}/>;})}
      {Array.from({length:5-leftSlots.length},(_,i)=><span key={`left-empty-${i}`} aria-hidden="true"/>)}
      <div className="relative w-[72px] h-[52px] grid place-items-center"><JarvisCorner embedded /></div>
      {rightSlots.map((slot)=>{const Icon=byName.get(slot)||(slot==="Open Till"?Store:null); return Icon?<DockButton key={slot} slot={slot} Icon={Icon} active={page===slot} onClick={()=>navigate(slot)}/>:<span key={slot}/>;})}
      {Array.from({length:6-rightSlots.length},(_,i)=><span key={`right-empty-${i}`} aria-hidden="true"/>)}
    </nav>
    {open&&<LauncherPopup items={items} objectItems={objectItems} reportItems={reportItems} page={page} onNavigate={navigate} onClose={()=>setOpen(false)}/>} 
  </div>;
}
