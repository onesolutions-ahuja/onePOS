/*
 * onePOS Admin UI Shell + Presentation Presets — contract tests.
 *
 * Pins the shared admin shell, the three presentation presets, the separate
 * appearance preference, user-level persistence, catalog/permission-driven
 * navigation and the preservation of the existing Dockbar and page content.
 *
 *   node --test tests/adminShellPresentation.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  LAYOUT_PRESETS,
  APPEARANCE_OPTIONS,
  ACCENT_OPTIONS,
  DEFAULT_PREFERENCES,
  normalizePreferences,
  preferencesDiffer,
  isDarkAppearance,
  tokensForPreferences,
  applyPreferences,
} from "../src/utils/adminPreferences.js";
import { buildSwitcherApps, groupNavItems } from "../src/utils/adminApps.js";
import {
  PAGE_SLUGS,
  SETTINGS_TAB_SLUGS,
  parseAppPath,
  buildAppPath,
} from "../src/utils/adminRoutes.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const LAYOUT = read("../src/pages/admin/AdminLayout.jsx");
const SHELL = read("../src/components/AdminShell.jsx");
const DOCK = read("../src/components/AdminNavDock.jsx");
const POS = read("../src/pages/pos/POS.jsx");
const SETTINGS = read("../src/pages/settings/SettingsAdmin.jsx");
const SERVER = read("../server.js");
const INIT = read("../database/init.js");
const SCHEMA = read("../database/schema.sql");
const SERVICE = read("../src/services/adminPreferencesService.js");
const APPS = read("../src/utils/adminApps.js");
const SETTINGS_ROUTES = read("../routes/settings.js");
const APPEARANCE = read("../src/pages/settings/AppearancePreferences.jsx");
const INDEX_CSS = read("../src/index.css");
const TAILWIND = read("../tailwind.config.js");

/* ---------------- 1. Admin shell renders ---------------- */

describe("1. Admin shell renders", () => {
  test("AdminLayout renders the shared AdminShell", () => {
    assert.match(LAYOUT, /import AdminShell from "..\/..\/components\/AdminShell.jsx";/);
    assert.match(LAYOUT, /<AdminShell/);
    assert.match(SHELL, /data-testid="admin-shell"/);
    assert.match(SHELL, /data-testid="admin-header"/);
  });

  test("shell is one shared component with header + sidebar + content frame", () => {
    assert.match(SHELL, /data-testid="admin-sidebar"/);
    assert.match(SHELL, /data-testid="admin-shell-content"/);
    assert.match(SHELL, /export default function AdminShell/);
  });
});

/* ---------------- 2. Existing page content remains rendered ---------------- */

describe("2. Existing page content remains rendered", () => {
  test("every existing page branch survives unchanged", () => {
    for (const page of ["Dashboard", "Sales", "Returns", "Supplier Returns", "Products", "Global Products",
      "Categories", "Inventory", "Replenishment", "Purchases", "Suppliers", "Customers", "Stores",
      "Business Divisions", "Integrations", "Accounting", "Online Orders", "Order Prep", "Settings",
      "Licensing", "Employees", "Audit Log", "My Reports", "Reports"]) {
      assert.ok(LAYOUT.includes(`"${page}" ? (`), `page branch missing: ${page}`);
    }
  });

  test("page components keep their existing props", () => {
    assert.match(LAYOUT, /<Dashboard\r?\n\s*canViewReports=\{canViewReports\}/);
    assert.match(LAYOUT, /<ProductsAdmin openCreate=\{productCreateRequested\} \/>/);
    assert.match(LAYOUT, /<SuppliersAdmin permissions=\{onlinePermissions\.permissions\} isAdmin=\{onlinePermissions\.isAdmin\} \/>/);
    assert.match(LAYOUT, /<SettingsAdmin key=\{settingsTab\} initialTab=\{settingsTab\}/);
  });

  test("Access-denied panels still exist (permission gates intact)", () => {
    const count = (LAYOUT.match(/Access denied/g) || []).length;
    assert.ok(count >= 4, `expected >=4 Access denied panels, found ${count}`);
  });
});

/* ---------------- 3. Dockbar remains available ---------------- */

describe("3. Dockbar remains available", () => {
  test("AdminNavDock is still rendered by AdminLayout with identical props", () => {
    assert.match(LAYOUT, /<AdminNavDock\r?\n\s*items=\{items\}/);
    assert.match(LAYOUT, /reportItems=\{canViewReports \? catalogFilteredReportItems : \[\]\}/);
    assert.match(LAYOUT, /onOpenTill=\{onPOS\}/);
    assert.match(LAYOUT, /quickAccess=\{dockQuickAccess\}/);
  });

  test("dock functionality (launcher, Open Till, quick access) is untouched", () => {
    assert.match(DOCK, /DOCK_PRIMARY/);
    assert.match(DOCK, /MAX_QUICK_ACCESS = 8/);
    assert.match(DOCK, /"Open Till"/);
    assert.match(DOCK, /LauncherPopup/);
  });
});

/* ---------------- 4. Module/app switcher respects available modules ---------------- */

describe("4. Module/app switcher respects available modules", () => {
  test("switcher entries derive ONLY from the runtime catalog response", () => {
    assert.match(LAYOUT, /apiRequest\("\/api\/platform\/runtime\/app-catalog"\)/);
    assert.match(LAYOUT, /buildSwitcherApps\(catalogEntries\)/);
    assert.match(SHELL, /buildSwitcherApps/);
  });

  test("buildSwitcherApps maps the real catalog entries", () => {
    const apps = buildSwitcherApps([
      { module_key: "retail_pos", name: "POS & Sales", description: "Till sales.", route: "/app/sales" },
      { module_key: "products", name: "Products", route: "/app/products" },
    ]);
    assert.equal(apps.length, 2);
    assert.deepEqual(
      apps.map((a) => a.name).sort(),
      ["POS & Sales", "Products"]
    );
    assert.equal(apps[0].route, "/app/sales");
  });

  test("null/empty catalog → empty switcher (never invents modules)", () => {
    assert.deepEqual(buildSwitcherApps(null), []);
    assert.deepEqual(buildSwitcherApps([]), []);
    assert.deepEqual(buildSwitcherApps(undefined), []);
  });

  test("a Set of module keys also builds entries (no fabricated names)", () => {
    const apps = buildSwitcherApps(new Set(["inventory", "mystery_module"]));
    assert.ok(apps.some((a) => a.key === "inventory" && a.name === "Inventory"));
    assert.ok(apps.some((a) => a.key === "mystery_module"));
  });
});

/* ---------------- 5. Permissions still hide inaccessible navigation ---------------- */

describe("5. Permissions still hide inaccessible navigation", () => {
  test("permission filtering pipeline is unchanged in AdminLayout", () => {
    assert.match(LAYOUT, /const permissionFilteredItems = \[/);
    assert.match(LAYOUT, /filterNavigationByCatalog\(permissionFilteredItems, catalogKeys\)/);
    assert.match(LAYOUT, /canViewReport = useCallback\(\(permission\) => \{[\s\S]*?isAdmin\) return true/);
    assert.match(LAYOUT, /apiRequest\("\/api\/auth\/me\/permissions"\)/);
  });

  test("shell receives the SAME filtered items list as the dock", () => {
    assert.match(LAYOUT, /items=\{items\}/);
  });

  test("groupNavItems only groups what it is given — no new entries", () => {
    const groups = groupNavItems([["Dashboard", null], ["Audit Log", null]]);
    const labels = groups.map((g) => g.label);
    assert.deepEqual(labels, ["General", "Administration"]);
    const all = groups.flatMap((g) => g.items.map(([name]) => name));
    assert.deepEqual(all.sort(), ["Audit Log", "Dashboard"]);
  });

  test("unknown pages land in a trailing Workspace group (not dropped)", () => {
    const groups = groupNavItems([["Future Page", null]]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, "Workspace");
  });
});

/* ---------------- 6. Uninstalled modules do not appear ---------------- */

describe("6. Uninstalled modules do not appear", () => {
  test("catalog failure keeps the permission-filtered fallback (catalogKeys null)", () => {
    assert.match(LAYOUT, /const \[catalogKeys, setCatalogKeys] = useState\(null\)/);
    assert.match(LAYOUT, /retain the existing permission-filtered navigation/);
    assert.match(LAYOUT, /if \(alive\) setCatalogKeys\(null\)/);
  });

  test("unavailable pages skip rendering in the dock (unchanged behaviour)", () => {
    assert.match(DOCK, /if \(!Icon\) return null/);
  });

  test("filterNavigationByCatalog drops pages whose module is not installed", () => {
    assert.match(LAYOUT, /catalogKeys\.has\(moduleKey\)/);
  });
});

/* ---------------- 7. Platform metadata object navigation ---------------- */

describe("7. Platform metadata object navigation works", () => {
  test("Platform administration stays reachable through Settings → Platform", () => {
    assert.match(SETTINGS, /tab === "Platform" && \(isAdmin \|\| isSuperadmin\) && <PlatformAdmin/);
  });

  test("Platform object tooling keeps its existing navigation surface", () => {
    const platformAdmin = read("../src/pages/settings/PlatformAdmin.jsx");
    assert.match(platformAdmin, /setView\("objects"\)/);
    assert.match(platformAdmin, /setView\("app-catalog"\)/);
    assert.match(platformAdmin, /ObjectList/);
    assert.match(platformAdmin, /InternalAppCatalog/);
  });

  test("no duplicate platform objects/fields are introduced by the shell", () => {
    /* The switcher's Platform entry points at the EXISTING Platform admin
       surface (Settings → Platform) via the catalog-route metadata. */
    assert.match(APPS, /app\/settings\/platform/);
    assert.ok(!SHELL.includes("platform_objects"), "shell must not redefine platform metadata");
    assert.ok(!APPS.includes("platform_objects"), "switcher metadata must not redefine platform objects");
  });
});

/* ---------------- 8-10. Presentation presets ---------------- */

describe("8. Modern preset", () => {
  test("modern is the default preset with its own tokens", () => {
    const tokens = tokensForPreferences({ ...DEFAULT_PREFERENCES, preset: "modern" });
    assert.equal(DEFAULT_PREFERENCES.preset, "modern");
    assert.equal(tokens["--onepos-page-gap"], "22px");
    assert.equal(tokens["--onepos-radius"], "12px");
    assert.equal(tokens["--onepos-sidebar-width"], "248px");
  });
});

describe("9. Enterprise preset", () => {
  test("enterprise is denser and structured", () => {
    const modern = tokensForPreferences({ preset: "modern", appearance: "light", accent: "teal", sidebarCollapsed: false });
    const enterprise = tokensForPreferences({ preset: "enterprise", appearance: "light", accent: "teal", sidebarCollapsed: false });
    assert.equal(enterprise["--onepos-page-gap"], "14px");
    assert.equal(enterprise["--onepos-radius"], "6px");
    assert.ok(parseInt(enterprise["--onepos-sidebar-width"]) < parseInt(modern["--onepos-sidebar-width"]));
  });
});

describe("10. Compact preset", () => {
  test("compact is the densest with the narrowest nav", () => {
    const enterprise = tokensForPreferences({ preset: "enterprise", appearance: "light", accent: "teal", sidebarCollapsed: false });
    const compact = tokensForPreferences({ preset: "compact", appearance: "light", accent: "teal", sidebarCollapsed: false });
    assert.equal(compact["--onepos-page-gap"], "10px");
    assert.equal(compact["--onepos-sidebar-width"], "190px");
    assert.equal(compact["--onepos-control-height"], "30px");
    assert.ok(parseInt(compact["--onepos-control-height"]) < parseInt(enterprise["--onepos-control-height"]));
  });

  test("compact keeps text readable (≥12px rows/labels)", () => {
    assert.match(INDEX_CSS, /\[data-onepos-preset="compact"\] \{ --onepos-table-cell-y: 4px; \}/);
    assert.doesNotMatch(INDEX_CSS, /font-size:\s*(9|10|11)px;\s*\/\* base body \*\//);
  });

  test("table density hook exists for all three presets", () => {
    assert.match(INDEX_CSS, /\[data-onepos-preset="modern"\] \{ --onepos-table-cell-y: 8px; \}/);
    assert.match(INDEX_CSS, /\[data-onepos-preset="enterprise"\] \{ --onepos-table-cell-y: 6px; \}/);
  });
});

/* ---------------- 11-13. Appearance ---------------- */

describe("11. Light appearance", () => {
  test("light tokens match the original palette", () => {
    const tokens = tokensForPreferences({ preset: "modern", appearance: "light", accent: "teal", sidebarCollapsed: false });
    assert.equal(tokens["--onepos-surface-raised"], "hsl(0 0% 100%)");
    assert.equal(tokens["--onepos-text-heading"], "hsl(215 25% 16%)");
  });
});

describe("12. Dark appearance", () => {
  test("dark tokens flip surfaces and text", () => {
    const tokens = tokensForPreferences({ preset: "modern", appearance: "dark", accent: "teal", sidebarCollapsed: false });
    assert.notEqual(tokens["--onepos-surface-raised"], "hsl(0 0% 100%)");
    assert.ok(tokens["--onepos-text-heading"].startsWith("hsl(2"));
    const light = tokensForPreferences({ preset: "modern", appearance: "light", accent: "teal", sidebarCollapsed: false });
    assert.notEqual(tokens["--onepos-surface"], light["--onepos-surface"]);
  });

  test("applyPreferences sets the dark data attribute", () => {
    let dataset = {};
    let style = { setProperty() {} };
    const root = { dataset, style, getAttribute() { return null; }, setAttribute() {} };
    applyPreferences({ preset: "modern", appearance: "dark", accent: "teal", sidebarCollapsed: false }, { root });
    assert.equal(dataset.oneposDark, "true");
  });
});

describe("13. System appearance", () => {
  test("system follows the OS when it reports dark", () => {
    assert.equal(isDarkAppearance({ appearance: "system" }, { systemDark: true }), true);
    assert.equal(isDarkAppearance({ appearance: "system" }, { systemDark: false }), false);
    assert.equal(isDarkAppearance({ appearance: "dark" }, { systemDark: false }), true);
    assert.equal(isDarkAppearance({ appearance: "light" }, { systemDark: true }), false);
  });

  test("shell subscribes to prefers-color-scheme changes", () => {
    assert.match(SHELL, /prefers-color-scheme: dark/);
    assert.match(SHELL, /addEventListener\?\.\("change", onChange\)/);
  });
});

/* ---------------- 14. Preference switching ---------------- */

describe("14. Preference switching", () => {
  test("header preference menu switches preset, appearance and accent", () => {
    assert.match(SHELL, /data-testid="appearance-menu-button"/);
    /* Per-option test ids are generated from the option keys. */
    assert.match(SHELL, /data-testid=\{\`preset-\$\{key\}\`\}/);
    assert.match(SHELL, /data-testid=\{\`appearance-\$\{key\}\`\}/);
    assert.match(SHELL, /data-testid=\{\`accent-\$\{key\}\`\}/);
  });

  test("normalizePreferences rejects invalid values (safe switching)", () => {
    assert.equal(normalizePreferences({ preset: "bogus" }).preset, "modern");
    assert.equal(normalizePreferences({ appearance: 42 }).appearance, "light");
    assert.equal(normalizePreferences({ accent: null }).accent, "teal");
    assert.equal(normalizePreferences(null).preset, "modern");
  });

  test("preferencesDiffer detects any visible change", () => {
    assert.equal(preferencesDiffer(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES, preset: "enterprise" }), true);
    assert.equal(preferencesDiffer(DEFAULT_PREFERENCES, { ...DEFAULT_PREFERENCES }), false);
  });
});

/* ---------------- 15. Preference persistence ---------------- */

describe("15. Preference persistence", () => {
  test("dedicated user-level endpoints exist (auth/me/preferences)", () => {
    assert.match(SERVER, /app\.get\("\/api\/auth\/me\/preferences", authenticate/);
    assert.match(SERVER, /app\.put\("\/api\/auth\/me\/preferences", authenticate/);
  });

  test("persisted in a per-user table, not company settings", () => {
    assert.match(INIT, /CREATE TABLE IF NOT EXISTS user_preferences/);
    assert.match(SCHEMA, /CREATE TABLE IF NOT EXISTS user_preferences/);
    assert.match(INIT, /user_id UUID PRIMARY KEY REFERENCES users\(id\) ON DELETE CASCADE/);
  });

  test("server normalises and never trusts raw input", () => {
    assert.match(SERVER, /normalizeUserPreferences/);
    assert.match(SERVER, /USER_PREF_FIELDS/);
  });

  test("client mirrors prefs in localStorage for instant paint + offline", () => {
    assert.match(SERVICE, /onepos_admin_prefs/);
    assert.match(SERVICE, /localStorage\.setItem\(CACHE_KEY/);
    assert.match(LAYOUT, /loadCachedPreferences\(\)/);
    assert.match(LAYOUT, /fetchPreferences\(\)/);
    assert.match(LAYOUT, /savePreferences\(next\)/);
  });

  test("company settings PUT untouched by presentation prefs", () => {
    /* The dock quick-access company setting remains owned by the company
       settings router; presentation prefs never read or write it. */
    assert.match(SETTINGS_ROUTES, /dock: \{\s*\r?\n\s*quickAccess:/);
    assert.ok(!SERVICE.includes("dockQuickAccess"));
    assert.ok(!SERVICE.includes("dock.quickAccess"));
  });
});

/* ---------------- 16. Collapsed navigation ---------------- */

describe("16. Collapsed navigation", () => {
  test("sidebar toggle exists and swaps collapsed state", () => {
    assert.match(SHELL, /data-testid="sidebar-toggle"/);
    assert.match(SHELL, /sidebarCollapsed: !collapsed/);
    assert.match(SHELL, /aria-label=\{collapsed \? "Expand navigation" : "Collapse navigation"\}/);
  });

  test("collapsed state persists with the rest of the preferences", () => {
    assert.equal(normalizePreferences({ sidebarCollapsed: true }).sidebarCollapsed, true);
    assert.equal(normalizePreferences({ sidebarCollapsed: false }).sidebarCollapsed, false);
  });

  test("collapsed width token exists per preset", () => {
    assert.match(INDEX_CSS, /--onepos-sidebar-width-collapsed: 68px;/);
    const compact = tokensForPreferences({ preset: "compact", appearance: "light", accent: "teal", sidebarCollapsed: true });
    assert.ok(parseInt(compact["--onepos-sidebar-width-collapsed"]) < parseInt(compact["--onepos-sidebar-width"]));
  });
});

/* ---------------- 17. Existing routes still work ---------------- */

describe("17. Existing routes still work", () => {
  test("route map is unchanged (no renames for appearance)", () => {
    assert.equal(PAGE_SLUGS.Dashboard, "dashboard");
    assert.equal(PAGE_SLUGS.Products, "products");
    assert.equal(PAGE_SLUGS.Customers, "customers");
    assert.equal(PAGE_SLUGS.Settings, "settings");
    assert.equal(buildAppPath("Dashboard"), "/app/dashboard");
    assert.equal(buildAppPath("Products"), "/app/products");
    assert.equal(parseAppPath("/app/customers").page, "Customers");
  });

  test("Appearance tab adds one new deep link without breaking existing ones", () => {
    assert.equal(SETTINGS_TAB_SLUGS.Appearance, "appearance");
    assert.equal(parseAppPath("/app/settings/appearance").settingsTab, "Appearance");
    assert.equal(parseAppPath("/app/settings/store-till").settingsTab, "Store & Till");
  });

  test("navigate() is still the single URL-syncing entry point", () => {
    assert.match(LAYOUT, /window\.history\.pushState\(\{\}, "", target\)/);
    assert.match(LAYOUT, /addEventListener\("popstate", onPopState\)/);
  });
});

/* ---------------- 18. Till UI unaffected ---------------- */

describe("18. Till UI unaffected", () => {
  test("POS never imports the admin shell or its preferences", () => {
    assert.ok(!POS.includes("AdminShell"), "POS must not render the admin shell");
    assert.ok(!POS.includes("adminPreferencesService"), "till must not read admin prefs");
    assert.ok(!POS.includes("onepos-sidebar"), "till must not use shell chrome");
  });

  test("token defaults equal the original hard-coded palette (till identical)", () => {
    assert.match(INDEX_CSS, /--onepos-surface-muted: hsl\(210 20% 98%\)/);
    assert.match(INDEX_CSS, /--onepos-border: hsl\(210 14% 89%\)/);
    assert.match(INDEX_CSS, /--onepos-text-heading: hsl\(215 25% 16%\)/);
    assert.match(INDEX_CSS, /--onepos-accent-600: #176f6a/);
  });

  test("tailwind slate remap preserves every existing utility value", () => {
    assert.match(TAILWIND, /slateFromTokens/);
    assert.match(TAILWIND, /var\(--onepos-surface-muted\)/);
    assert.match(TAILWIND, /var\(--onepos-text-heading\)/);
  });
});

/* ---------------- Settings UI (task §19) ---------------- */

describe("Settings → Appearance UI", () => {
  test("Appearance is a settings tab with live preview and radio groups", () => {
    assert.match(SETTINGS, /APPEARANCE_TAB = "Appearance"/);
    assert.match(SETTINGS, /tab === APPEARANCE_TAB && <AppearanceSection \/>/);
    assert.match(APPEARANCE, /data-testid="appearance-preview"/);
    assert.match(APPEARANCE, /role="radiogroup"/);
    assert.match(APPEARANCE, /LAYOUT_PRESETS\.map/);
    assert.match(APPEARANCE, /APPEARANCE_OPTIONS\.map/);
    assert.match(APPEARANCE, /ACCENT_OPTIONS\.map/);
  });

  test("changing appearance never reloads business data (no page reload)", () => {
    assert.match(APPEARANCE, /onChange\?\.\(next\)/);
    assert.ok(!APPEARANCE.includes("window.location.reload"));
  });

  test("appearance route is wired from the shell profile menu", () => {
    assert.match(SHELL, /onOpenSettings\?\.\("Appearance"\)/);
  });
});

/* ---------------- Responsive + accessibility ---------------- */

describe("Responsive behaviour + accessibility", () => {
  test("mobile drawer exists; desktop sidebar hides below lg", () => {
    assert.match(SHELL, /data-testid="mobile-nav-trigger"/);
    assert.match(SHELL, /data-testid="admin-sidebar-drawer"/);
    assert.match(INDEX_CSS, /@media \(max-width: 1023px\)/);
  });

  test("safe areas are respected (notches, home indicators)", () => {
    assert.match(INDEX_CSS, /env\(safe-area-inset-top\)/);
    assert.match(INDEX_CSS, /env\(safe-area-inset-left\)/);
    assert.match(INDEX_CSS, /env\(safe-area-inset-right\)/);
    assert.match(INDEX_CSS, /env\(safe-area-inset-bottom\)/);
  });

  test("keyboard accessibility: focus-visible rings and Escape closes", () => {
    assert.match(SHELL, /focus-visible:ring-2/);
    assert.match(SHELL, /event\.key === "Escape"/);
    assert.match(SHELL, /aria-haspopup="menu"/);
    assert.match(SHELL, /aria-current=\{active \? "page" : undefined\}/);
    assert.match(SHELL, /aria-label="Admin navigation"/);
  });

  test("reduced-motion preference respected", () => {
    assert.match(INDEX_CSS, /prefers-reduced-motion: reduce/);
  });

  test("app switcher and menus are semantic menus with labels", () => {
    assert.match(SHELL, /aria-label="Installed applications"/);
    assert.match(SHELL, /aria-label="Display preferences"/);
    assert.match(SHELL, /aria-label="User menu"/);
  });
});
