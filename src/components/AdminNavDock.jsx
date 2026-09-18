import { useEffect, useRef, useState } from "react";
import { BarChart3, LayoutGrid, Search, Store, X } from "lucide-react";

/* Small inline icon for report submenu rows (keeps the dock self-contained). */
function BarChartIcon() {
  return <BarChart3 size={19} className="shrink-0 text-emerald-100/80" />;
}

/*
 * Floating admin navigation dock (replaces the left sidebar).
 *
 * Sits bottom-centre, floating over the fixed bottom status bar. High-frequency
 * pages live directly on the dock as touch-sized icons; the centre launcher
 * (9-dot) opens a grouped popup containing EVERY page the sidebar used to show —
 * the `items` prop is the SAME permission-filtered list AdminLayout already
 * built, so permission behaviour is identical (Reports entry only appears when
 * the user can access at least one report, Order Prep/Integrations/Accounting/
 * Returns respect their gates, Admin/Owner bypass unchanged).
 *
 * Touch-first for a 15-inch till display: 52px hit targets on the dock,
 * 48px rows in the launcher popup, large fonts, no hover-dependent actions.
 */

/* Pages that stay directly on the dock (order = left → right around the launcher). */
const DOCK_PRIMARY = [
  "Dashboard",
  "Sales",
  "Products",
  "Inventory",
  "LEFT", /* launcher slot marker */
  "Customers",
  "Reports",
  "Open Till",
];

/* Grouping used inside the launcher popup — display order only; every item in
 * `items` appears exactly once (primary items are marked, not duplicated). */
const GROUPS = [
  {
    title: "Operations",
    pages: ["Sales", "Returns", "Supplier Returns", "Order Prep", "Payments", "Open Till"],
  },
  {
    title: "Catalogue & Supply",
    pages: ["Products", "Global Products", "Categories", "Purchases", "Suppliers", "Inventory"],
  },
  {
    title: "Business",
    pages: ["Customers", "Employees", "Stores", "Reports"],
  },
  {
    title: "Admin",
    pages: ["Integrations", "Accounting", "Settings"],
  },
];

function LauncherPopup({ items, reportItems = [], page, onNavigate, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const available = new Set(items.map(([name]) => name));
  const q = query.trim().toLowerCase();
  const match = (name) => !q || name.toLowerCase().includes(q);
  const visibleReports = reportItems.filter(
    (item) => !q || item.title.toLowerCase().includes(q)
  );

  return (
    <>
      {/* click-away shield (also blocks the page behind on touch) */}
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        aria-label="All pages"
        className="fixed left-1/2 -translate-x-1/2 bottom-[62px] z-50 w-[560px] max-w-[94vw] rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        style={{ background: "rgba(13,52,49,0.92)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)" }}
      >
        {/* search header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <Search size={16} className="text-emerald-300/70 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages…"
            aria-label="Search pages"
            className="flex-1 bg-transparent outline-none text-[15px] text-emerald-50 placeholder:text-emerald-200/40"
          />
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="p-1.5 rounded-lg text-emerald-100/70 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        {/* grouped pages */}
        <div className="px-3 py-3 max-h-[52vh] overflow-y-auto">
          {GROUPS.map(({ title, pages }) => {
            const visible = pages.filter((p) => available.has(p) && match(p));
            if (!visible.length) return null;
            return (
              <div key={title} className="mb-2 last:mb-0">
                <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-emerald-200/50 px-2 pt-2 pb-1.5">
                  {title}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {visible.map((name) => {
                    const Icon = items.find(([n]) => n === name)?.[1];
                    const active = page === name;
                    return (
                      <button
                        key={name}
                        role="menuitem"
                        onClick={() => onNavigate(name)}
                        className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-colors ${
                          active ? "bg-white/20 text-white" : "text-emerald-50 hover:bg-white/10 active:bg-white/15"
                        }`}
                      >
                        {Icon && <Icon size={19} className="shrink-0 text-emerald-100/80" />}
                        <span className="text-[15px] font-medium truncate">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {visibleReports.length > 0 && (
            <div className="mb-2 last:mb-0">
              <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-emerald-200/50 px-2 pt-2 pb-1.5">
                Reports
              </div>
              <div className="grid grid-cols-2 gap-1">
                {visibleReports.map((item) => {
                  const active = page === item.key;
                  return (
                    <button
                      key={item.key}
                      role="menuitem"
                      onClick={() => onNavigate(item.key)}
                      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-colors ${
                        active ? "bg-white/20 text-white" : "text-emerald-50 hover:bg-white/10 active:bg-white/15"
                      }`}
                    >
                      <BarChartIcon />
                      <span className="text-[15px] font-medium truncate">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {q && !GROUPS.some(({ pages }) => pages.some((p) => available.has(p) && match(p))) && !visibleReports.length && (
            <div className="text-center text-sm text-emerald-100/60 py-6">No pages match “{query}”</div>
          )}
        </div>
      </div>
    </>
  );
}

export default function AdminNavDock({ items, reportItems = [], page, onNavigate, onOpenTill }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  /* close on Escape for keyboard users */
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const byName = new Map(items.map(([name, icon]) => [name, icon]));
  const navigate = (name) => {
    setOpen(false);
    if (name === "Open Till") {
      onOpenTill?.();
      return;
    }
    onNavigate(name);
  };

  return (
    <div ref={rootRef} className="fixed bottom-[5px] left-1/2 -translate-x-1/2 z-50">
      <nav
        aria-label="Main navigation"
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-2xl border border-white/15 shadow-2xl"
        style={{
          background: "rgba(13,52,49,0.88)",
          backdropFilter: "blur(18px) saturate(160%)",
          WebkitBackdropFilter: "blur(18px) saturate(160%)",
          boxShadow: "0 14px 40px rgba(4,26,24,0.45), 0 3px 10px rgba(4,26,24,0.30), inset 0 1px 0 rgba(255,255,255,0.10)",
        }}
      >
        {DOCK_PRIMARY.map((slot) => {
          if (slot === "LEFT") {
            return (
              <button
                key="launcher"
                onClick={() => setOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={open ? "Close all pages menu" : "Open all pages menu"}
                title="All pages"
                className="mx-1.5 w-[54px] h-[46px] rounded-full grid place-items-center text-white transition-transform active:scale-95"
                style={{
                  background: "linear-gradient(135deg,#1a817b 0%,#176F6A 55%,#0e5f5a 100%)",
                  boxShadow: "0 6px 16px rgba(23,111,106,0.55), inset 0 1px 0 rgba(255,255,255,0.25)",
                }}
              >
                <LayoutGrid size={22} />
              </button>
            );
          }

          const Icon = byName.get(slot) || (slot === "Open Till" ? Store : null);
          /* Page not available to this user (permission-filtered out) → skip. */
          if (!Icon) return null;
          const active = page === slot;
          return (
            <button
              key={slot}
              onClick={() => navigate(slot)}
              aria-current={active ? "page" : undefined}
              title={slot === "Open Till" ? "Open Till (POS)" : slot}
              className={`relative w-[52px] h-[46px] rounded-xl grid place-items-center transition-colors ${
                active ? "bg-white/20 text-white" : "text-emerald-50/85 hover:bg-white/10 active:bg-white/15"
              }`}
            >
              <Icon size={22} />
              {active && (
                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-emerald-300" />
              )}
              {slot === "Open Till" && (
                <span className="absolute -bottom-[1px] inset-x-2 h-[2px] rounded-full bg-emerald-400/60" />
              )}
            </button>
          );
        })}
      </nav>

      {open && (
        <LauncherPopup
          items={items}
          reportItems={reportItems}
          page={page === "Open Till" ? "Open Till" : page}
          onNavigate={navigate}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
