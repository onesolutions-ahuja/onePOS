import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  LogOut,
  Monitor,
  PanelLeft,
  Settings,
  Store,
  UserCircle,
} from "lucide-react";
import { groupNavItems } from "../utils/adminApps.js";
import { applyPreferences, clearPreferences, DEFAULT_PREFERENCES } from "../utils/adminPreferences.js";
import PlatformSearch from "./PlatformSearch.jsx";

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
    return () => clearPreferences();
  }, [prefs, systemDark]);
}

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
      <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} aria-label="Switch application" data-testid="app-switcher" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" style={{ color: "var(--onepos-text-primary)" }}>
        <span className="onepos-nav-icon"><Building2 size={14} /></span>
        <span className="hidden sm:block max-w-[160px] truncate">{current ? current.name : "Applications"}</span>
        <ChevronDown size={14} className="shrink-0 opacity-70" />
      </button>
      {open && (
        <div role="menu" aria-label="Installed applications" data-testid="app-switcher-menu" className="absolute left-0 top-full z-[var(--onepos-layer-dropdown)] mt-2 w-72 overflow-hidden rounded-xl border py-1 shadow-xl" style={{ backgroundColor: "var(--onepos-surface-raised)", borderColor: "var(--onepos-border)", colorScheme: "inherit" }}>
          <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--onepos-text-muted)" }}>Installed applications</div>
          {apps.length === 0 && (<div className="px-3 py-3 text-xs" style={{ color: "var(--onepos-text-muted)" }}>No additional applications are available.</div>)}
          {apps.map((app) => (
            <button key={app.key} type="button" role="menuitem" onClick={() => { setOpen(false); if (app.route) onNavigate?.(app.route); }} className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-black/5" style={{ color: "var(--onepos-text-primary)" }}>
              <span className="onepos-nav-icon mt-0.5"><Building2 size={13} /></span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{app.name}</span>
                {app.description && (<span className="block truncate text-[11px]" style={{ color: "var(--onepos-text-muted)" }}>{app.description}</span>)}
              </span>
              {current?.key === app.key && <Check size={14} className="ml-auto mt-1 shrink-0" style={{ color: "var(--onepos-accent-600)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NavigationMenu({ groups, page, onNavigate }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => { if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false); };
    const onKeyDown = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} aria-label="Open pages menu" title="Pages" data-testid="admin-nav-menu-trigger" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" style={{ color: "var(--onepos-text-primary)" }}>
        <span className="onepos-nav-icon"><PanelLeft size={14} /></span>
        <span className="hidden sm:block">Pages</span>
        <ChevronDown size={14} className="shrink-0 opacity-70" />
      </button>
      {open && (
        <div role="menu" aria-label="Pages" data-testid="admin-nav-menu" className="absolute left-0 top-full z-[var(--onepos-layer-dropdown)] mt-2 w-[320px] max-h-[60vh] overflow-y-auto rounded-xl border py-2 shadow-xl" style={{ backgroundColor: "var(--onepos-surface-raised)", borderColor: "var(--onepos-border)", colorScheme: "inherit" }}>
          {groups.map(({ label, items: groupItems }) => {
            const visibleItems = groupItems.filter(([name]) => typeof name === "string");
            if (!visibleItems.length) return null;
            return (
              <div key={label} className="px-2 py-1">
                <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--onepos-text-muted)" }}>{label}</div>
                <div className="space-y-1">
                  {visibleItems.map(([name, Icon]) => {
                    const active = page === name;
                    return (
                      <button key={name} type="button" role="menuitem" onClick={() => { setOpen(false); onNavigate?.(name); }} aria-current={active ? "page" : undefined} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-black/5" style={{ color: active ? "var(--onepos-accent-700)" : "var(--onepos-text-primary)", backgroundColor: active ? "var(--onepos-accent-soft)" : "transparent" }}>
                        {Icon && (<span className="onepos-nav-icon" style={{ width: "26px", height: "26px", borderRadius: "8px" }}><Icon size={15} className="shrink-0" /></span>)}
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        {active && <Check size={14} className="shrink-0" style={{ color: "var(--onepos-accent-600)" }} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminShell({ page, apps = [], items = [], reportItems = [], prefs = DEFAULT_PREFERENCES, onPrefsChange, onNavigate, onNavigateAppRoute, onOpenTill, onLogout, onOpenSettings, onResetPassword, onOpenProfile, onlineOrderCount = 0, onOpenOnlineOrders, onOpenNotifications, notificationCount = 0, user = null, storeName, children }) {
  const groups = useMemo(() => groupNavItems(items), [items]);
  useAdminAppearance(prefs);
  const displayName = user?.fullName || user?.name || user?.username || "User";
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";

  const profileRef = useRef(null);
  const [profileOpen, setProfileOpen] = useState(false);
  useEffect(() => {
    if (!profileOpen) return undefined;
    const onPointerDown = (event) => { if (profileRef.current && !profileRef.current.contains(event.target)) setProfileOpen(false); };
    const onKeyDown = (event) => { if (event.key === "Escape") setProfileOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("mousedown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [profileOpen]);

  return (
    <div className="onepos-shell" data-testid="admin-shell">
      <div className="onepos-shell-main">
        <header className="onepos-shell-header" data-testid="admin-header">
          <div className="flex min-w-0 items-center gap-1.5">
            <AppSwitcher apps={apps} onNavigate={onNavigateAppRoute} />
            <NavigationMenu groups={groups} page={page} onNavigate={onNavigate} />
          </div>
          <div className="hidden min-w-0 flex-1 justify-center md:flex"><PlatformSearch /></div>
          <div className="flex shrink-0 items-center gap-0.5">
            <div className="md:hidden"><PlatformSearch mobile /></div>
            <button type="button" onClick={onOpenNotifications || onOpenOnlineOrders} aria-label={"Notifications" + (notificationCount > 0 ? " (" + notificationCount + " new)" : "")} title="Notifications" data-testid="header-notifications" className="relative rounded p-2 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" style={{ color: "var(--onepos-text-body)" }}>
              <Bell size={18} />
              {(notificationCount > 0 || onlineOrderCount > 0) && (<span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-0.5 rounded-full text-[10px] font-bold leading-[17px] text-white" style={{ backgroundColor: "#dc2626" }}>{Math.max(notificationCount, onlineOrderCount) > 99 ? "99+" : Math.max(notificationCount, onlineOrderCount)}</span>)}
            </button>
            <button type="button" onClick={onOpenTill} aria-label="Open Till" title="Open Till" data-testid="header-open-till" className="flex items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1" style={{ backgroundColor: "var(--onepos-accent-600)", height: "var(--onepos-control-height, 38px)" }}><Store size={15} /><span className="hidden lg:inline">Open Till</span></button>
            <div className="relative" ref={profileRef}>
              <button type="button" onClick={() => setProfileOpen((value) => !value)} aria-haspopup="menu" aria-expanded={profileOpen} aria-label="User menu" title={displayName} data-testid="header-profile" className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold uppercase" style={{ backgroundColor: "var(--onepos-accent-700)", color: "#fff" }}>{initials}</span>
                <span className="hidden text-left leading-tight min-w-0 xl:block"><span className="block max-w-[140px] truncate text-[13px] font-medium" style={{ color: "var(--onepos-text-primary)" }}>{displayName}</span>{user?.role && (<span className="block max-w-[140px] truncate text-[11px]" style={{ color: "var(--onepos-text-muted)" }}>{user.role}</span>)}</span>
                <ChevronDown size={14} className="shrink-0" style={{ color: "var(--onepos-text-muted)" }} />
              </button>
              {profileOpen && (
                <div role="menu" aria-label="User menu" data-testid="header-profile-menu" className="absolute right-0 top-full z-[var(--onepos-layer-dropdown)] mt-2 w-56 rounded-xl border py-1 shadow-xl" style={{ backgroundColor: "var(--onepos-surface-raised)", borderColor: "var(--onepos-border)" }}>
                  <div className="border-b px-3 py-2" style={{ borderColor: "var(--onepos-border)" }}>
                    <div className="truncate text-sm font-semibold" style={{ color: "var(--onepos-text-primary)" }}>{displayName}</div>
                    <div className="truncate text-xs" style={{ color: "var(--onepos-text-muted)" }}>{user?.username || ""}{user?.storeName || storeName ? ` ? ${user?.storeName || storeName}` : ""}</div>
                  </div>
                {onOpenProfile && (
              <button type="button" role="menuitem" data-testid="menu-profile" onClick={() => { setProfileOpen(false); onOpenProfile?.(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5" style={{ color: "var(--onepos-text-primary)" }}><UserCircle size={15} />Profile</button>
            )}
                  <button type="button" role="menuitem" data-testid="menu-settings" onClick={() => { setProfileOpen(false); onOpenSettings?.("General"); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5" style={{ color: "var(--onepos-text-primary)" }}><Settings size={15} />Settings</button>
                  <button type="button" role="menuitem" data-testid="menu-reset-password" onClick={() => { setProfileOpen(false); onResetPassword?.(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-black/5" style={{ color: "var(--onepos-text-primary)" }}><Monitor size={15} />Reset password</button>
                  <div className="my-1 border-t" style={{ borderColor: "var(--onepos-border)" }} />
                  <button type="button" role="menuitem" data-testid="menu-logout" onClick={() => { setProfileOpen(false); onLogout?.(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"><LogOut size={15} />Log out</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="onepos-shell-content" data-testid="admin-shell-content">{children}</main>
      </div>
    </div>
  );
}
