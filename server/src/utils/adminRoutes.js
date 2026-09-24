/*
 * T10V — persistent URL routing for the admin/application pages.
 *
 * Every major page gets a stable URL under /app/<slug> using the browser's
 * native history API (the same mechanism the app already uses for /login
 * and /app). No router library is introduced — the app is a two-view
 * application (till / admin) whose "routes" are the admin pages themselves:
 *
 *   /app                  -> the till (POS), the default landing view
 *   /app/dashboard        -> admin Dashboard
 *   /app/sales            -> Sales
 *   /app/returns          -> Returns
 *   /app/supplier-returns -> Supplier Returns
 *   /app/products         -> Products
 *   /app/global-products  -> Global Products
 *   /app/categories       -> Categories
 *   /app/purchases        -> Purchases
 *   /app/suppliers        -> Suppliers
 *   /app/inventory        -> Inventory
 *   /app/replenishment    -> Replenishment
 *   /app/customers        -> Customers
 *   /app/employees        -> Employees
 *   /app/stores           -> Stores
 *   /app/payments         -> Payments
 *   /app/order-prep       -> Order Prep
 *   /app/online-orders    -> Online Orders
 *   /app/integrations     -> Integrations
 *   /app/accounting       -> Accounting
 *   /app/reports          -> Reports (Overview)
 *   /app/reports/<report> -> an individual granular report
 *   /app/settings         -> Settings (General tab)
 *   /app/settings/<tab>   -> Settings on a specific section tab
 *
 * Permissions are NOT encoded here: the renderer keeps enforcing the
 * existing permission model (dock visibility, per-report canViewReport,
 * per-tab settings gating). A deep link to a page the user cannot access
 * resolves through the exact same permission gates as clicking its nav
 * entry — including the existing Access-denied panels.
 */

/** Page title -> URL slug. Slugs are stable, lowercase, hyphenated. */
export const PAGE_SLUGS = {
  Dashboard: "dashboard",
  Dashboards: "dashboards",
  Sales: "sales",
  Returns: "returns",
  "Supplier Returns": "supplier-returns",
  Products: "products",
  "Global Products": "global-products",
  Categories: "categories",
  Purchases: "purchases",
  Suppliers: "suppliers",
  Inventory: "inventory",
  Replenishment: "replenishment",
  Customers: "customers",
  Employees: "employees",
  Stores: "stores",
  Payments: "payments",
  "Order Prep": "order-prep",
  "Online Orders": "online-orders",
  Integrations: "integrations",
  Accounting: "accounting",
  Reports: "reports",
  Settings: "settings",
   Licensing: "licensing",
   "Audit Log": "audit",
};

export const SLUG_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_SLUGS).map(([page, slug]) => [slug, page])
);

/** Settings section tabs that can appear as /app/settings/<tab-slug>. */
export const SETTINGS_TAB_SLUGS = {
  General: "general",
  Company: "company",
  Appearance: "appearance",
  "Store & Till": "store-till",
  "Tax / VAT": "tax-vat",
  Receipts: "receipts",
  "Payment Terminals": "payment-terminals",
  "Customer Loyalty": "customer-loyalty",
  Hardware: "hardware",
  Users: "users",
  "Roles & Permissions": "roles-permissions",
  Connections: "connections",
  "Uber Eats": "uber-eats",
  Deliveroo: "deliveroo",
  WhatsApp: "whatsapp",
  "SMS Delivery": "sms-delivery",
  "Email Delivery": "email-delivery",
  /* System / device-level configuration. */
  "Server / API Configuration": "server-api",
  Platform: "platform",
  "Message Templates": "message-templates",
  /* Legacy sections (pre left-panel navigation) - kept so existing deep
     links still resolve; the Settings page redirects them internally. */
  "Users & Permissions": "users-permissions",
  "Online Platforms": "online-platforms",
  Integrations: "integrations",
};

export const SETTINGS_SLUG_TO_TAB = Object.fromEntries(
  Object.entries(SETTINGS_TAB_SLUGS).map(([tab, slug]) => [slug, tab])
);

/**
 * THE generic runtime route for configured Platform Object pages.
 *
 * ONE path pattern serves every configured Object — no physical React route is
 * generated per Object and no per-Object component is created. The same string
 * is used by the server payload (services/platformObjectNavigation.js); the two
 * copies are pinned together by tests so they cannot drift.
 */
export const OBJECT_PATH_PREFIX = "/app/objects/";
export const CUSTOM_PAGE_PATH_PREFIX = "/app/pages/";

export function buildCustomPagePath(pageKey) {
  const key = String(pageKey || "").trim();
  return key ? `${CUSTOM_PAGE_PATH_PREFIX}${encodeURIComponent(key)}` : "/app";
}

export function buildObjectPath(objectKey) {
  const key = String(objectKey || "").trim();
  return key ? `${OBJECT_PATH_PREFIX}${encodeURIComponent(key)}` : "/app";
}

/**
 * Parses a location.pathname into a routing intent.
 *
 * Returns one of:
 *   { view: "admin", page, settingsTab?, reportKey? }
 *   { view: "pos" }                       — /app (or /app/)
 *   { view: "object", objectKey }         — /app/objects/<objectKey>
 *   { view: "unknown", slug }             — unrecognised /app/<slug>
 */
export function parseAppPath(pathname) {
  const clean = String(pathname || "").replace(/\/+$/, "");
  const prefix = "/app";
  if (clean !== prefix && !clean.startsWith(`${prefix}/`)) return null;
  const rest = clean.slice(prefix.length).replace(/^\//, "");
  if (!rest) return { view: "pos" };

  const [head, ...tail] = rest.split("/").filter(Boolean);
  const sub = tail.join("/");

  if (head === "settings") {
    if (!sub) return { view: "admin", page: "Settings", settingsTab: null };
    const tab = SETTINGS_SLUG_TO_TAB[sub];
    if (!tab) return { view: "unknown", slug: rest };
    return { view: "admin", page: "Settings", settingsTab: tab };
  }
  if (head === "pages") {
    if (!sub) return { view: "unknown", slug: rest };
    return { view: "custom_page", pageKey: decodeURIComponent(sub) };
  }
  if (head === "objects") {
    /* The caller resolves the key against its permitted configured pages; an
       unknown/unpermitted key is refused by the runtime API regardless. */
    if (!sub) return { view: "unknown", slug: rest };
    return { view: "object", objectKey: decodeURIComponent(sub) };
  }
  if (head === "reports") {
    /* The Overview entry is the plain /app/reports page. */
    if (!sub) return { view: "admin", page: "Reports" };
    /* Individual report keys are resolved by the caller against
       REPORT_MENU_ITEMS — this module stays decoupled from the reports UI. */
    return { view: "admin", page: "REPORT", reportKey: decodeURIComponent(sub) };
  }

  const page = SLUG_TO_PAGE[head];
  if (!page || tail.length) return { view: "unknown", slug: rest };
  return { view: "admin", page };
}

/**
 * Builds the URL for a page. Unknown values fall back to /app so a stray
 * page title can never produce a broken URL.
 */
export function buildAppPath(page, options = {}) {
  /* A configured page carries its own route (the generic object runtime). */
  if (options.route) return options.route;
  if (page === "Settings" && options.settingsTab) {
    const slug = SETTINGS_TAB_SLUGS[options.settingsTab];
    if (slug && slug !== "general") return `/app/settings/${slug}`;
    return "/app/settings";
  }
  if (!PAGE_SLUGS[page]) return "/app";
  return `/app/${PAGE_SLUGS[page]}`;
}
