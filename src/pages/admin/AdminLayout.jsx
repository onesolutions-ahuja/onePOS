import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Bell, Settings, X } from "lucide-react";

import { apiRequest } from "../../services/api.js";

import { parseAppPath, buildAppPath, buildObjectRecordPath, PAGE_SLUGS } from "../../utils/adminRoutes.js";

import { buildSwitcherApps } from "../../utils/adminApps.js";

import {

  OBJECT_PAGE_KEY,

  buildConfiguredNavigation,

} from "../../utils/platformObjectNavigation.js";

import { permittedNavItems } from "../../utils/navCatalogue.js";

import { normalizePreferences, preferencesDiffer } from "../../utils/adminPreferences.js";

import {

  loadCachedPreferences,

  fetchPreferences,

  savePreferences,

} from "../../services/adminPreferencesService.js";

import BottomStatusBar from "../../components/BottomStatusBar.jsx";

import AdminNavDock from "../../components/AdminNavDock.jsx";

import AdminShell from "../../components/AdminShell.jsx";

import ChangePasswordModal from "../settings/ChangePasswordModal.jsx";

import AccountOnboardingGate from "../../components/AccountOnboardingGate.jsx";

import ReportPage, { REPORT_MENU_ITEMS } from "../reports/ReportPage.jsx";

// Admin pages are route-level surfaces. Loading them on demand keeps Settings,
// Products, Inventory, Reports, etc. from all being shipped when one page opens.

const Dashboard = lazy(() => import("../dashboard/Dashboard.jsx"));
const DashboardBuilder = lazy(() => import("../dashboard/DashboardBuilder.jsx"));

const ProductsAdmin = lazy(() => import("../products/ProductsAdmin.jsx"));

const GlobalProductsAdmin = lazy(() => import("../products/GlobalProductsAdmin.jsx"));

const CategoriesAdmin = lazy(() => import("../categories/CategoriesAdmin.jsx"));

const InventoryAdmin = lazy(() => import("../inventory/InventoryAdmin.jsx"));

const ReplenishmentAdmin = lazy(() => import("../inventory/ReplenishmentAdmin.jsx"));

const SettingsAdmin = lazy(() => import("../settings/SettingsAdmin.jsx"));

const SuppliersAdmin = lazy(() => import("../suppliers/SuppliersAdmin.jsx"));

const IntegrationsAdmin = lazy(() => import("../integrations/IntegrationsAdmin.jsx"));

const AccountingAdmin = lazy(() => import("../integrations/AccountingAdmin.jsx"));

const PurchasesAdmin = lazy(() => import("../purchases/PurchasesAdmin.jsx"));

const SalesAdmin = lazy(() => import("../sales/SalesAdmin.jsx"));

const ReportsAdmin = lazy(() => import("../reports/ReportsAdmin.jsx"));

const CustomReportsAdmin = lazy(() => import("../reports/CustomReportsAdmin.jsx"));

const ReturnsAdmin = lazy(() => import("../returns/ReturnsAdmin.jsx"));

const SupplierReturnsAdmin = lazy(() => import("../returns/ReturnsAdmin.jsx").then((m) => ({ default: m.SupplierReturnsAdmin })));

const CustomersAdmin = lazy(() => import("../customers/CustomersAdmin.jsx"));

const OnlineOrdersAdmin = lazy(() => import("../online/OnlineOrdersAdmin.jsx"));

const OnlineOrdersPrep = lazy(() => import("../online/OnlineOrdersPrep.jsx"));

const StoresAdmin = lazy(() => import("../stores/StoresAdmin.jsx"));

const AttendanceAdmin = lazy(() => import("../employees/AttendanceAdmin.jsx"));

const LicensingAdmin = lazy(() => import("../superadmin/LicensingAdmin.jsx"));

const ObjectPage = lazy(() => import("../settings/Platform/ObjectPage.jsx"));

const AuditLogAdmin = lazy(() => import("../audit/AuditLogAdmin.jsx"));



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

function pathForPage(nextPage, settingsTab = null, route = null) {

  if (nextPage === "My Reports") return "/app/reports/custom";

  if (nextPage === "Dashboards") return "/app/dashboards";

  if (REPORT_MENU_ITEMS.some((item) => item.key === nextPage)) {

    return `/app/reports/${slugifyReportKey(nextPage)}`;

  }

  /* Configured Platform Object pages announce their own route (the generic

     object runtime) instead of getting a physical route per Object. */

  if (route) return buildAppPath(nextPage, { route });

  return buildAppPath(nextPage, { settingsTab });

}



/*

 * The catalogue owns module definitions and the shared page list lives in

 * utils/navCatalogue.js, so the admin shell and the till can never disagree

 * about which pages exist.

 */



export const CATALOG_MODULE_BY_PAGE = {
  Dashboard: "retail_pos",
  Dashboards: "reports",
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

  /*

   * Configured Platform Object pages → navigation. Populated from the SAME

   * bounded runtime payload the module catalogue rides in; the server has

   * already applied company → module/licence → object permission → user

   * permission → device profile. This map NEVER grants access: it only labels

   * what the server already allowed. The ref keeps resolveRoute/navigate able

   * to read the latest map without being re-created on every payload change.

   */

  const objectNavRef = useRef({ pages: [], items: [], routes: {}, objects: {}, byObjectKey: {} });



  const resolveRoute = () => {

    const parsed = parseAppPath(window.location.pathname);

    if (!parsed) return { page: initialPage, settingsTab: initialSettingsTab, reportKey: initialReportKey, valid: true };

    if (parsed.view === "pos") return { page: "Dashboard", settingsTab: null, reportKey: null, valid: true };

    if (parsed.view === "unknown") return { page: initialPage, settingsTab: initialSettingsTab, reportKey: initialReportKey, valid: false };

    /* The ONE generic Object runtime route. When the permitted page list has

       not arrived yet (or the caller may not see this Object) the URL is held

       rather than rewritten, so a deep link is never collapsed to /app before

       the payload loads. */

    if (parsed.view === "object") {

      const target = objectNavRef.current.byObjectKey[parsed.objectKey];

      if (target) return { page: target.label, settingsTab: null, reportKey: null, valid: true };

      return { page: OBJECT_PAGE_KEY, settingsTab: null, reportKey: null, valid: true, view: "object", objectKey: parsed.objectKey };

    }

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

  const [settingsTab, setSettingsTab] = useState(() => resolveRoute().settingsTab || "General");

  /* Signed-in user's canonical Platform Object record. Declared before any
     hook that references it to avoid a temporal-dead-zone crash in production. */
  const [profileRecord, setProfileRecord] = useState(null);



  /* Apply the URL's settings tab / report deep link once permissions state

     exists, then normalise an invalid path to the resolved page's URL. */

  useEffect(() => {

    const route = pendingRoute.current;

    if (route.page === "Settings") setSettingsTab(route.settingsTab || "General");

    /* An Object deep link keeps its own URL until the permitted page list

       arrives; the resolution effect below finishes that hand-off. */

    if (route.view === "object") return;

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

    /* A configured Object page announces its own generic runtime route. */

    const route = objectNavRef.current.routes[nextPage] || null;

    const target = pathForPage(nextPage, options.settingsTab || (nextPage === "Settings" ? settingsTab : null), route);

    if (window.location.pathname !== target) {

      window.history.pushState({}, "", target);

    }

    /* eslint-disable-next-line react-hooks/exhaustive-deps */

  }, [settingsTab]);



  /* Browser Back/Forward: re-resolve the page from the history entry. A

     /app/objects/.../records/... entry re-opens the user's OWN record through

     the same profile feed; anything else clears the profile view. */

  useEffect(() => {

    const onPopState = () => {

      const parsed = parseAppPath(window.location.pathname);

      if (parsed?.view === "object" && parsed.objectKey === profileRecord?.objectKey && parsed.recordId && String(parsed.recordId) === String(profileRecord?.recordId)) {

        setPage(OBJECT_PAGE_KEY);

        return;

      }

      if (profileRecord) setProfileRecord(null);

      const route = resolveRoute();

      setPage(route.page);

      if (route.page === "Settings") setSettingsTab(route.settingsTab || "General");

    };

    window.addEventListener("popstate", onPopState);

    return () => window.removeEventListener("popstate", onPopState);

    /* eslint-disable-next-line react-hooks/exhaustive-deps */

  }, [profileRecord]);



  /* Top-right Reset Password dialog (T10Y-followup) — opened from the shell

     profile menu; the profile menu itself now lives in AdminShell. */

  const [resetPwOpen, setResetPwOpen] = useState(false);



  /*

   * PROFILE → MY RECORD. The canonical record-page architecture has ONE route

   * for every Object record: /app/objects/<objectKey>/records/<recordId>. The

   * profile resolves the signed-in user's own users-backed record through the

   * ONE runtime feed (GET /api/platform/runtime/my-record) and opens it with

   * the SAME generic object runtime (view mode) — no ad hoc profile page, no

   * second record view, no navigation to the Users list.

   */


  const openOwnRecord = useCallback(async () => {

    try {

      const result = await apiRequest("/api/platform/runtime/my-record");

      const data = result?.data;

      if (!data?.objectKey || !data?.record?.id) return;

      setProfileRecord({

        object: data.object,

        record: data.record,

        fields: Array.isArray(data.fields) ? data.fields : null,

        objectKey: data.objectKey,

        recordId: data.record.id,

      });

      setPage(OBJECT_PAGE_KEY);

      const target = buildObjectRecordPath(data.objectKey, data.record.id);

      if (window.location.pathname !== target) {

        window.history.pushState({}, "", target);

      }

    } catch {

      /* The runtime API stays authoritative; without a resolvable own record

         the shell keeps the current page instead of guessing a fallback. */

    }

  }, []);



  const [onlinePermissions, setOnlinePermissions] = useState({ isAdmin: false, permissions: [], entitlements });

  const [reportsLoaded, setReportsLoaded] = useState(false);

  /* null means the runtime catalogue has not loaded or failed; in either case

     retain the existing permission-filtered navigation as the safe fallback. */

  const [catalogKeys, setCatalogKeys] = useState(null);

  /* Raw runtime catalog entries for the app switcher (same response; the

     switcher presents only what the server already authorised). */

  const [catalogEntries, setCatalogEntries] = useState([]);

  /*

   * Permitted configured Platform Object pages (lightweight navigation data

   * only) — one bounded payload alongside the module catalogue, never a second

   * request per Object and never full Object metadata.

   */

  const [objectPages, setObjectPages] = useState([]);

  /* Distinguishes "still loading" from "nothing permitted", so a denied deep

   * link is only reported after the payload has actually arrived. */

  const [objectNavLoaded, setObjectNavLoaded] = useState(false);

  /* T10W: dock quick-access pages configured in Settings → Store & Till.

     null = not loaded yet → the dock falls back to its default layout. */

  /* The dock's quick-access configuration is owned by the canonical dock

     runtime (utils/dockConfiguration.js + components/AdminNavDock.jsx), so the

     admin shell, the till and custom pages all read the SAME saved list. */

  useEffect(() => {

    let alive = true;

    apiRequest("/api/platform/runtime/app-catalog")

      .then((data) => {

        if (!alive) return;

        if (Array.isArray(data?.objectPages)) setObjectPages(data.objectPages);

        if (!data?.success || !Array.isArray(data.data)) {

          setObjectNavLoaded(true);

          return;

        }

        setCatalogKeys(new Set(data.data.map((entry) => entry?.module_key || entry?.key).filter(Boolean)));

        setCatalogEntries(data.data);

        setObjectNavLoaded(true);

      })

      .catch(() => {

        /* Catalogue availability must never blank the existing navigation. */

        if (alive) setCatalogKeys(null);

        if (alive) setObjectNavLoaded(true);

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

  const canViewReturns =
    onlinePermissions.isAdmin ||
    onlinePermissions.permissions.includes("returns.view") ||
    onlinePermissions.permissions.includes("returns.create");

  const canViewSupplierReturns =
    onlinePermissions.isAdmin ||
    onlinePermissions.permissions.includes("returns.create");

  const canViewReplenishment =
    onlinePermissions.isAdmin ||
    onlinePermissions.permissions.includes("inventory.replenishment.view") ||
    onlinePermissions.permissions.includes("inventory.view") ||
    onlinePermissions.permissions.includes("reports.low_stock.view");

  const canViewIntegrations =
    onlinePermissions.isAdmin ||
    onlinePermissions.permissions.includes("integration.manage");


  /* Non-blocking online-order notifications (Uber Eats / Deliveroo). */
  const [onlineOrderCount, setOnlineOrderCount] = useState(0);

  const [onlineOrderToast, setOnlineOrderToast] = useState(null);

  /* The badge poll needs the SAME permission the endpoint enforces
     (online_orders.view). Without it every poll 403s and spams the console —
     so unauthorized callers simply never start polling. */
  const canPollOnlineOrders =
    onlinePermissions.isAdmin || onlinePermissions.permissions.includes("online_orders.view");



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

      /* A single unexpected failure is logged; repeated authorization
         failures are not — the poll is permission-gated above, so this only
         fires for genuine transport/server errors. */
      if (!String(error?.message || "").includes("uthorization")) {
        console.error("Load online order count error:", error);
      }
    }

  }, []);



  useEffect(() => {

    if (!canPollOnlineOrders) return undefined;

    loadOnlineOrderCount();

    const timer = setInterval(loadOnlineOrderCount, 15000);

    return () => clearInterval(timer);

  }, [loadOnlineOrderCount, canPollOnlineOrders]);



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



  /*

   * Page names ALREADY owned by the built-in navigation.

   *

   * A configured Platform Object page whose label collides with one of these is

   * skipped by buildConfiguredNavigation(), so navigation metadata can never

   * quietly take over a specialised operational destination (Products,

   * Customers, Inventory …). The reservation list is the built-in route

   * registry itself, not a hand-maintained copy.

   */

  const reservedNavLabels = useMemo(

    () => [...Object.keys(PAGE_SLUGS), ...REPORT_MENU_ITEMS.map((item) => item.key), "My Reports"],

    []

  );



  /*

   * Configured Object pages merged into the SAME navigation the Dock and the

   * sidebar already render. One source of truth, no parallel menu and no

   * per-Object component: every entry points at the ONE generic runtime route.

   */

  const configuredNavigation = useMemo(

    () => buildConfiguredNavigation({ objectPages, reservedLabels: reservedNavLabels }),

    [objectPages, reservedNavLabels]

  );

  objectNavRef.current = configuredNavigation;



  /*

   * Object deep-link hand-off: /app/objects/<key> resolves to the permitted

   * page once the payload is known. A key the caller may not see stays on the

   * access-denied placeholder — the runtime API refuses it independently, so

   * hiding the menu is never the security boundary.

   */

  useEffect(() => {

    const parsed = parseAppPath(window.location.pathname);

    if (parsed?.view !== "object") return;

    /* A record deep link (/app/objects/<key>/records/<id>) opens ONE record

       of a permitted object through the generic record-page runtime. The

       canonical feed validates the caller's access server-side — the user's

       own record via my-record, any other permitted record via the generic

       record-page feed — so a forged or cross-company id simply 403/404s and

       the shell stays where it is (the same safe refusal as before). */

    if (parsed.recordId) {

      const isOwnProfileLink = profileRecord

        && parsed.objectKey === profileRecord?.objectKey

        && String(profileRecord.recordId) === String(parsed.recordId);

      if (isOwnProfileLink) {

        setPage(OBJECT_PAGE_KEY);

        return;

      }

      apiRequest(`/api/platform/runtime/record-page?objectKey=${encodeURIComponent(parsed.objectKey)}&recordId=${encodeURIComponent(parsed.recordId)}`)

        .then((result) => {

          const data = result?.data;

          if (data?.objectKey && data?.record?.id) {

            setProfileRecord({ object: data.object, record: data.record, fields: Array.isArray(data.fields) ? data.fields : null, objectKey: data.objectKey, recordId: data.record.id });

            setPage(OBJECT_PAGE_KEY);

          }

        })

        .catch(() => { /* the feed refuses records this caller may not open */ });

      return;

    }

    const target = configuredNavigation.byObjectKey[parsed.objectKey];

    if (!target) {

      if (objectNavLoaded) setPage(OBJECT_PAGE_KEY);

      return;

    }

    setPage(target.label);

    if (window.location.pathname !== target.route) {

      window.history.replaceState({}, "", target.route);

    }

  }, [configuredNavigation, objectNavLoaded, profileRecord]);



  /* THE permitted page catalogue (utils/navCatalogue.js) — the SAME list the

     till and custom pages resolve, so a page can never be reachable in one

     shell and hidden in another. */

  const permissionFilteredItems = [
    ...permittedNavItems(onlinePermissions),
    ["Settings", Settings],
  ];

  const items = [

    ...filterNavigationByCatalog(permissionFilteredItems, catalogKeys),

    ...configuredNavigation.items,

  ];

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

    if (resolved.page === "Settings") setSettingsTab(resolved.settingsTab || "General");

    /* eslint-disable-next-line react-hooks/exhaustive-deps */

  }, []);



  return (

    <div className="h-screen bg-slate-100 flex relative onepos-motion-surface onepos-page-enter">

      {/* NAVIGATION — the existing onePOS floating Dockbar, bottom-centre of

         the status bar. PRESERVED UNCHANGED (functionality, quick access,

         launcher, surface switch). Consumes the SAME permission-filtered items

         list as before, so visibility per user/role is identical. */}

      <AdminNavDock

        items={items}

        /* Permitted configured Platform Object pages — the SAME permission/

           module/tenant-filtered payload the sidebar receives, presented in

           the launcher's own "Objects" group. Dock discovery, not a second

           menu: the dock renders exactly what the server already allowed. */

        objectItems={configuredNavigation.items}

        reportItems={canViewReports ? catalogFilteredReportItems : []}

        page={page}

        onNavigate={navigate}

        /* Settings is in the permitted catalogue for every signed-in user, so

           the fixed far-right destination is always available here. The ONE

           contextual surface switch sits between Apps and Settings: on the

           admin pages it reads "Till" and hands control back to App (same

           exit the old header button used). */

        canOpenSettings

        surface="admin"

        onSwitchSurface={onPOS}

      />



      <ChangePasswordModal open={resetPwOpen} onClose={() => setResetPwOpen(false)} />

      <AccountOnboardingGate />



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

        onOpenProfile={openOwnRecord}

        onlineOrderCount={onlineOrderCount}

        onOpenOnlineOrders={openOnlineOrders}

        user={user}

        storeName="London Store"

      >

        <Suspense fallback={<div className="onepos-route-loading" role="status" aria-live="polite">Loading…</div>}>

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

            "Dashboards" ? (

            <DashboardBuilder />

          ) : page ===

            "Sales" ? (

            <SalesAdmin />

          ) : page ===

            "Returns" ? (

            canViewReturns ? <ReturnsAdmin /> : <div className="bg-white rounded-xl border p-10 text-center"><h2 className="text-xl font-bold">Access denied</h2><p className="text-sm text-slate-400 mt-2">You do not have permission to view returns.</p></div>

          ) : page ===

            "Supplier Returns" ? (

            canViewSupplierReturns ? <SupplierReturnsAdmin /> : <div className="bg-white rounded-xl border p-10 text-center"><h2 className="text-xl font-bold">Access denied</h2><p className="text-sm text-slate-400 mt-2">You do not have permission to view supplier returns.</p></div>

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

            canViewReplenishment ? (
              <ReplenishmentAdmin
                canCreatePurchase={onlinePermissions.isAdmin || onlinePermissions.permissions.includes("purchase.create")}
              />
            ) : (
              <div className="bg-white rounded-xl border p-10 text-center">
                <h2 className="text-xl font-bold">Access denied</h2>
                <p className="text-sm text-slate-400 mt-2">You do not have permission to view replenishment.</p>
              </div>
            )

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

            "Integrations" ? (

            canViewIntegrations ? <IntegrationsAdmin /> : <div className="bg-white rounded-xl border p-10 text-center"><h2 className="text-xl font-bold">Access denied</h2><p className="text-sm text-slate-400 mt-2">You do not have permission to manage integrations.</p></div>

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

            <SettingsAdmin initialTab={settingsTab} isAdmin={onlinePermissions.isAdmin} onTabChange={(tab) => navigate("Settings", { settingsTab: tab })} user={user} isSuperadmin={onlinePermissions.isSuperadmin} entitlements={onlinePermissions.entitlements} />

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

            canViewCustomReports ? (

              <CustomReportsAdmin />

            ) : (

              <div className="bg-white rounded-xl border p-10 text-center">

                <h2 className="text-xl font-bold">Access denied</h2>

                <p className="text-sm text-slate-400 mt-2">You do not have permission to view custom reports.</p>

              </div>

            )

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

          ) : profileRecord ? (

            /* MY PROFILE — the EXISTING generic object runtime rendering the

               signed-in user's own record in view mode. Same object metadata,

               same detail layout, same read-only record page as every other

               Object; only the record and object come pre-supplied. */

            <ObjectPage

              key={`profile-${profileRecord.recordId}`}

              object={profileRecord.object}

              suppliedRecord={profileRecord.record}

              fields={profileRecord.fields}

              onBack={() => {

                setProfileRecord(null);

                navigate("Dashboard");

              }}

            />

          ) : configuredNavigation.objects[page] ? (

            /* A permitted configured Platform Object → the EXISTING generic

               object runtime. No per-Object component, no physical route. */

            <ObjectPage

              key={configuredNavigation.objects[page]}

              objectKey={configuredNavigation.objects[page]}

              onBack={() => navigate("Dashboard")}

            />

          ) : page === OBJECT_PAGE_KEY ? (

            objectNavLoaded ? (

              <div className="bg-white rounded-xl border p-10 text-center">

                <h2 className="text-xl font-bold">Object not available</h2>

                <p className="text-sm text-slate-400 mt-2">

                  This Object is not exposed in navigation for your account, or you do not have access to it.

                </p>

              </div>

            ) : (

              <div className="bg-white rounded-xl border p-10 text-center text-sm text-slate-400">

                Loading…

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

        </Suspense>

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
