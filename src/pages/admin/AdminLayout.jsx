import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Bell, Calculator, CreditCard, Database, FileText, Grid3X3, Home, KeyRound, Package, Percent, Plug, Receipt, RefreshCw, Settings, ShoppingBag, Store, Tag, Users, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { parseAppPath, buildAppPath } from "../../utils/adminRoutes.js";
import { buildSwitcherApps } from "../../utils/adminApps.js";
import { normalizePreferences, preferencesDiffer } from "../../utils/adminPreferences.js";
import {
  loadCachedPreferences,
  fetchPreferences,
  savePreferences,
} from "../../services/adminPreferencesService.js";
import BottomStatusBar from "../../components/BottomStatusBar.jsx";
import AdminNavDock from "../../components/AdminNavDock.jsx";
import AdminShell from "../../components/AdminShell.jsx";
import Dashboard from "../dashboard/Dashboard.jsx";
import ProductsAdmin from "../products/ProductsAdmin.jsx";
import GlobalProductsAdmin from "../products/GlobalProductsAdmin.jsx";
import CategoriesAdmin from "../categories/CategoriesAdmin.jsx";
import InventoryAdmin from "../inventory/InventoryAdmin.jsx";
import ReplenishmentAdmin from "../inventory/ReplenishmentAdmin.jsx";
import SettingsAdmin from "../settings/SettingsAdmin.jsx";
import ChangePasswordModal from "../settings/ChangePasswordModal.jsx";
import SuppliersAdmin from "../suppliers/SuppliersAdmin.jsx";
import IntegrationsAdmin from "../integrations/IntegrationsAdmin.jsx";
import AccountingAdmin from "../integrations/AccountingAdmin.jsx";
import PurchasesAdmin from "../purchases/PurchasesAdmin.jsx";
import SalesAdmin from "../sales/SalesAdmin.jsx";
import ReportsAdmin from "../reports/ReportsAdmin.jsx";
import ReportPage, { REPORT_MENU_ITEMS } from "../reports/ReportPage.jsx";
import CustomReportsAdmin from "../reports/CustomReportsAdmin.jsx";
import ReturnsAdmin, { SupplierReturnsAdmin } from "../returns/ReturnsAdmin.jsx";
import CustomersAdmin from "../customers/CustomersAdmin.jsx";
import OnlineOrdersAdmin from "../online/OnlineOrdersAdmin.jsx";
import OnlineOrdersPrep from "../online/OnlineOrdersPrep.jsx";
import StoresAdmin from "../stores/StoresAdmin.jsx";
import AttendanceAdmin from "../employees/AttendanceAdmin.jsx";
import LicensingAdmin from "../superadmin/LicensingAdmin.jsx";
import BusinessDivisionsAdmin from "../businessDivisions/BusinessDivisionsAdmin.jsx";
import AuditLogAdmin from "../audit/AuditLogAdmin.jsx";

/*
 * T10V: report pages live at /app/reports/<slug>. The slug is the report
 * key lower-cased and hyphenated ("Sales Report" -> sales-report) — stable
 * and readable without hard-coding a second list.
 */
function slugifyReportKey(key) {
  return String(key).toLowerCase().replace(/\s+/g, "-");
}

/*
 * The URL for a page: granular reports live under /app/reports/<slug>;
 * everything else uses the shared slug map (Settings optionally with its
 * section tab). Single source used by initial sync and navigation.
 */
function pathForPage(nextPage, settingsTab = null) {
  if (nextPage === "My Reports") return "/app/reports/custom";
  if (REPORT_MENU_ITEMS.some((item) => item.key === nextPage)) {
    return `/app/reports/${slugifyReportKey(nextPage)}`;
  }
  return buildAppPath(nextPage, { settingsTab });
}

/*
 * The catalogue owns module definitions; this small adapter only maps the
 * existing navigation labels to those definitions. Routes and permissions
 * remain owned by AdminLayout and the backend respectively.
 */
const CATALOG_MODULE_BY_PAGE = {
  Dashboard: "retail_pos",
  Sales: "retail_pos",
  Returns: "retail_pos",
  "Supplier Returns": "retail_pos",
  Payments: "retail_pos",
  Products: "products",
  "Global Products": "products",
  Categories: "products",
  Purchases: "suppliers",
  Suppliers: "suppliers",
  Inventory: "inventory",
  Replenishment: "inventory",
  Customers: "customers",
  Employees: "staff",
  Stores: "staff",
  Reports: "reports",
  "My Reports": "reports",
  "Order Prep": "online_orders",
  Integrations: "integrations",
  Accounting: "integrations",
};

export function filterNavigationByCatalog(items, catalogKeys) {
  if (!(catalogKeys instanceof Set)) return items;
  return items.filter(([page]) => {
    const moduleKey = CATALOG_MODULE_BY_PAGE[page];
    return !moduleKey || catalogKeys.has(moduleKey);
  });
}

export default function AdminLayout({
  onPOS,
  onLogout,
  user = null,
  initialPage = "Dashboard",
  initialSettingsTab = null,
  initialReportKey = null,
  entitlements = {},
}) {
  /*
   * T10V: the page state is synchronised with the URL. The initial page is
   * resolved from the CURRENT URL (so a refresh or a direct link reopens the
   * exact page), every navigation pushes a history entry, and browser
   * Back/Forward move through visited pages. Unknown/deep routes resolve
   * through the SAME permission gates as normal navigation — nothing here
   * grants or bypasses access.
   */
  const resolveRoute = () => {
    const parsed = parseAppPath(window.location.pathname);
    if (!parsed) return { page: initialPage, settingsTab: initialSettingsTab, reportKey: initialReportKey, valid: true };
    if (parsed.view === "pos") return { page: "Dashboard", settingsTab: null, reportKey: null, valid: true };
    if (parsed.view === "unknown") return { page: initialPage, settingsTab: initialSettingsTab, reportKey: initialReportKey, valid: false };
    if (parsed.page === "REPORT") {
      if (parsed.reportKey === "custom") return { page: "My Reports", settingsTab: null, reportKey: null, valid: true };
      /* A granular report deep link: /app/reports/<key-slug>. */
      const reportKey = REPORT_MENU_ITEMS.find((item) => slugifyReportKey(item.key) === parsed.reportKey)?.key;
      if (reportKey) return { page: reportKey, settingsTab: null, reportKey: null, valid: true };
      return { page: "Reports", settingsTab: null, reportKey: null, valid: true };
    }
    return { page: parsed.page, settingsTab: parsed.settingsTab || initialSettingsTab, reportKey: null, valid: true };
  };

  const [page, setPage] = useState(() => resolveRoute().page);
  const pendingRoute = useRef(resolveRoute());

  const [productCreateRequested, setProductCreateRequested] = useState(false);
  /* Which tab the existing Settings page opens on (gear = General, profile menu = Users & Permissions). */
  const [settingsTab, setSettingsTab] = useState("General");

  /* Apply the URL's settings tab / report deep link once permissions state
     exists, then normalise an invalid path to the resolved page's URL. */
  useEffect(() => {
    const route = pendingRoute.current;
    if (route.settingsTab) setSettingsTab(route.settingsTab);
    const expected = pathForPage(route.page, route.settingsTab);
    if (!route.valid || window.location.pathname !== expected) {
      window.history.replaceState({}, "", expected);
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  /*
   * The single navigation entry point: updates state AND the URL. Report
   * pages use their own /app/reports/<slug> path; Settings carries its tab.
   */
  const navigate = useCallback((nextPage, options = {}) => {
    if (options.createRequested) setProductCreateRequested(true); else setProductCreateRequested(false);
    if (nextPage === "Settings" && options.settingsTab) setSettingsTab(options.settingsTab);
    setPage(nextPage);
    const target = pathForPage(nextPage, options.settingsTab || (nextPage === "Settings" ? settingsTab : null));
    if (window.location.pathname !== target) {
      window.history.pushState({}, "", target);
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [settingsTab]);

  /* Browser Back/Forward: re-resolve the page from the history entry. */
  useEffect(() => {
    const onPopState = () => {
      const route = resolveRoute();
      setPage(route.page);
      if (route.page === "Settings" && route.settingsTab) setSettingsTab(route.settingsTab);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  /* Top-right Reset Password dialog (T10Y-followup) — opened from the shell
     profile menu; the profile menu itself now lives in AdminShell. */
  const [resetPwOpen, setResetPwOpen] = useState(false);

  const [onlinePermissions, setOnlinePermissions] = useState({ isAdmin: false, permissions: [], entitlements });
  const [reportsLoaded, setReportsLoaded] = useState(false);
  /* null means the runtime catalogue has not loaded or failed; in either case
     retain the existing permission-filtered navigation as the safe fallback. */
  const [catalogKeys, setCatalogKeys] = useState(null);
  /* Raw runtime catalog entries for the app switcher (same response; the
     switcher presents only what the server already authorised). */
  const [catalogEntries, setCatalogEntries] = useState([]);
  /* T10W: dock quick-access pages configured in Settings → Store & Till.
     null = not loaded yet → the dock falls back to its default layout. */
  const [dockQuickAccess, setDockQuickAccess] = useState(null);
  useEffect(() => {
    let alive = true;
    apiRequest("/api/settings").then((data) => {
      if (alive && data.success && Array.isArray(data.data?.dock?.quickAccess)) {
        setDockQuickAccess(data.data.dock.quickAccess);
      }
    }).catch(() => {}); /* default dock layout on failure — non-critical */
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    apiRequest("/api/platform/runtime/app-catalog")
      .then((data) => {
        if (!alive || !data?.success || !Array.isArray(data.data)) return;
        setCatalogKeys(new Set(data.data.map((entry) => entry?.module_key || entry?.key).filter(Boolean)));
        setCatalogEntries(data.data);
      })
      .catch(() => {
        /* Catalogue availability must never blank the existing navigation. */
        if (alive) setCatalogKeys(null);
      });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    apiRequest("/api/auth/me/permissions").then((data) => {
      if (alive && data.success) {
        setOnlinePermissions(data.data);
        setReportsLoaded(true);
      } else {
        if (alive) setReportsLoaded(true);
      }
    }).catch((error) => { console.error("Online order permissions:", error); if (alive) setReportsLoaded(true); });
    return () => { alive = false; };
  }, []);

  /*
   * Admin presentation preferences (NEW, user-level): layout preset,
   * appearance and accent. Cached value paints instantly; the server row
   * (GET /api/auth/me/preferences) reconciles across devices. The DEFAULT
   * Light tokens equal the original hard-coded palette, so the shell and
   * every page look exactly as before until the user chooses otherwise.
   */
  const [prefs, setPrefs] = useState(() => loadCachedPreferences() || normalizePreferences(null));
  useEffect(() => {
    let alive = true;
    fetchPreferences().then((loaded) => {
      if (!alive || !loaded) return;
      setPrefs((current) => (preferencesDiffer(current, loaded) ? loaded : current));
    });
    return () => { alive = false; };
  }, []);
  const updatePrefs = useCallback((next) => {
    setPrefs(normalizePreferences(next));
    savePreferences(next); /* fire-and-forget; local mirror keeps it sticky */
  }, []);

  /*
   * Reports submenu visibility — reuses the EXISTING permission model from
   * /api/auth/me/permissions (the same session data Order Prep uses):
   * Administrator/Admin/Owner roles bypass permission checks entirely via the
   * isAdmin flag (mirroring the server-side authorize() helper); every other
   * role needs the matching seeded permission code(s). Item requirements come
   * from REPORT_MENU_ITEMS: string = one required code, array = any-of.
   */
  const canViewReport = useCallback((permission) => {
    if (onlinePermissions.isAdmin) return true;
    if (!permission) return true;
    const codes = Array.isArray(permission) ? permission : [permission];
    return codes.some((code) => onlinePermissions.permissions.includes(code));
  }, [onlinePermissions]);

  const visibleReportItems = REPORT_MENU_ITEMS.filter((item) => canViewReport(item.permission));
  /* Overview / Summary cards page requires reports.summary.view per T10B granular catalogue. */
  const canViewOverview = canViewReport("reports.summary.view");
  const canViewCustomReports = canViewReport("reports.custom.view");
  if (canViewCustomReports) visibleReportItems.unshift({ key: "My Reports", title: "My Reports" });
  /* Users with ANY of the 13 granular reports.*.view codes can discover Reports.
     Admin/Owner bypass: if isAdmin we unconditionally show Reports.
     Also: if permissions are still loading (reportsLoaded=false) we KEEP the
     entry rendered (it is always present in the items array) so a flash of
     "missing sidebar entry" cannot happen on first paint for an Admin user. */
  const canViewReports =
    !reportsLoaded ||
    canViewOverview ||
    visibleReportItems.length > 0 ||
    canViewCustomReports ||
    onlinePermissions.isAdmin ||
    onlinePermissions.permissions.some((code) => code.startsWith("reports."));

  /* Non-blocking online-order notifications (Uber Eats / Deliveroo). */
  const [onlineOrderCount, setOnlineOrderCount] = useState(0);
  const [onlineOrderToast, setOnlineOrderToast] = useState(null);

  /*
   * Polls the online-order count (RECEIVED = pending acceptance / new).
   * This is webhook-ready: when the real Uber webhook lands, the receive
   * endpoint will push the same state and this polling remains as fallback.
   */
  const loadOnlineOrderCount = useCallback(async () => {
    try {
      const data = await apiRequest("/api/online/orders?status=RECEIVED&limit=50");
      if (data.success) {
        setOnlineOrderCount(Array.isArray(data.data) ? data.data.length : 0);
      }
    } catch (error) {
      console.error("Load online order count error:", error);
    }
  }, []);

  useEffect(() => {
    loadOnlineOrderCount();
    const timer = setInterval(loadOnlineOrderCount, 15000);
    return () => clearInterval(timer);
  }, [loadOnlineOrderCount]);

  const openOnlineOrders = () => {
    setOnlineOrderToast(null);
    navigate("Online Orders");
  };

  /* Surfaces a new-order toast without blocking the admin/till workflow. */
  const notifyNewOnlineOrder = useCallback((payload = {}) => {
    setOnlineOrderToast({
      message: payload.message || "New Uber Eats Order",
      externalOrderId: payload.externalOrderId || null,
    });
    loadOnlineOrderCount();
  }, [loadOnlineOrderCount]);

  const permissionFilteredItems = [
    ["Dashboard", Home],
    ["Sales", FileText],
    /* T9M-SMALL: Returns respects the existing permission system —
     * returns.view/returns.create for restricted roles, admin bypass. */
    ...(onlinePermissions.isAdmin ||
      onlinePermissions.permissions.includes("returns.view") ||
      onlinePermissions.permissions.includes("returns.create")
      ? [["Returns", RefreshCw]] : []),
    ...(onlinePermissions.isAdmin ||
      onlinePermissions.permissions.includes("returns.create")
      ? [["Supplier Returns", RefreshCw]] : []),
    ["Products", Package],
    ["Global Products", Database],
    ["Categories", Tag],
    ["Purchases", Receipt],
    ["Suppliers", Users],
    ["Inventory", Grid3X3],
    ...((onlinePermissions.isAdmin ||
      onlinePermissions.permissions.includes("inventory.replenishment.view") ||
      onlinePermissions.permissions.includes("inventory.view") ||
      onlinePermissions.permissions.includes("reports.low_stock.view"))
      ? [["Replenishment", Bell]] : []),
    ["Customers", Users],
    ["Employees", Users],
    ["Stores", Store],
    ...(onlinePermissions.isAdmin || onlinePermissions.permissions.includes("business_division.view") ? [["Business Divisions", Grid3X3]] : []),
    /* T10-AUDIT: Audit Log — gated by the audit.view permission (admin bypass). */
    ...(onlinePermissions.isAdmin || onlinePermissions.permissions.includes("audit.view") ? [["Audit Log", FileText]] : []),
    ["Payments", CreditCard],
    ...(onlinePermissions.isAdmin || onlinePermissions.permissions.includes("online_orders.view")
      ? [["Order Prep", ShoppingBag]] : []),
    /* T9F: Integration management — existing permission system (integration.manage, admin bypass). */
    ...(onlinePermissions.isAdmin || onlinePermissions.permissions.includes("integration.manage")
      ? [["Integrations", Plug]] : []),
    /* T9O: Accounting Integration — same permission mechanism, accounting-focused UI. */
    ...(onlinePermissions.isAdmin || onlinePermissions.permissions.includes("integration.manage")
      ? [["Accounting", Calculator]] : []),
    /* Settings — reachable by EVERY signed-in user, matching the existing
     * Settings surface's own authorization model: SettingsAdmin always
     * prepends the per-user "Your account" → Appearance section, so every
     * caller has at least one real Settings surface. The company/privileged
     * sections are gated INSIDE SettingsAdmin (Platform needs
     * isAdmin||isSuperadmin, Server / API Configuration needs isSuperadmin,
     * Customer Loyalty needs the entitlement) and each endpoint keeps
     * enforcing its own authorization. Navigation is discoverability, never
     * the security boundary, so this entry grants nothing on its own.
     * Deliberately unconditional rather than Superadmin-only: hiding it would
     * remove the per-user Appearance surface that ships to everyone. */
    ["Settings", Settings],
    ["Reports", BarChart3],
    ...(onlinePermissions.isSuperadmin ? [["Licensing", KeyRound]] : []),
  ];
  const items = filterNavigationByCatalog(permissionFilteredItems, catalogKeys);
  const catalogFilteredReportItems = filterNavigationByCatalog(
    canViewReports ? (canViewOverview ? [{ key: "Reports", title: "Overview" }, ...visibleReportItems] : visibleReportItems).map((item) => [item.key, null]) : [],
    catalogKeys
  ).map(([key]) => (key === "Reports" ? { key, title: "Overview" } : visibleReportItems.find((item) => item.key === key))).filter(Boolean);

  /*
   * App switcher entries: derived from the SAME runtime catalog response the
   * navigation filter already consumed (server-side installed/enablement/
   * package/licence/permission gating). Presentation only — it never grants
   * access; unknown catalog keys render under their own key with no route.
   */
  const switcherApps = buildSwitcherApps(catalogEntries);

  /* App-switcher route navigation: the switcher targets module routes (e.g.
     /app/products). No route renames; the shared navigate() resolves the
     page from the same URL the address bar shows. */
  const navigateAppRoute = useCallback((route) => {
    if (!route || typeof window === "undefined") return;
    if (window.location.pathname !== route) {
      window.history.pushState({}, "", route);
    }
    const resolved = resolveRoute();
    setPage(resolved.page);
    if (resolved.page === "Settings" && resolved.settingsTab) setSettingsTab(resolved.settingsTab);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  return (
    <div className="h-screen bg-slate-100 flex relative">
      {/* NAVIGATION — the existing onePOS floating Dockbar, bottom-centre of
         the status bar. PRESERVED UNCHANGED (functionality, quick access,
         launcher, Open Till). Consumes the SAME permission-filtered items
         list as before, so visibility per user/role is identical. */}
      <AdminNavDock
        items={items}
        reportItems={canViewReports ? catalogFilteredReportItems : []}
        page={page}
        onNavigate={navigate}
        onOpenTill={onPOS}
        quickAccess={dockQuickAccess}
      />

      <ChangePasswordModal open={resetPwOpen} onClose={() => setResetPwOpen(false)} />

      {/*
        PROFESSIONAL ADMIN SHELL — header (brand, app switcher, search, quick
        actions, preferences, profile) + responsive sidebar + page frame.
        The frame renders the EXISTING page components below untouched; the
        Dockbar and BottomStatusBar remain part of the layout as before.
      */}
      <AdminShell
        page={page}
        apps={switcherApps}
        items={items}
        reportItems={canViewReports ? catalogFilteredReportItems : []}
        prefs={prefs}
        onPrefsChange={updatePrefs}
        onNavigate={navigate}
        onNavigateAppRoute={navigateAppRoute}
        onOpenTill={onPOS}
        onLogout={onLogout}
        onOpenSettings={(tab) => {
          setProductCreateRequested(false);
          navigate("Settings", { settingsTab: tab || "General" });
        }}
        onResetPassword={() => setResetPwOpen(true)}
        onlineOrderCount={onlineOrderCount}
        onOpenOnlineOrders={openOnlineOrders}
        user={user}
        storeName="London Store"
      >
        {page ===
        "Dashboard" ? (
            <Dashboard
              canViewReports={canViewReports}
              onNavigate={navigate}
              onAddProduct={() => {
                navigate("Products", { createRequested: true });
              }}
            />
          ) : page ===
            "Sales" ? (
            <SalesAdmin />
          ) : page ===
            "Returns" ? (
            <ReturnsAdmin />
          ) : page ===
            "Supplier Returns" ? (
            <SupplierReturnsAdmin />
          ) : page ===
            "Products" ? (
            <ProductsAdmin openCreate={productCreateRequested} />
          ) : page ===
            "Global Products" ? (
            <GlobalProductsAdmin />
          ) : page ===
            "Categories" ? (
            <CategoriesAdmin />
          ) : page ===
            "Inventory" ? (
            <InventoryAdmin />
          ) : page ===
            "Replenishment" ? (
            <ReplenishmentAdmin
              canCreatePurchase={onlinePermissions.isAdmin || onlinePermissions.permissions.includes("purchase.create")}
            />
          ) : page ===
            "Purchases" ? (
            <PurchasesAdmin />
          ) : page ===
            "Suppliers" ? (
            <SuppliersAdmin permissions={onlinePermissions.permissions} isAdmin={onlinePermissions.isAdmin} />
          ) : page ===
            "Customers" ? (
            <CustomersAdmin entitlements={onlinePermissions.entitlements} permissions={onlinePermissions.permissions} isAdmin={onlinePermissions.isAdmin} />
          ) : page ===
            "Stores" ? (
            <StoresAdmin />
          ) : page ===
            "Business Divisions" ? (
            <BusinessDivisionsAdmin />
          ) : page ===
            "Integrations" ? (
            <IntegrationsAdmin />
          ) : page ===
            "Accounting" ? (
            <AccountingAdmin storeId={user?.storeId || null} />
          ) : page ===
            "Online Orders" ? (
            <OnlineOrdersAdmin />
          ) : page ===
            "Order Prep" ? (
            <OnlineOrdersPrep permissions={onlinePermissions} />
          ) : page ===
            "Settings" ? (
            <SettingsAdmin key={settingsTab} initialTab={settingsTab} isAdmin={onlinePermissions.isAdmin} isSuperadmin={onlinePermissions.isSuperadmin} entitlements={onlinePermissions.entitlements} />
          ) : page ===
            "Licensing" ? (
            onlinePermissions.isSuperadmin ? <LicensingAdmin /> : <div className="bg-white rounded-xl border p-10 text-center">Access denied</div>
            ) : page ===
             "Employees" ? (
             <AttendanceAdmin />
           ) : page ===
             "Audit Log" ? (
             onlinePermissions.isAdmin || onlinePermissions.permissions.includes("audit.view")
               ? <AuditLogAdmin />
               : <div className="bg-white rounded-xl border p-10 text-center">
                   <h2 className="text-xl font-bold">Access denied</h2>
                   <p className="text-sm text-slate-400 mt-2">You do not have permission to view the audit log.</p>
                 </div>
           ) : page ===
            "My Reports" ? (
            canViewCustomReports ? <CustomReportsAdmin /> : <div className="bg-white rounded-xl border p-10 text-center">Access denied</div>
          ) : page ===
            "Reports" ? (
            canViewReports ? (
              <ReportsAdmin />
            ) : (
              <div className="bg-white rounded-xl border p-10 text-center">
                <h2 className="text-xl font-bold">Access denied</h2>
                <p className="text-sm text-slate-400 mt-2">You do not have permission to view reports.</p>
              </div>
            )
          ) : REPORT_MENU_ITEMS.some((item) => item.key === page) ? (
            canViewReport(REPORT_MENU_ITEMS.find((item) => item.key === page)?.permission) ? (
              <ReportPage reportKey={page} />
            ) : (
              <div className="bg-white rounded-xl border p-10 text-center">
                <h2 className="text-xl font-bold">Access denied</h2>
                <p className="text-sm text-slate-400 mt-2">You do not have permission to view this report.</p>
              </div>
            )
          ) : (
            <div className="bg-white rounded-xl border p-10 text-center">
              <h2 className="text-xl font-bold">
                {page}
              </h2>

              <p className="text-sm text-slate-400 mt-2">
                Module will be connected
                to the onePOS API.
              </p>
            </div>
          )}
      </AdminShell>

      {/* Non-blocking new-online-order notification (never blocks the UI). */}
      {onlineOrderToast && (
        <button
          onClick={openOnlineOrders}
          className="fixed top-20 right-6 z-50 bg-white border border-slate-200 shadow-lg rounded-lg px-4 py-3 text-sm text-left hover:border-blue-400"
        >
          <span className="flex items-start gap-2">
            <Bell size={16} className="text-blue-600 mt-0.5" />
            <span>
              <span className="font-medium">{onlineOrderToast.message}</span>
              {onlineOrderToast.externalOrderId ? (
                <span className="block text-xs text-slate-500 mt-0.5">
                  Order {onlineOrderToast.externalOrderId} - click to view
                </span>
              ) : (
                <span className="block text-xs text-slate-500 mt-0.5">Click to open Online Orders</span>
              )}
            </span>
            <X
              size={14}
              className="text-slate-400 ml-2 mt-0.5"
              onClick={(event) => {
                event.stopPropagation();
                setOnlineOrderToast(null);
              }}
            />
          </span>
        </button>
      )}
      <BottomStatusBar storeName="London Store" />
    </div>
  );
}
