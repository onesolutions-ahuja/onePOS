import "./AdminNavDock.css";
import { useEffect, useRef, useState } from "react";
import { BarChart3, Home, LayoutGrid, Search, Settings, X } from "lucide-react";
import JarvisCorner from "./jarvis/JarvisCorner.jsx";
import {
  INTERNET_STATES,
  SERVER_STATES,
  getConnectivity,
  startConnectivityMonitoring,
  subscribeConnectivity,
} from "../services/connectivity.js";
import {
  DEFAULT_DOCK_QUICK_ACCESS,
  dockQuickAccessSnapshot,
  loadDockQuickAccess,
  resolveDockQuickSlots,
  subscribeDockQuickAccess,
} from "../utils/dockConfiguration.js";

function BarChartIcon() {
  return <BarChart3 size={19} className="shrink-0 text-emerald-100/80" />;
}

// Display label shown under an icon, when it differs from the page/nav key
// used for routing (e.g. the "Dashboard" page reads as "Home" in the dock).
const DOCK_LABELS = {
  Dashboard: "Home",
};

/*
 * THE canonical desktop/tablet dock structure — identical on every surface:
 *
 *   [1–6 customizable quick-access slots]  JARVIS  [ALL PAGES]  [SETTINGS]
 *
 * The six quick slots come from the ONE saved configuration
 * (utils/dockConfiguration.js); the two trailing destinations are fixed and
 * permission-gated. Nothing here is route-dependent: the till, the dashboard,
 * Settings and a custom page render this same bar.
 */
const SLOT_LIMIT = 6;

const GROUPS = [
  { title: "Workspace", pages: ["Dashboard"] },
  {
    title: "Operations",
    pages: ["Sales", "Returns", "Supplier Returns", "Order Prep", "Payments"],
  },
  {
    title: "Catalogue & Supply",
    pages: ["Products", "Global Products", "Categories", "Purchases", "Suppliers", "Inventory", "Replenishment"],
  },
  {
    title: "Business",
    pages: ["Customers", "Employees", "Stores", "Reports"],
  },
  {
    title: "Admin",
    pages: ["Integrations", "Accounting", "Audit Log"],
  },
];

function LauncherPopup({ items, objectItems = [], reportItems = [], page, onNavigate, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const available = new Set(items.map(([name]) => name));
  const q = query.trim().toLowerCase();
  const match = (name) => !q || name.toLowerCase().includes(q);
  const visibleReports = reportItems.filter((item) => !q || item.title.toLowerCase().includes(q));
  const visibleObjects = objectItems.filter(([name]) => match(name));

  return (
    <>
      <div className="dock-menu-backdrop fixed inset-0 z-[1050]" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        aria-label="All pages"
        className="fixed left-1/2 -translate-x-1/2 bottom-[calc(var(--dock-height)+16px)] z-[1060] w-[560px] max-w-[94vw] rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
        style={{ background: "rgba(13,52,49,0.92)", backdropFilter: "blur(20px) saturate(160%)", WebkitBackdropFilter: "blur(20px) saturate(160%)" }}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <Search size={16} className="text-emerald-300/70 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages..."
            aria-label="Search pages"
            className="flex-1 bg-transparent outline-none text-[15px] text-emerald-50 placeholder:text-emerald-200/40"
          />
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="p-1.5 rounded-lg text-emerald-100/70 hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

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
          {visibleObjects.length > 0 && (
            <div className="mb-2 last:mb-0">
              <div className="text-[10px] font-bold tracking-[0.14em] uppercase text-emerald-200/50 px-2 pt-2 pb-1.5">
                Objects
              </div>
              <div className="grid grid-cols-2 gap-1">
                {visibleObjects.map(([name, Icon]) => {
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
          )}
          {q && !GROUPS.some(({ pages }) => pages.some((p) => available.has(p) && match(p))) && !visibleObjects.length && !visibleReports.length && (
            <div className="text-center text-sm text-emerald-100/60 py-6">No pages match "{query}"</div>
          )}
        </div>
      </div>
    </>
  );
}

// A single dock slot: icon stacked over a label, with a soft rounded-pill
// highlight behind the whole stack when it's the active page.
function DockSlot({ label, Icon, active, onClick, title }) {
  if (!Icon) return null;
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={title || label}
      className={`admin-nav-dock-slot group flex shrink-0 flex-col items-center justify-center gap-1 rounded-2xl py-1 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${
        active
          ? "bg-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]"
          : "hover:bg-white/10 active:bg-white/15"
      }`}
    >
      <Icon
        size={22}
        strokeWidth={2}
        className={active ? "text-white" : "text-emerald-100/80 group-hover:text-emerald-50"}
      />
      <span
        className={`max-w-[74px] truncate text-[10.5px] font-semibold leading-none tracking-wide ${
          active ? "text-white" : "text-emerald-100/70 group-hover:text-emerald-50/90"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * The dock owns its configuration: it paints from the shared snapshot and then
 * follows the ONE cached loader, so the same six slots appear on every surface
 * and a shell can never inject a route-specific list.
 */
function useDockQuickAccess() {
  const [quickAccess, setQuickAccess] = useState(() => dockQuickAccessSnapshot() || DEFAULT_DOCK_QUICK_ACCESS);
  useEffect(() => {
    let alive = true;
    const unsubscribe = subscribeDockQuickAccess((next) => { if (alive) setQuickAccess(next); });
    loadDockQuickAccess()
      .then((next) => { if (alive && next) setQuickAccess(next); })
      .catch(() => { /* canonical default layout stays in place */ });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);
  return quickAccess;
}

/*
 * ONE dock for the whole product: every shell — the admin pages, the Till/POS,
 * Settings and custom pages — renders THIS component with the same JSX and the
 * same stylesheet (AdminNavDock.css). Callers supply only the permitted pages,
 * the active destination and a navigation callback; the slot configuration and
 * the geometry are owned here, so no route can present a different dock.
 */
export default function AdminNavDock({ items, objectItems = [], reportItems = [], page, onNavigate, canOpenSettings = true }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const byName = new Map(items.map(([name, icon]) => [name, icon]));
  const quickAccess = useDockQuickAccess();
  /*
   * The canonical quick slots: the ONE saved configuration, reduced to the
   * pages this caller may open (permission + licence filtered — an unavailable
   * shortcut is dropped, never rendered) and capped at the desktop limit.
   * "Settings" is reserved for its own fixed destination at the end of the bar,
   * so a saved list can never duplicate it.
   */
  const quickSlots = resolveDockQuickSlots({ quickAccess, permitted: byName.keys() })
    .filter((name) => name !== "Settings")
    .slice(0, SLOT_LIMIT);

  /*
   * Offline visual state. The dock keeps NO connectivity opinion of its own:
   * it renders whatever the ONE authoritative source (services/connectivity.js
   * — the same module POSHeader, POS and App already subscribe to) last
   * verified, so the red edge can never disagree with the rest of onePOS.
   *
   *   offline = the probe proved the server unreachable, or the transport is
   *             down while no probe has confirmed the server.
   *   online  = server connected, or still UNKNOWN (startup / first probe in
   *             flight). An unmeasured state never flashes an alarm.
   *
   * The dock is also the only component mounted on BOTH surfaces (/app pages
   * and the Till), so it makes sure the shared probe is running there. The
   * module owns a singleton poller (starting twice re-rates it, it never
   * doubles), and it is deliberately NOT stopped on unmount: switching between
   * the till and the admin pages must not leave the next surface — or App's
   * offline-session recovery — without a probe.
   */
  const [connectivity, setConnectivity] = useState(getConnectivity);
  const offline =
    connectivity.server === SERVER_STATES.UNREACHABLE ||
    (connectivity.internet === INTERNET_STATES.DISCONNECTED && connectivity.server !== SERVER_STATES.CONNECTED);

  useEffect(() => {
    startConnectivityMonitoring({ intervalMs: 30000 });
    return subscribeConnectivity(setConnectivity);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  /* The single navigation entry point for every slot: the shell decides what
     the destination means (the till hands it back to App, the admin shell
     resolves it locally). No slot is special-cased here any more. */
  const navigate = (name) => {
    setOpen(false);
    onNavigate?.(name);
  };

  const renderSlot = (label, index, iconOverride = null) => {
    const slot = label;
    const slotIcon = byName.get(slot);
    const Icon = iconOverride || slotIcon || (slot === "Dashboard" ? Home : null);
    if (!Icon) return null;
    const active = page === slot || (slot === "Dashboard" && page === "Home");
    return (
      <DockSlot
        key={`${slot}-${index}`}
        label={DOCK_LABELS[slot] || slot}
        Icon={Icon}
        active={active}
        onClick={() => navigate(slot)}
        title={slot}
      />
    );
  };

  return (
    <div ref={rootRef} className="admin-nav-dock-root inset-x-0 flex justify-center bottom-[12px]">
      {/* data-connectivity drives ONLY the shadow ring in AdminNavDock.css:
          the same dock, with a subtle red edge while onePOS is offline. */}
      <nav
        aria-label="Main navigation"
        className="admin-nav-dock rounded-[32px]"
        data-connectivity={offline ? "offline" : "online"}
      >
        {/* 1–6 CUSTOMIZABLE QUICK-ACCESS SLOTS — the SAME saved configuration
            on every surface (dashboard, till, settings, custom pages). */}
        <div className="admin-nav-dock-wing">
          {quickSlots.map((label, index) => renderSlot(label, index))}
        </div>

        <div className="admin-nav-dock-center relative z-10 w-[var(--dock-center-zone)] shrink-0">
          <JarvisCorner embedded />
        </div>

        {/* FIXED DESTINATIONS — ALL PAGES, then SETTINGS. */}
        <div className="admin-nav-dock-wing">
          <DockSlot
            label="Apps"
            Icon={LayoutGrid}
            active={open}
            onClick={() => setOpen((v) => !v)}
            title={open ? "Close all pages menu" : "All pages"}
          />
          {canOpenSettings ? (
            <DockSlot
              label="Settings"
              Icon={byName.get("Settings") || Settings}
              active={page === "Settings"}
              onClick={() => navigate("Settings")}
              title="Settings"
            />
          ) : null}
        </div>
      </nav>

      {open && (
        <LauncherPopup
          items={items}
          objectItems={objectItems}
          reportItems={reportItems}
          page={page}
          onNavigate={navigate}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
