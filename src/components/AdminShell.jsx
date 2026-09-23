import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  Monitor,
  Moon,
  Palette,
  PanelLeft,
  Search,
  Settings,
  Store,
  Sun,
  UserCircle,
} from "lucide-react";
import { buildSwitcherApps, groupNavItems } from "../utils/adminApps.js";
import {
  ACCENT_OPTIONS,
  APPEARANCE_OPTIONS,
  DEFAULT_PREFERENCES,
  applyPreferences,
  clearPreferences,
  normalizePreferences,
  preferencesDiffer,
} from "../utils/adminPreferences.js";
import { buildAppPath } from "../utils/adminRoutes.js";
import { cx } from "./ui.jsx";

/* ------------------------------------------------------------------ */
/* Appearance sync hook: applies tokens to <html> and follows the OS   */
/* for appearance="system". Kept in the shell so every admin page and  */
/* the preview render through the SAME code path.                      */
/* ------------------------------------------------------------------ */
export function useAdminAppearance(prefs) {
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    applyPreferences(prefs, { systemDark });
    /* Leaving the admin shell (e.g. returning to the till) restores the
       default Light tokens exactly — an admin presentation choice can never
       leak into the POS UI. */
    return () => clearPreferences();
  }, [prefs, systemDark]);
}

/* ---------------------------- App switcher ---------------------------- */

function AppSwitcher({ apps, onNavigate }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = apps.find((app) => {
    const path = app.route;
    return path && window.location.pathname.startsWith(path.split("/").slice(0, 3).join("/"));
  }) || apps[0];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch application"
        data-testid="app-switcher"
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        style={{ color: "var(--onepos-text-primary)" }}
      >
        <span className="onepos-nav-icon">
          <Building2 size={14} />
        </span>
        <span className="hidden sm:block max-w-[160px] truncate">{current ? current.name : "Applications"}</span>
        <ChevronDown size={14} className="shrink-0 opacity-70" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Installed applications"
          data-testid="app-switcher-menu"
          className="absolute left-0 top-full z-[80] mt-2 w-72 overflow-hidden rounded-xl border py-1 shadow-xl"
          style={{ backgroundColor: "var(--onepos-surface-raised)", borderColor: "var(--onepos-border)", colorScheme: "inherit" }}
        >
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--onepos-text-muted)" }}>
            Installed applications
          </div>
          {apps.length === 0 && (
            <div className="px-3 py-3 text-xs" style={{ color: "var(--onepos-text-muted)" }}>
              No additional applications are available.
            </div>
          )}
          {apps.map((app) => (
            <button
              key={app.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (app.route) onNavigate?.(app.route);
              }}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-black/5"
              style={{ color: "var(--onepos-text-primary)" }}
            >
              <span className="onepos-nav-icon mt-0.5">
                <Building2 size={13} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{app.name}</span>
                {app.description && (
                  <span className="block truncate text-[11px]" style={{ color: "var(--onepos-text-muted)" }}>
                    {app.description}
                  </span>
                )}
              </span>
              {current?.key === app.key && <Check size={14} className="ml-auto mt-1 shrink-0" style={{ color: "var(--onepos-accent-600)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------- Preferences menu -------------------------- */

function AppearanceMenu({ prefs, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const set = (patch) => onChange({ ...normalizePreferences(prefs), ...patch });

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Display preferences"
        title="Display preferences"
        data-testid="appearance-menu-button"
        className="rounded p-2 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        style={{ color: "var(--onepos-text-body)" }}
      >
        <Palette size={18} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Display preferences"
          data-testid="appearance-menu"
          className="absolute right-0 top-full z-[80] mt-2 w-64 rounded-xl border p-3 shadow-xl"
          style={{ backgroundColor: "var(--onepos-surface-raised)", borderColor: "var(--onepos-border)" }}
        >
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--onepos-text-muted)" }}>
            Layout
          </div>
          <div className="mb-3 flex gap-1" role="radiogroup" aria-label="Layout preset">
            {["modern", "enterprise", "compact"].map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={prefs.preset === key}
                onClick={() => set({ preset: key })}
                data-testid={`preset-${key}`}
                className="flex-1 rounded-md border px-2 py-1.5 text-xs font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                style={{
                  borderColor: prefs.preset === key ? "var(--onepos-accent-600)" : "var(--onepos-border)",
                  backgroundColor: prefs.preset === key ? "var(--onepos-accent-soft)" : "transparent",
                  color: prefs.preset === key ? "var(--onepos-accent-700)" : "var(--onepos-text-body)",
                }}
              >
                {key}
              </button>
            ))}
          </div>

          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--onepos-text-muted)" }}>
            Appearance
          </div>
          <div className="mb-3 flex gap-1" role="radiogroup" aria-label="Appearance">
            {APPEARANCE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={prefs.appearance === key}
                onClick={() => set({ appearance: key })}
                data-testid={`appearance-${key}`}
                className="flex flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                style={{
                  borderColor: prefs.appearance === key ? "var(--onepos-accent-600)" : "var(--onepos-border)",
                  backgroundColor: prefs.appearance === key ? "var(--onepos-accent-soft)" : "transparent",
                  color: prefs.appearance === key ? "var(--onepos-accent-700)" : "var(--onepos-text-body)",
                }}
              >
                {key === "light" && <Sun size={12} />}
                {key === "dark" && <Moon size={12} />}
                {key === "system" && <Monitor size={12} />}
                {label}
              </button>
            ))}
          </div>

          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--onepos-text-muted)" }}>
            Accent
          </div>
          <div className="flex gap-1.5" role="radiogroup" aria-label="Accent colour">
            {ACCENT_OPTIONS.map(({ key, hue }) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={prefs.accent === key}
                aria-label={`${key} accent`}
                title={`${key} accent`}
                onClick={() => set({ accent: key })}
                data-testid={`accent-${key}`}
                className="h-6 w-6 rounded-full border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                style={{
                  background: `hsl(${hue} 55% 40%)`,
                  borderColor: prefs.accent === key ? "var(--onepos-text-primary)" : "transparent",
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Sidebar ------------------------------- */

function SidebarContent({ groups, page, onNavigate, collapsed, reportItems }) {
  return (
    <nav aria-label="Admin navigation" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-3" data-testid="admin-sidebar-nav">
      {groups.map(({ label, items }) => (
        <div key={label}>
          {!collapsed && <div className="onepos-sidebar-group-label">{label}</div>}
          <div className="space-y-0.5">
            {items.map(([name, Icon]) => {
              const active = page === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => onNavigate(name)}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? name : undefined}
                  data-testid={`nav-${name.replace(/\s+/g, "-").toLowerCase()}`}
                  className="onepos-sidebar-item"
                >
                  {/* Preset icon treatment: Modern = accent-tinted rounded
                      chip, Enterprise = neutral restrained chip, Compact =
                      tiny muted one. All three come from the same tokens. */}
                  {Icon && (
                    <span className="onepos-nav-icon">
                      <Icon size={18} className="shrink-0" />
                    </span>
                  )}
                  {!collapsed && <span className="truncate">{name}</span>}
                </button>
              );
            })}
          </div>
          {/* Metadata-driven report children under Insights (same
              permission-filtered list the Dockbar launcher receives). */}
          {!collapsed && label === "Insights" && reportItems.length > 0 && (
            <div className="mt-0.5 space-y-0.5" data-testid="sidebar-report-items">
              {reportItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigate(item.key)}
                  aria-current={page === item.key ? "page" : undefined}
                  title={item.title}
                  className="onepos-sidebar-item onepos-sidebar-item-sub"
                >
                  <span className="h-1 w-1 shrink-0 rounded-full bg-current opacity-60" />
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

/* ------------------------------- Shell --------------------------------- */

/**
 * The shared professional Admin shell: header (brand, app switcher, search,
 * quick actions, preferences, profile) + responsive sidebar + content frame.
 *
 * The existing onePOS Dockbar, BottomStatusBar, page content, permission
 * logic and catalogue filtering are NOT part of this component — AdminLayout
 * renders them exactly as before around/inside this frame.
 */
export default function AdminShell({
  page,
  apps = [],
  items = [],
  reportItems = [],
  prefs = DEFAULT_PREFERENCES,
  onPrefsChange,
  onNavigate,
  onNavigateAppRoute,
  onOpenTill,
  onLogout,
  onOpenSettings,
  onResetPassword,
  onlineOrderCount = 0,
  onOpenOnlineOrders,
  user = null,
  storeName,
  children,
}) {
  const collapsed = prefs.sidebarCollapsed === true;
  const groups = useMemo(() => groupNavItems(items), [items]);

  useAdminAppearance(prefs);

  /* Off-canvas drawer for tablet/mobile. */
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const navigateAndCloseDrawer = useCallback(
    (...args) => {
      setDrawerOpen(false);
      onNavigate?.(...args);
    },
    [onNavigate]
  );

  /* When a mobile drawer navigation happens the drawer must also close if the
     page changes through any other entry point. */
  useEffect(() => {
    setDrawerOpen(false);
  }, [page]);

  const displayName = user?.fullName || user?.name || user?.username || "User";
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";

  const profileRef = useRef(null);
  const [profileOpen, setProfileOpen] = useState(false);
  useEffect(() => {
    if (!profileOpen) return undefined;
    const onPointerDown = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [profileOpen]);

  const sidebarStyle = {
    backgroundColor: "var(--onepos-sidebar-bg)",
    color: "var(--onepos-sidebar-fg)",
  };

  return (
    <div className="onepos-shell" data-testid="admin-shell">
      {/* Desktop sidebar (lg+) */}
      <aside
        className="onepos-sidebar"
        data-collapsed={collapsed ? "true" : "false"}
        data-testid="admin-sidebar"
        style={sidebarStyle}
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            type="button"
            onClick={() => onPrefsChange?.({ ...prefs, sidebarCollapsed: !collapsed })}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            data-testid="sidebar-toggle"
            className="onepos-sidebar-iconbtn h-7 w-7"
          >
            {collapsed ? <ChevronsRight size={15} /> : <ChevronsLeft size={15} />}
          </button>
          {!collapsed && (
            <span className="onepos-sidebar-brand text-[13px] font-bold uppercase tracking-[0.16em]">onePOS</span>
          )}
        </div>

        <SidebarContent groups={groups} page={page} onNavigate={navigateAndCloseDrawer} collapsed={collapsed} reportItems={reportItems} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="onepos-sidebar-drawer" data-testid="admin-sidebar-drawer">
          <button
            type="button"
            className="onepos-sidebar-drawer-backdrop"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="onepos-sidebar-drawer-panel" style={sidebarStyle}>
            <div className="flex items-center justify-between px-3 py-3">
              <span className="onepos-sidebar-brand text-[13px] font-bold uppercase tracking-[0.16em]">onePOS</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="onepos-sidebar-iconbtn p-1.5"
              >
                ✕
              </button>
            </div>
            <SidebarContent groups={groups} page={page} onNavigate={navigateAndCloseDrawer} collapsed={false} reportItems={[]} />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="onepos-shell-main">
        <header className="onepos-shell-header" data-testid="admin-header">
          {/* Left: mobile nav trigger + brand + app switcher */}
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              data-testid="mobile-nav-trigger"
              className="rounded p-2 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden"
              style={{ color: "var(--onepos-text-body)" }}
            >
              <PanelLeft size={18} />
            </button>

            <div className="relative">
              <AppSwitcher apps={apps} onNavigate={(route) => onNavigateAppRoute?.(route)} />
            </div>
          </div>

          {/* Centre: global page search — opens the existing page via its URL. */}
          <div className="hidden min-w-0 flex-1 justify-center md:flex">
            <div className="relative w-full max-w-md">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--onepos-text-muted)" }} />
              <input
                type="search"
                list="onepos-admin-pages"
                aria-label="Search admin pages"
                placeholder="Search pages…"
                data-testid="admin-page-search"
                onChange={(event) => {
                  const value = event.target.value.trim();
                  if (!value) return;
                  const hit = items.find(([name]) => name.toLowerCase() === value.toLowerCase())
                    || items.find(([name]) => name.toLowerCase().startsWith(value.toLowerCase()));
                  if (hit) {
                    onNavigate?.(hit[0]);
                    event.target.value = "";
                  }
                }}
                className="w-full rounded-md border pl-9 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-blue-500/40"
                style={{ backgroundColor: "var(--onepos-surface-muted)", borderColor: "var(--onepos-border)", color: "var(--onepos-text-primary)", height: "var(--onepos-control-height, 36px)" }}
              />
              <datalist id="onepos-admin-pages">
                {items.map(([name]) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Right: quick actions + preferences + profile */}
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onOpenOnlineOrders}
              aria-label={`Online orders${onlineOrderCount > 0 ? ` (${onlineOrderCount} new)` : ""}`}
              title="Online Orders"
              data-testid="header-online-orders"
              className="relative rounded p-2 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              style={{ color: "var(--onepos-text-body)" }}
            >
              <Bell size={18} />
              {onlineOrderCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-0.5 rounded-full text-[10px] font-bold leading-[17px] text-white" style={{ backgroundColor: "#dc2626" }}>
                  {onlineOrderCount > 99 ? "99+" : onlineOrderCount}
                </span>
              )}
            </button>

            <AppearanceMenu prefs={prefs} onChange={onPrefsChange} />

            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
              data-testid="header-settings"
              className="rounded p-2 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              style={{ color: "var(--onepos-text-body)" }}
            >
              <Settings size={18} />
            </button>

            <button
              type="button"
              onClick={onOpenTill}
              aria-label="Open Till"
              title="Open Till"
              data-testid="header-open-till"
              className="flex items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
              style={{ backgroundColor: "var(--onepos-accent-600)", height: "var(--onepos-control-height, 38px)" }}
            >
              <Store size={15} />
              <span className="hidden lg:inline">Open Till</span>
            </button>

            {/* Profile */}
            <div className="relative" ref={profileRef}>
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
                aria-label="User menu"
                title={displayName}
                data-testid="header-profile"
                className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold uppercase"
                  style={{ backgroundColor: "var(--onepos-accent-700)", color: "#fff" }}
                >
                  {initials}
                </span>
                <span className="hidden text-left leading-tight min-w-0 xl:block">
                  <span className="block max-w-[140px] truncate text-[13px] font-medium" style={{ color: "var(--onepos-text-primary)" }}>
                    {displayName}
                  </span>
                  {user?.role && (
                    <span className="block max-w-[140px] truncate text-[11px]" style={{ color: "var(--onepos-text-muted)" }}>
                      {user.role}
                    </span>
                  )}
                </span>
                <ChevronDown size={14} className="shrink-0" style={{ color: "var(--onepos-text-muted)" }} />
              </button>

              {profileOpen && (
                <div
                  role="menu"
                  aria-label="User menu"
                  data-testid="header-profile-menu"
                  className="absolute right-0 top-full z-[80] mt-2 w-56 rounded-xl border py-1 shadow-xl"
                  style={{ backgroundColor: "var(--onepos-surface-raised)", borderColor: "var(--onepos-border)" }}
                >
                  <div className="border-b px-3 py-2" style={{ borderColor: "var(--onepos-border)" }}>
                    <div className="truncate text-sm font-semibold" style={{ color: "var(--onepos-text-primary)" }}>{displayName}</div>
                    <div className="truncate text-xs" style={{ color: "var(--onepos-text-muted)" }}>
                      {user?.username || ""}
                      {user?.storeName || storeName ? ` · ${user?.storeName || storeName}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="menu-profile"
                    onClick={() => {
                      setProfileOpen(false);
                      onOpenSettings?.("Users & Permissions");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-black/5"
                    style={{ color: "var(--onepos-text-body)" }}
                  >
                    <UserCircle size={15} /> Profile
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="menu-appearance"
                    onClick={() => {
                      setProfileOpen(false);
                      onOpenSettings?.("Appearance");
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-black/5"
                    style={{ color: "var(--onepos-text-body)" }}
                  >
                    <Palette size={15} /> Appearance & display
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      onResetPassword?.();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-black/5"
                    style={{ color: "var(--onepos-text-body)" }}
                  >
                    <Settings size={15} /> Reset password
                  </button>
                  <div className="my-1 border-t" style={{ borderColor: "var(--onepos-border)" }} />
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="menu-logout"
                    onClick={() => {
                      setProfileOpen(false);
                      onLogout?.();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-black/5"
                    style={{ color: "#dc2626" }}
                  >
                    <LogOut size={15} /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page frame: existing page content renders UNCHANGED inside, and it
            uses ALL remaining width. Pages render their own titles/headers —
            the frame adds none — and any sensible content max-width stays a
            PAGE-level decision (the shell never centres or caps itself). */}
        <div className="onepos-shell-content" data-testid="admin-shell-content">
          {children}
        </div>
      </div>
    </div>
  );
}
