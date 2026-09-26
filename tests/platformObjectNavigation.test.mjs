import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  OBJECT_NAVIGATION_EXCLUSIONS,
  OBJECT_RUNTIME_ROUTE_PREFIX,
  DEFAULT_OBJECT_NAV_ORDER,
  normalizeObjectPageDefinition,
  objectNavigationEntries,
  objectRuntimeRoute,
  sortObjectNavigation,
} from "../services/platformObjectNavigation.js";
import {
  OBJECT_PAGE_KEY,
  buildConfiguredNavigation,
  sanitizeConfiguredPages,
  sortConfiguredPages,
} from "../src/utils/platformObjectNavigation.js";
import {
  DEFAULT_OBJECT_ICON_KEY,
  OBJECT_NAV_ICON_KEYS,
  isKnownObjectIconKey,
  normalizeObjectIconKey,
  resolveObjectNavIcon,
} from "../src/utils/platformObjectIcons.js";
import {
  OBJECT_PATH_PREFIX,
  PAGE_SLUGS,
  buildObjectPath,
  parseAppPath,
} from "../src/utils/adminRoutes.js";
import { groupNavItems } from "../src/utils/adminApps.js";

const layoutSource = readFileSync(new URL("../src/pages/admin/AdminLayout.jsx", import.meta.url), "utf8");
const dockSource = readFileSync(new URL("../src/components/AdminNavDock.jsx", import.meta.url), "utf8");
const catalogueSource = readFileSync(new URL("../src/utils/navCatalogue.js", import.meta.url), "utf8");
const studioSource = readFileSync(
  new URL("../src/pages/settings/Platform/PlatformStudio.jsx", import.meta.url),
  "utf8"
);

/* ------------------------------------------------------------------ *
 * fixtures: one company (c1) with a configured "Vehicles" page
 * ------------------------------------------------------------------ */
function fixtures(overrides = {}) {
  return {
    apps: [{ id: "app1", app_key: "fleet", label: "Fleet", active: true, company_id: "c1" }],
    pages: [
      {
        id: "p1",
        app_id: "app1",
        company_id: "c1",
        page_key: "vehicles",
        label: "Vehicles",
        page_type: "object",
        active: true,
        definition: { objectKey: "vehicle", icon: "car", order: 5 },
      },
    ],
    objects: [
      { id: "o1", object_key: "vehicle", label: "Vehicle", active: true, company_id: "c1", module_id: null },
    ],
    objectPermissions: [{ object_id: "o1", can_view: true }],
    modules: [],
    entitlements: {},
    permissions: [],
    isSuperadmin: false,
    deviceProfile: "admin",
    companyId: "c1",
    ...overrides,
  };
}

const reasonFor = (result, key = "vehicles") => result.excluded.find((entry) => entry.key === key)?.reason;

/* ============================ CUSTOM OBJECT ============================ */

test("a permitted custom Object configured for navigation becomes one Dock entry", () => {
  const { entries } = objectNavigationEntries(fixtures());
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.key, "vehicles");
  assert.equal(entry.label, "Vehicles");
  assert.equal(entry.objectKey, "vehicle");
  assert.equal(entry.icon, "car");
  assert.equal(entry.order, 5);
  /* ONE generic runtime route — never a per-Object physical route. */
  assert.equal(entry.route, "/app/objects/vehicle");
});

test("no developer page is needed per Object: the route is derived from the object key alone", () => {
  assert.equal(objectRuntimeRoute("vehicle"), `${OBJECT_RUNTIME_ROUTE_PREFIX}vehicle`);
  assert.equal(objectRuntimeRoute(""), null);
  assert.equal(buildObjectPath("vehicle"), `${OBJECT_PATH_PREFIX}vehicle`);
  /* Server and client agree on the ONE prefix. */
  assert.equal(OBJECT_RUNTIME_ROUTE_PREFIX, OBJECT_PATH_PREFIX);
});

test("parsing the generic route yields an object view, not a hard-coded page", () => {
  assert.deepEqual(parseAppPath("/app/objects/vehicle"), { view: "object", objectKey: "vehicle" });
  assert.deepEqual(parseAppPath("/app/objects/"), { view: "unknown", slug: "objects" });
});

/* ============================== HIDDEN ================================ */

test("showInNavigation=false keeps the Object out of the Dock", () => {
  const result = objectNavigationEntries(
    fixtures({
      pages: [
        {
          ...fixtures().pages[0],
          definition: { objectKey: "vehicle", showInNavigation: false },
        },
      ],
    })
  );
  assert.deepEqual(result.entries, []);
  assert.equal(reasonFor(result), OBJECT_NAVIGATION_EXCLUSIONS.HIDDEN);
});

test("only an explicit false hides a page: existing pages keep their behaviour", () => {
  assert.equal(normalizeObjectPageDefinition({ objectKey: "vehicle" }).showInNavigation, true);
  assert.equal(normalizeObjectPageDefinition({}).showInNavigation, true);
  assert.equal(
    normalizeObjectPageDefinition({ objectKey: "vehicle", showInNavigation: false }).showInNavigation,
    false
  );
});

/* ============================ PERMISSIONS ============================= */

test("no Object permission means no Dock entry", () => {
  const result = objectNavigationEntries(fixtures({ objectPermissions: [] }));
  assert.deepEqual(result.entries, []);
  assert.equal(reasonFor(result), OBJECT_NAVIGATION_EXCLUSIONS.NOT_PERMITTED);
});

test("a declared permission code gates the entry using dotted codes", () => {
  const definition = { objectKey: "vehicle", permissions: ["vehicle.manage"] };
  const page = { ...fixtures().pages[0], definition };

  const denied = objectNavigationEntries(fixtures({ pages: [page] }));
  assert.deepEqual(denied.entries, []);
  assert.equal(reasonFor(denied), OBJECT_NAVIGATION_EXCLUSIONS.NOT_PERMITTED);

  const granted = objectNavigationEntries(fixtures({ pages: [page], permissions: ["vehicle.manage"] }));
  assert.deepEqual(granted.entries.map((entry) => entry.key), ["vehicles"]);
});

test("dotted permission codes survive normalization (regression: they are not identifiers)", () => {
  const definition = normalizeObjectPageDefinition({
    objectKey: "vehicle",
    permissions: ["reports.custom.view", "audit.view"],
  });
  assert.deepEqual(definition.permissions, ["reports.custom.view", "audit.view"]);
  /* Anything that is not a permission code is still dropped. */
  assert.deepEqual(normalizeObjectPageDefinition({ permissions: ["../etc/passwd", "<script>"] }).permissions, undefined);
});

test("a deep link without access is excluded, so hiding a menu item is never the boundary", () => {
  /* The navigation payload refuses the page, and the runtime endpoints keep
     enforcing the same object permission independently. */
  const result = objectNavigationEntries(fixtures({ objectPermissions: [{ object_id: "o1", can_view: false }] }));
  assert.deepEqual(result.entries, []);
  assert.equal(result.excluded.length, 1);
});

test("Platform Superadmin keeps access without an object permission row", () => {
  const result = objectNavigationEntries(
    fixtures({ objectPermissions: [], isSuperadmin: true })
  );
  assert.deepEqual(result.entries.map((entry) => entry.key), ["vehicles"]);
});

/* ========================== MODULE / LICENCE ========================== */

test("a disabled owning module removes the entry", () => {
  const result = objectNavigationEntries(
    fixtures({
      objects: [{ ...fixtures().objects[0], module_id: "mod1" }],
      modules: [
        { id: "mod1", module_key: "fleet", company_enabled: false, package_status: "active", package_manifest: {} },
      ],
    })
  );
  assert.deepEqual(result.entries, []);
  assert.equal(reasonFor(result), OBJECT_NAVIGATION_EXCLUSIONS.MODULE_DISABLED);
});

test("an uninstalled package and a missing entitlement both remove the entry", () => {
  const objectWithModule = fixtures({
    objects: [{ ...fixtures().objects[0], module_id: "mod1" }],
  });
  const notInstalled = objectNavigationEntries({
    ...objectWithModule,
    modules: [
      { id: "mod1", module_key: "fleet", company_enabled: true, package_status: null, package_manifest: {} },
    ],
  });
  assert.equal(reasonFor(notInstalled), OBJECT_NAVIGATION_EXCLUSIONS.MODULE_DISABLED);

  const notLicensed = objectNavigationEntries({
    ...objectWithModule,
    modules: [
      {
        id: "mod1",
        module_key: "fleet",
        company_enabled: true,
        package_status: "active",
        package_manifest: { entitlementKey: "fleet_management" },
      },
    ],
    entitlements: {},
  });
  assert.equal(reasonFor(notLicensed), OBJECT_NAVIGATION_EXCLUSIONS.MODULE_DISABLED);

  const licensed = objectNavigationEntries({
    ...objectWithModule,
    modules: [
      {
        id: "mod1",
        module_key: "fleet",
        company_enabled: true,
        package_status: "active",
        package_manifest: { entitlementKey: "fleet_management" },
      },
    ],
    entitlements: { fleet_management: true },
  });
  assert.deepEqual(licensed.entries.map((entry) => entry.key), ["vehicles"]);
});

test("a page may name a module explicitly, and an unknown module key fails closed", () => {
  const unknown = objectNavigationEntries(
    fixtures({
      pages: [{ ...fixtures().pages[0], definition: { objectKey: "vehicle", moduleKey: "ghost" } }],
      modules: [],
    })
  );
  assert.equal(reasonFor(unknown), OBJECT_NAVIGATION_EXCLUSIONS.MODULE_DISABLED);

  const explicit = objectNavigationEntries(
    fixtures({
      pages: [{ ...fixtures().pages[0], definition: { objectKey: "vehicle", moduleKey: "inventory" } }],
      modules: [
        { id: "mod9", module_key: "inventory", company_enabled: true, package_status: "active", package_manifest: {} },
      ],
    })
  );
  assert.deepEqual(explicit.entries.map((entry) => entry.key), ["vehicles"]);
});

/* =========================== DEVICE PROFILE =========================== */

test("a page restricted to another device profile is absent for this caller", () => {
  const page = { ...fixtures().pages[0], definition: { objectKey: "vehicle", profiles: ["till"] } };
  const adminCaller = objectNavigationEntries(fixtures({ pages: [page], deviceProfile: "admin" }));
  assert.deepEqual(adminCaller.entries, []);
  assert.equal(reasonFor(adminCaller), OBJECT_NAVIGATION_EXCLUSIONS.DEVICE_PROFILE);

  const tillCaller = objectNavigationEntries(fixtures({ pages: [page], deviceProfile: "till" }));
  assert.deepEqual(tillCaller.entries.map((entry) => entry.key), ["vehicles"]);
});

test("an undeclared profile serves everyone and malformed profiles are ignored", () => {
  assert.deepEqual(
    objectNavigationEntries(fixtures({ deviceProfile: "till" })).entries.map((entry) => entry.key),
    ["vehicles"]
  );
  assert.equal(
    normalizeObjectPageDefinition({ objectKey: "vehicle", profiles: ["hologram", 7] }).profiles,
    undefined
  );
});

/* ========================== TENANT ISOLATION ========================== */

test("company A's configured Object never appears for company B", () => {
  const result = objectNavigationEntries(fixtures({ companyId: "c2" }));
  assert.deepEqual(result.entries, []);
  assert.equal(reasonFor(result), OBJECT_NAVIGATION_EXCLUSIONS.OTHER_COMPANY);

  /* And the same guard applies to the app owning the page. */
  const foreignApp = objectNavigationEntries(
    fixtures({ apps: [{ id: "app1", app_key: "fleet", label: "Fleet", active: true, company_id: "c2" }] })
  );
  assert.equal(reasonFor(foreignApp), OBJECT_NAVIGATION_EXCLUSIONS.OTHER_COMPANY);
});

/* ================================ ICON ================================ */

test("icon keys resolve to registered components, unknown keys fall back safely", () => {
  assert.ok(OBJECT_NAV_ICON_KEYS.includes("car"));
  assert.ok(isKnownObjectIconKey("car"));
  assert.ok(isKnownObjectIconKey("CAR")); /* normalization is case-insensitive */
  assert.equal(isKnownObjectIconKey("../../evil"), false);
  assert.equal(isKnownObjectIconKey(""), false);
  assert.equal(isKnownObjectIconKey(null), false);

  const fallback = resolveObjectNavIcon("../../evil");
  assert.equal(fallback, resolveObjectNavIcon(DEFAULT_OBJECT_ICON_KEY));
  assert.equal(resolveObjectNavIcon(undefined), resolveObjectNavIcon(DEFAULT_OBJECT_ICON_KEY));
});

test("only identifier-shaped icon keys are persisted — never markup or code", () => {
  assert.equal(normalizeObjectIconKey("Car"), "car");
  assert.equal(normalizeObjectIconKey("<svg onload=alert(1)>"), "svgonloadalert1");
  assert.equal(normalizeObjectIconKey("javascript:alert(1)"), "javascriptalert1");
  assert.equal(normalizeObjectIconKey("<img src=x>"), "imgsrcx");
  assert.equal(
    normalizeObjectPageDefinition({ objectKey: "vehicle", icon: "<img src=x>" }).icon,
    "imgsrcx"
  );
  const entry = objectNavigationEntries(fixtures()).entries[0];
  assert.equal(typeof entry.icon, "string");
  assert.ok(!entry.icon.includes("<"));
});

/* =============================== ORDER ================================ */

test("configured order is deterministic, with a label tie-break and a default", () => {
  const result = objectNavigationEntries(
    fixtures({
      pages: [
        { ...fixtures().pages[0], id: "a", page_key: "zeta", label: "Zeta", definition: { objectKey: "vehicle", order: 2 } },
        { ...fixtures().pages[0], id: "b", page_key: "alpha", label: "Alpha", definition: { objectKey: "vehicle", order: 1 } },
        { ...fixtures().pages[0], id: "c", page_key: "mid", label: "Mid", definition: { objectKey: "vehicle" } },
        { ...fixtures().pages[0], id: "d", page_key: "beta", label: "Beta", definition: { objectKey: "vehicle" } },
      ],
    })
  );
  assert.deepEqual(
    result.entries.map((entry) => entry.label),
    ["Alpha", "Zeta", "Beta", "Mid"]
  );
  assert.equal(result.entries[2].order, DEFAULT_OBJECT_NAV_ORDER);

  /* Re-sorting the returned payload changes nothing (stable, idempotent). */
  assert.deepEqual(
    sortObjectNavigation(result.entries).map((entry) => entry.label),
    result.entries.map((entry) => entry.label)
  );
});

test("duplicate page keys are de-duplicated deterministically", () => {
  const result = objectNavigationEntries(
    fixtures({
      pages: [
        { ...fixtures().pages[0], id: "a", definition: { objectKey: "vehicle", order: 1 } },
        { ...fixtures().pages[0], id: "b", definition: { objectKey: "vehicle", order: 2 } },
      ],
    })
  );
  assert.equal(result.entries.length, 1);
  assert.equal(reasonFor(result), OBJECT_NAVIGATION_EXCLUSIONS.DUPLICATE_KEY);
});

test("only object pages get the generic runtime — list views and reports do not", () => {
  const result = objectNavigationEntries(
    fixtures({ pages: [{ ...fixtures().pages[0], page_type: "report" }] })
  );
  assert.deepEqual(result.entries, []);
  assert.equal(reasonFor(result), OBJECT_NAVIGATION_EXCLUSIONS.UNSUPPORTED_PAGE_TYPE);
});

/* ========================== SPECIALISED PAGES ========================= */

test("built-in operational pages can never be taken over by navigation metadata", () => {
  const { pages } = buildConfiguredNavigation({
    objectPages: [
      { key: "p", label: "Products", objectKey: "product", route: "/app/objects/product", order: 1 },
      { key: "c", label: "Customers", objectKey: "customer", route: "/app/objects/customer", order: 2 },
      { key: "i", label: "Inventory", objectKey: "inventory", route: "/app/objects/inventory", order: 3 },
      { key: "p2", label: "Purchases", objectKey: "purchase", route: "/app/objects/purchase", order: 4 },
      { key: "ok", label: "Vehicles", objectKey: "vehicle", route: "/app/objects/vehicle", order: 5 },
    ],
    reservedLabels: Object.keys(PAGE_SLUGS),
  });
  assert.deepEqual(pages.map((page) => page.label), ["Vehicles"]);
});

test("the specialised navigation entries themselves are untouched", () => {
  /* The ONE page catalogue (utils/navCatalogue.js) owns the built-in entries;
     the admin shell renders from the same list. */
  for (const label of ["Products", "Customers", "Suppliers", "Inventory", "Purchases", "Sales", "Stores", "Reports"]) {
    assert.match(catalogueSource, new RegExp(`\\[\\"${label}\\", `));
  }
  /* The specialised destinations still point at their own components. */
  assert.match(layoutSource, /page ===\s*\n?\s*"Products" \? \(\s*\n\s*<ProductsAdmin/);
  assert.match(layoutSource, /"Customers" \? \(\s*\n\s*<CustomersAdmin/);
});

/* ======================= DASHBOARDS / REPORTS ======================== */

test("Dashboards is an explicit Insights entry and stays separate from the operational Dashboard", () => {
  const groups = groupNavItems([
    ["Dashboard", null],
    ["Dashboards", null],
    ["Reports", null],
    ["My Reports", null],
  ]);
  const insights = groups.find((group) => group.label === "Insights");
  assert.ok(insights, "Insights group exists");
  assert.deepEqual(insights.items.map(([label]) => label), ["Dashboards", "Reports", "My Reports"]);

  /* The operational Dashboard keeps its own General group. */
  const general = groups.find((group) => group.label === "General");
  assert.deepEqual(general.items.map(([label]) => label), ["Dashboard"]);
  assert.equal(groups.some((group) => group.label === "Workspace"), false);
});

test("Reports (curated) and My Reports (configurable) remain distinct entries", () => {
  assert.match(layoutSource, /canViewCustomReports\) visibleReportItems\.unshift\(\{ key: "My Reports"/);
  assert.match(catalogueSource, /\[\"Reports\", BarChart3\]/);
  assert.match(layoutSource, /page ===\s*\n?\s*"My Reports" \? \(\s*\n\s*canViewCustomReports \? \(\s*\n\s*<CustomReportsAdmin \/>/);
  assert.match(layoutSource, /"Reports" \? \(\s*\n\s*canViewReports \? \(\s*\n\s*<ReportsAdmin \/>/);
});

/* ============================ PERFORMANCE ============================ */

test("the navigation payload carries no field, layout, formula or workflow metadata", () => {
  const { entries } = objectNavigationEntries(fixtures());
  const entry = entries[0];
  assert.deepEqual(
    Object.keys(entry).sort(),
    ["appKey", "appLabel", "icon", "key", "label", "objectKey", "order", "route"].sort()
  );
  const serialized = JSON.stringify(entries);
  for (const forbidden of ["fields", "layout", "formula", "workflow", "records", "permissions", "object_id"]) {
    assert.ok(!serialized.includes(forbidden), `payload must not leak "${forbidden}"`);
  }
});

test("the client merge keeps only renderable entries and never invents a route", () => {
  assert.deepEqual(sanitizeConfiguredPages(null), []);
  assert.deepEqual(sanitizeConfiguredPages([{ key: "x" }, null, "noise"]), []);
  const pages = sanitizeConfiguredPages([
    { key: "vehicles", label: "Vehicles", objectKey: "vehicle" },
    { key: "broken", label: "Broken" },
  ]);
  assert.deepEqual(pages.map((page) => page.label), ["Vehicles"]);
  assert.equal(pages[0].route, "/app/objects/vehicle");
  assert.equal(pages[0].order, 100);
  assert.deepEqual(sortConfiguredPages([]), []);
});

/* ========================= DOCK INTEGRATION ========================== */

test("AdminLayout merges the configured pages into the SAME items the Dock renders", () => {
  assert.match(layoutSource, /buildConfiguredNavigation\(\{ objectPages, reservedLabels: reservedNavLabels \}\)/);
  assert.match(layoutSource, /\.\.\.filterNavigationByCatalog\(permissionFilteredItems, catalogKeys\),\s*\n\s*\.\.\.configuredNavigation\.items,/);
  assert.match(layoutSource, /items=\{items\}/);
});

test("AdminLayout reads the configured pages from the single bounded catalogue payload", () => {
  assert.match(layoutSource, /apiRequest\("\/api\/platform\/runtime\/app-catalog"\)/);
  assert.match(layoutSource, /if \(Array\.isArray\(data\?\.objectPages\)\) setObjectPages\(data\.objectPages\)/);
  /* One request — no per-Object discovery call. */
  assert.equal((layoutSource.match(/runtime\/app-catalog/g) || []).length, 1);
});

test("the reserved label list is the built-in route registry, not a hand-maintained copy", () => {
  assert.match(layoutSource, /Object\.keys\(PAGE_SLUGS\)/);
  assert.match(layoutSource, /REPORT_MENU_ITEMS\.map\(\(item\) => item\.key\)/);
  assert.match(layoutSource, /reservedNavLabels = useMemo\(/);
  assert.doesNotMatch(layoutSource, /reservedNavLabels = \[\s*"Products"/);
});

test("Dock discovery combines the built-in apps with the permitted configured pages", () => {
  /* The dock consumes BOTH lists from the SAME permission-filtered source the
     sidebar uses — no second menu, no extra per-Object request. */
  assert.match(layoutSource, /<AdminNavDock\s*\n\s*items=\{items\}/);
  assert.match(layoutSource, /objectItems=\{configuredNavigation\.items\}/);
  assert.match(dockSource, /export default function AdminNavDock\(\{ items, objectItems = \[\]/);
  assert.match(dockSource, /objectItems=\{objectItems\}/);
});

test("the Dock renders configured Objects in their own launcher group, filtered by the same search", () => {
  assert.match(dockSource, /const visibleObjects = objectItems\.filter\(\(\[name\]\) => match\(name\)\)/);
  assert.match(dockSource, /Objects\s*\n\s*<\/div>/);
  assert.match(dockSource, /visibleObjects\.map\(\(\[name, Icon\]\)/);
  assert.match(dockSource, /!visibleObjects\.length/);
});

test("the Dock keeps its built-in primary layout and the admin/till surface switch", () => {
  /* The dock keeps its structure: customisable quick-access slots, the Jarvis
     pocket and the fixed destinations (Apps launcher + contextual surface
     switch + Settings). "Open Till" lives in the AdminShell header. */
  assert.match(dockSource, /const GROUPS = \[/);
  assert.match(dockSource, /JarvisCorner embedded/);
  assert.match(dockSource, /label=\{surface === "till" \? "Admin" : "Till"\}/);
  assert.match(dockSource, /onSwitchSurface/);
  assert.match(dockSource, /label="Apps"/);
  assert.match(dockSource, /label="Settings"/);
  /* "Open Till" itself lives in the AdminShell header (unchanged behaviour). */
  /* The dock is not part of the preset system. */
  assert.doesNotMatch(dockSource, /onepos-icon-chip|onepos-nav-item-height|data-onepos-preset/);
});

test("the generic Object runtime renders through the existing ObjectPage", () => {
  assert.match(layoutSource, /<ObjectPage\s*\n\s*key=\{configuredNavigation\.objects\[page\]\}/);
  assert.match(layoutSource, /objectKey=\{configuredNavigation\.objects\[page\]\}/);
});

test("an Object deep link is held until the permitted page list arrives", () => {
  assert.match(layoutSource, /if \(route\.view === "object"\) return;/);
  assert.match(layoutSource, /configuredNavigation\.byObjectKey\[parsed\.objectKey\]/);
  assert.match(layoutSource, /page === OBJECT_PAGE_KEY/);
  assert.match(layoutSource, /Object not available/);
});

/* ====================== ADMIN CONFIGURATION UI ====================== */

test("an administrator can configure navigation exposure, icon and order", () => {
  assert.match(studioSource, /Show in navigation/);
  assert.match(studioSource, /OBJECT_NAV_ICON_OPTIONS\.map/);
  assert.match(studioSource, /placeholder="Order"/);
  assert.match(studioSource, /showInNavigation: navForm\.show/);
  /* Both create and update reuse the existing platform page endpoints. */
  assert.match(studioSource, /`\/api\/platform\/apps\/\$\{app\.id\}\/pages`/);
  assert.match(studioSource, /`\/api\/platform\/pages\/\$\{pageForm\.id\}`/);
});

test("navigation config lives in the existing page definition, not on the Object row", () => {
  const definition = normalizeObjectPageDefinition({
    objectKey: "vehicle",
    showInNavigation: true,
    icon: "car",
    order: 7,
  });
  assert.deepEqual(definition, {
    sections: [],
    components: [],
    objectKey: "vehicle",
    showInNavigation: true,
    icon: "car",
    order: 7,
  });
  /* Unknown keys are never persisted. */
  assert.equal(normalizeObjectPageDefinition({ objectKey: "vehicle", isAdmin: true, sql: "DROP" }).isAdmin, undefined);
  assert.equal(normalizeObjectPageDefinition({ objectKey: "vehicle", sql: "DROP" }).sql, undefined);
});

/* ========================== TILL BOUNDARY =========================== */

test("the Till boundary is untouched: /app still resolves to the POS", () => {
  assert.deepEqual(parseAppPath("/app"), { view: "pos" });
  assert.deepEqual(parseAppPath("/app/"), { view: "pos" });
  assert.match(layoutSource, /onOpenTill=\{onPOS\}/);
  assert.match(layoutSource, /<BottomStatusBar storeName="London Store" \/>/);
});
