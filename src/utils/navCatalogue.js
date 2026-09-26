/*
 * ONE canonical application page catalogue.
 *
 * Every shell resolves its navigation from THIS module — the admin shell
 * (dashboard, settings, objects, reports), the Till/POS and the Custom Page
 * runtime — so a page can never be visible in one shell and hidden in another:
 *
 *   session permissions  (/api/auth/me/permissions)
 *              +
 *   module catalogue      (/api/platform/runtime/app-catalog)
 *              ↓
 *   permittedNavItems() + filterNavigationByCatalog()
 *              ↓
 *   components/DockHost.jsx → components/AdminNavDock.jsx  (ONE dock)
 *
 * Presentation only. Navigation is discoverability, never the security
 * boundary: every endpoint keeps enforcing its own authorization, and a page
 * a caller may not open simply never reaches the dock.
 */
import {
  BarChart3,
  Bell,
  Calculator,
  CreditCard,
  Database,
  FileText,
  Grid3X3,
  Home,
  KeyRound,
  Package,
  Plug,
  Receipt,
  RefreshCw,
  Settings,
  ShoppingBag,
  Store,
  Tag,
  Users,
} from "lucide-react";
import { apiRequest } from "../services/api.js";

/*
 * The catalogue owns module definitions; this small adapter only maps the
 * existing navigation labels to those definitions. Routes and permissions
 * remain owned by the page catalogue and the backend respectively.
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
    if (moduleKey === undefined) return true;
    return catalogKeys.has(moduleKey);
  });
}

/*
 * THE application page list: [page, Icon, gate]. Order is the order every
 * shell renders (dock launcher, sidebar groups, custom-page dock), and the
 * gates mirror the server's authorize() model exactly — Administrator/Owner
 * roles bypass via isAdmin, every other role needs the seeded permission
 * code(s).
 */
const NAV_CATALOGUE = [
  ["Dashboard", Home],
  ["Dashboards", BarChart3, (state) => state.isAdmin || state.permissions.includes("reports.custom.view")],
  ["Sales", FileText],
  /* T9M-SMALL: Returns respects the existing permission system —
   * returns.view/returns.create for restricted roles, admin bypass. */
  ["Returns", RefreshCw, (state) => state.isAdmin
    || state.permissions.includes("returns.view")
    || state.permissions.includes("returns.create")],
  ["Supplier Returns", RefreshCw, (state) => state.isAdmin || state.permissions.includes("returns.create")],
  ["Products", Package],
  ["Global Products", Database],
  ["Categories", Tag],
  ["Purchases", Receipt],
  ["Suppliers", Users],
  ["Inventory", Grid3X3],
  ["Replenishment", Bell, (state) => state.isAdmin
    || state.permissions.includes("inventory.replenishment.view")
    || state.permissions.includes("inventory.view")
    || state.permissions.includes("reports.low_stock.view")],
  ["Customers", Users],
  ["Employees", Users],
  ["Stores", Store],
  /* T10-AUDIT: Audit Log — gated by the audit.view permission (admin bypass). */
  ["Audit Log", FileText, (state) => state.isAdmin || state.permissions.includes("audit.view")],
  ["Payments", CreditCard],
  ["Order Prep", ShoppingBag, (state) => state.isAdmin || state.permissions.includes("online_orders.view")],
  /* T9F/T9O: Integration management + Accounting — existing permission system. */
  ["Integrations", Plug, (state) => state.isAdmin || state.permissions.includes("integration.manage")],
  ["Accounting", Calculator, (state) => state.isAdmin || state.permissions.includes("integration.manage")],
  /* Settings — reachable by EVERY signed-in user, matching the existing
     Settings surface's own authorization model: SettingsAdmin always prepends
     the per-user "Your account" → Appearance section, so every caller has at
     least one real Settings surface. The company/privileged sections are gated
     INSIDE SettingsAdmin and each endpoint keeps enforcing its own
     authorization, so this entry grants nothing on its own. */
  ["Settings", Settings],
  ["Reports", BarChart3],
  ["Licensing", KeyRound, (state) => state.isSuperadmin],
];

/** The permission payload shape shared by every shell (never trusted). */
export const EMPTY_PERMISSION_STATE = Object.freeze({ isAdmin: false, isSuperadmin: false, permissions: [] });

export function normalizePermissionState(state) {
  const source = state && typeof state === "object" ? state : {};
  return {
    isAdmin: source.isAdmin === true,
    isSuperadmin: source.isSuperadmin === true,
    permissions: Array.isArray(source.permissions)
      ? source.permissions.filter((code) => typeof code === "string")
      : [],
  };
}

/**
 * The pages this caller may see, in catalogue order.
 * @returns {Array<[string, Function]>}
 */
export function permittedNavItems(state) {
  const normalized = normalizePermissionState(state);
  return NAV_CATALOGUE
    .filter(([, , gate]) => !gate || gate(normalized))
    .map(([page, Icon]) => [page, Icon]);
}

/** Page names only — the dock intersects its saved configuration with these. */
export function permittedNavNames(state) {
  return new Set(permittedNavItems(state).map(([page]) => page));
}

/*
 * ONE cached app-catalogue loader. The response is the SAME bounded payload the
 * admin shell already consumed: installed/enablement/package/licence-filtered
 * module keys plus the lightweight permitted Object page list. Caching it at
 * module level means the dashboard, the till and a custom page all resolve it
 * from ONE request per session instead of three route-specific ones.
 */
let catalogueSnapshot = null;
let catalogueInFlight = null;
const catalogueListeners = new Set();

export function appCatalogueSnapshot() {
  return catalogueSnapshot;
}

export function subscribeAppCatalogue(listener) {
  catalogueListeners.add(listener);
  return () => catalogueListeners.delete(listener);
}

function publishCatalogue(next) {
  catalogueSnapshot = next;
  for (const listener of catalogueListeners) {
    try { listener(next); } catch { /* isolate subscribers */ }
  }
}

export function loadAppCatalogue() {
  if (catalogueSnapshot) return Promise.resolve(catalogueSnapshot);
  if (catalogueInFlight) return catalogueInFlight;
  catalogueInFlight = apiRequest("/api/platform/runtime/app-catalog")
    .then((response) => {
      const entries = Array.isArray(response?.data) ? response.data : [];
      const next = {
        /* A catalogue that has not loaded (or failed) never hides the existing
           navigation — the filter is inert until keys is a Set. */
        keys: response?.success && Array.isArray(response.data)
          ? new Set(entries.map((entry) => entry?.module_key || entry?.key).filter(Boolean))
          : null,
        entries,
        objectPages: Array.isArray(response?.objectPages) ? response.objectPages : [],
      };
      publishCatalogue(next);
      return next;
    })
    .catch(() => null)
    .finally(() => { catalogueInFlight = null; });
  return catalogueInFlight;
}

/** Drops the cached catalogue (tests and explicit re-resolution). */
export function resetNavCatalogueCache() {
  catalogueSnapshot = null;
  catalogueInFlight = null;
}
