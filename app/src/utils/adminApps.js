/*
 * onePOS Admin — module/app switcher + metadata-driven navigation groups.
 *
 * PURE presentation logic: it consumes the EXISTING sources of truth and
 * never decides access on its own.
 *
 *   - Installed/available modules come from /api/platform/runtime/app-catalog
 *     (the SAME response AdminLayout already uses to filter its navigation —
 *     it enforces installed, company enablement, package install status,
 *     licence entitlement and the caller's role permissions server-side).
 *   - Permission-filtered page items are computed in AdminLayout exactly as
 *     before (canViewReport / permission codes / isAdmin bypass).
 *
 * This module only GROUPS and LABELS what is already visible. If a module is
 * not in the catalog it cannot appear here; if a user lacks a permission the
 * item never reaches this code.
 */

/* Display metadata for the switcher, keyed by the canonical catalog module
 * key (services/internalAppCatalog.js). Names are onePOS's own. */
const APP_META = {
  retail_pos: { name: "POS & Sales", description: "Till sales, payments and returns.", route: "/app/sales" },
  products: { name: "Products", description: "Catalogue and categories.", route: "/app/products" },
  inventory: { name: "Inventory", description: "Stock and replenishment.", route: "/app/inventory" },
  customers: { name: "Customers", description: "Customer records and loyalty.", route: "/app/customers" },
  suppliers: { name: "Suppliers", description: "Supplier records and purchasing.", route: "/app/suppliers" },
  staff: { name: "Staff", description: "Employees, roles and stores.", route: "/app/employees" },
  reports: { name: "Reports", description: "Operational and configurable reports.", route: "/app/reports" },
  online_orders: { name: "Online Orders", description: "Online order intake and prep.", route: "/app/order-prep" },
  integrations: { name: "Integrations", description: "Delivery, payment and comms connections.", route: "/app/integrations" },
  platform: { name: "Platform", description: "Objects, apps and automation administration.", route: "/app/settings/platform" },
};

/** Route for a catalog entry (definition overrides have priority). */
function appRoute(entry) {
  return (entry && (entry.route || entry.metadata?.route)) || APP_META[entry?.module_key]?.route || null;
}

/**
 * Build the app switcher entries from the runtime catalog.
 *
 * @param {Array|null} catalogKeysOrEntries - the module keys Set the layout
 *   already loaded, or the raw catalog entries; null → empty switcher (the
 *   catalog has not loaded or failed — never invent modules).
 * @returns {Array<{key,name,description,route}>}
 */
export function buildSwitcherApps(catalogKeysOrEntries) {
  if (!catalogKeysOrEntries) return [];
  if (catalogKeysOrEntries instanceof Set) {
    return [...catalogKeysOrEntries]
      .map((key) => ({ key, name: APP_META[key]?.name || key, description: APP_META[key]?.description || "", route: APP_META[key]?.route || null }))
      .filter((a) => a.name);
  }
  if (!Array.isArray(catalogKeysOrEntries)) return [];
  return catalogKeysOrEntries
    .map((entry) => ({
      key: entry?.module_key || entry?.key,
      name: entry?.name || APP_META[entry?.module_key]?.name || entry?.module_key || entry?.key,
      description: entry?.description || APP_META[entry?.module_key]?.description || "",
      route: appRoute(entry),
    }))
    .filter((a) => a.key && a.name);
}

/**
 * Group the permission-filtered admin page items into professional sidebar
 * sections. `items` is the SAME [page, icon] list the Dockbar receives —
 * grouped here for display only; visibility was already decided upstream.
 *
 * Unknown/future pages are not dropped: they fall into a trailing
 * "Workspace" group so a new page is still reachable after grouping.
 */
export function groupNavItems(items) {
  const GROUPS = [
    { label: "General", pages: ["Dashboard"] },
    { label: "Operations", pages: ["Sales", "Returns", "Supplier Returns", "Order Prep", "Payments", "Online Orders"] },
    { label: "Catalogue & Supply", pages: ["Products", "Global Products", "Categories", "Purchases", "Suppliers", "Inventory", "Replenishment"] },
    { label: "Business", pages: ["Customers", "Employees", "Stores"] },
    /* The configurable Dashboards builder is a first-class INSIGHTS entry.
       It stays separate from the operational "Dashboard" under General — the
       consolidation audit confirmed they are different products. Configured
       Platform Object pages and any other future page still fall through to
       the trailing "Workspace" group below. */
    { label: "Insights", pages: ["Dashboards", "Reports", "My Reports"] },
    { label: "Administration", pages: ["Integrations", "Accounting", "Audit Log", "Licensing", "Settings"] },
  ];
  const remaining = [...items];
  const groups = [];
  for (const group of GROUPS) {
    const members = [];
    for (const page of group.pages) {
      const index = remaining.findIndex(([name]) => name === page);
      if (index !== -1) {
        members.push(remaining[index]);
        remaining.splice(index, 1);
      }
    }
    if (members.length) groups.push({ label: group.label, items: members });
  }
  /* Anything the fixed groups did not place (future pages, custom pages). */
  if (remaining.length) groups.push({ label: "Workspace", items: remaining });
  return groups;
}

export default { buildSwitcherApps, groupNavItems };
