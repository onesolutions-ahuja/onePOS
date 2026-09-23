/*
 * onePOS — Settings discoverability in Admin navigation.
 *
 *   node --test tests/settingsNavigation.test.mjs
 *
 * Fixes the gap found while completing the Superadmin runtime-access work:
 * `/app/settings` existed, SettingsAdmin was fully wired, and BOTH navigation
 * definitions already listed a "Settings" page — but AdminLayout's
 * permissionFilteredItems never supplied it, so the item was filtered out of
 * every surface and Settings was reachable only by deep link or from the POS.
 *
 * These tests pin the navigation half (which is a discoverability concern, not
 * a security boundary) AND the authorization half (which stays authoritative
 * inside SettingsAdmin and the APIs).
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAppPath, parseAppPath, SETTINGS_TAB_SLUGS } from "../src/utils/adminRoutes.js";
import { groupNavItems } from "../src/utils/adminApps.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const LAYOUT_SRC = read("../src/pages/admin/AdminLayout.jsx");
const DOCK_SRC = read("../src/components/AdminNavDock.jsx");
const APPS_SRC = read("../src/utils/adminApps.js");
const SETTINGS_SRC = read("../src/pages/settings/SettingsAdmin.jsx");

/* The real navigation list, from its declaration to its closing bracket. */
const NAV_LIST_SRC = LAYOUT_SRC.slice(
  LAYOUT_SRC.indexOf("const permissionFilteredItems = ["),
  LAYOUT_SRC.indexOf("const items = filterNavigationByCatalog("),
);

/* The catalogue adapter, i.e. the map that decides which pages a missing
   catalogue can drop. */
const CATALOG_MAP_SRC = LAYOUT_SRC.slice(
  LAYOUT_SRC.indexOf("const CATALOG_MODULE_BY_PAGE = {"),
  LAYOUT_SRC.indexOf("export function filterNavigationByCatalog"),
);

/* -------------------------------------- 1. the navigation entry now exists */

describe("1. Settings is supplied to the navigation", () => {
  test("AdminLayout's navigation list contains the Settings page", () => {
    assert.match(NAV_LIST_SRC, /\[\"Settings\", Settings\]/, "the page must be in the real nav list, not just somewhere in the file");
  });

  test("the icon comes from the existing lucide-react import (no second library)", () => {
    const lucideImport = LAYOUT_SRC.slice(
      LAYOUT_SRC.indexOf("from \"lucide-react\""),
      LAYOUT_SRC.indexOf("from \"lucide-react\"") + 40,
    );
    assert.match(LAYOUT_SRC, /import \{[^}]*\bSettings\b[^}]*\} from "lucide-react"/);
    assert.ok(lucideImport.length > 0);
    assert.equal((LAYOUT_SRC.match(/from "lucide-react"/g) || []).length, 1, "one icon library only");
  });

  test("Settings is listed exactly once — no duplicate entry", () => {
    const occurrences = NAV_LIST_SRC.split('["Settings"').length - 1;
    assert.equal(occurrences, 1);
    /* The dock's quick-access defaults must not also pin it, or it would
       render twice in the dock bar. */
    const dockPrimary = DOCK_SRC.slice(DOCK_SRC.indexOf("const DOCK_PRIMARY = ["), DOCK_SRC.indexOf("MAX_QUICK_ACCESS"));
    assert.doesNotMatch(dockPrimary, /Settings/);
  });

  test("no Superadmin-only Settings link was hard-coded", () => {
    assert.doesNotMatch(NAV_LIST_SRC, /isSuperadmin \? \[\['Settings'/, "must not be a superadmin-only entry");
    assert.doesNotMatch(NAV_LIST_SRC, /isSuperadmin \? \[\[\"Settings\"/);
    assert.match(NAV_LIST_SRC, /^\s*\["Settings", Settings\],$/m, "unconditional, like Dashboard and Sales");
  });
});

/* --------------------------- 2. every navigation surface now exposes it */

describe("2. both navigation surfaces receive Settings", () => {
  test("the dock already declares Settings in its Admin group", () => {
    assert.match(DOCK_SRC, /pages: \["Integrations", "Accounting", "Settings", "Audit Log"\]/);
  });

  test("the dock renders a declared page only when AdminLayout supplies it", () => {
    /* This is the mechanism that made the missing item invisible: the launcher
       intersects its own group definitions with the items it receives. */
    assert.match(DOCK_SRC, /const available = new Set\(items\.map\(\(\[name\]\) => name\)\)/);
    assert.match(DOCK_SRC, /const visible = pages\.filter\(\(p\) => available\.has\(p\) && match\(p\)\)/);
    /* ...and the dock bar itself skips quick-access slots the user cannot see. */
    assert.match(DOCK_SRC, /const byName = new Map\(items\.map\(\(\[name, icon\]\) => \[name, icon\]\)\)/);
  });

  test("the sidebar grouping already declares Settings in Administration", () => {
    assert.match(APPS_SRC, /label: "Administration", pages: \[[^\]]*"Settings"/);
  });

  test("groupNavItems places a supplied Settings item in Administration, once", () => {
    const items = [["Dashboard", null], ["Sales", null], ["Settings", null], ["Licensing", null], ["Audit Log", null]];
    const groups = groupNavItems(items);
    const administration = groups.find((group) => group.label === "Administration");
    assert.ok(administration, "an Administration group should exist");
    assert.deepEqual(administration.items.map(([name]) => name), ["Audit Log", "Licensing", "Settings"]);
    const total = groups.flatMap((group) => group.items).filter(([name]) => name === "Settings").length;
    assert.equal(total, 1, "Settings must appear exactly once across all groups");
  });

  test("a supplied Settings item is no longer orphaned into Workspace", () => {
    const withSettings = groupNavItems([["Settings", null]]);
    assert.deepEqual(withSettings.map((group) => group.label), ["Administration"]);
  });
});

/* --------------------------- 3. catalogue filtering cannot hide Settings */

describe("3. the runtime catalogue does not gate Settings", () => {
  test("Settings is not mapped to a catalogue module", () => {
    assert.doesNotMatch(CATALOG_MAP_SRC, /\bSettings\b/, "an unmapped page is never dropped by the catalogue filter");
    assert.doesNotMatch(LAYOUT_SRC, /Settings: "platform"/, "Settings hosts platform ADMINISTRATION and must survive a missing catalogue");
  });

  test("the REAL filter keeps Settings and drops module pages when the catalogue is empty", () => {
    /* Evaluate the actual map + filter from AdminLayout's source so this is a
       behavioural check, not a string match. */
    const mapLiteral = CATALOG_MAP_SRC.slice(CATALOG_MAP_SRC.indexOf("{"), CATALOG_MAP_SRC.lastIndexOf("}") + 1);
    const filterSrc = LAYOUT_SRC
      .slice(LAYOUT_SRC.indexOf("export function filterNavigationByCatalog"), LAYOUT_SRC.indexOf("export default function AdminLayout"))
      .replace("export function filterNavigationByCatalog", "function filterNavigationByCatalog");
    const map = new Function(`return (${mapLiteral});`)();
    /* The filter closes over the module-scope map, so it must be injected. */
    const filter = new Function("CATALOG_MODULE_BY_PAGE", `${filterSrc}\nreturn filterNavigationByCatalog;`)(map);

    const items = [["Dashboard", null], ["Products", null], ["Settings", null], ["Licensing", null]];
    const names = (list) => list.map(([name]) => name);

    assert.deepEqual(names(filter(items, new Set())), ["Settings", "Licensing"], "an empty catalogue must still leave Settings reachable");
    /* Dashboard maps to retail_pos, so only a retail_pos catalogue brings it back. */
    assert.deepEqual(names(filter(items, new Set(["retail_pos"]))), ["Dashboard", "Settings", "Licensing"]);
    assert.deepEqual(names(filter(items, new Set(["products"]))), ["Products", "Settings", "Licensing"]);
    assert.deepEqual(names(filter(items, null)), ["Dashboard", "Products", "Settings", "Licensing"], "an unloaded catalogue must not hide anything");
    assert.equal(map.Settings, undefined, "Settings must have no catalogue module mapping");
    assert.equal(map.Products, "products", "the existing adapter is unchanged");
  });

  test("existing module-mapped pages keep their mapping", () => {
    for (const [page, moduleKey] of [["Products", "products"], ["Inventory", "inventory"], ["Customers", "customers"], ["Reports", "reports"]]) {
      assert.match(CATALOG_MAP_SRC, new RegExp(`${page}: "${moduleKey}"`));
    }
  });
});

/* ------------------------------- 4. the permission rule behind Settings */

describe("4. the authorization rule is the existing Settings model", () => {
  test("Appearance is available to every signed-in user (why the entry is unconditional)", () => {
    assert.match(SETTINGS_SRC, /const APPEARANCE_TAB = "Appearance"/);
    assert.match(SETTINGS_SRC, /available to EVERY signed-in user/);
    assert.match(SETTINGS_SRC, /visibleGroups\.splice\(0, 0, \{ label: "Your account", sections: \[APPEARANCE_TAB\] \}\)/);
  });

  test("privileged sections stay gated inside the Settings surface", () => {
    assert.match(SETTINGS_SRC, /\(section !== "Platform" \|\| isAdmin \|\| isSuperadmin\)/);
    assert.match(SETTINGS_SRC, /\(section !== "Server \/ API Configuration" \|\| isSuperadmin\)/);
    assert.match(SETTINGS_SRC, /\(section !== "Customer Loyalty" \|\| entitlements\.loyalty === true\)/);
  });

  test("the gated sections are ALSO guarded at render time", () => {
    assert.match(SETTINGS_SRC, /tab === "Server \/ API Configuration" && isSuperadmin && <ServerApiSettings/);
    assert.match(SETTINGS_SRC, /tab === "Platform" && \(isAdmin \|\| isSuperadmin\) && <PlatformAdmin/);
    assert.match(SETTINGS_SRC, /tab === "Message Templates" && \(isAdmin \|\| isSuperadmin\) && <MessageTemplatesAdmin/);
  });

  test("an unauthorized user gains no Settings privilege from the nav entry", () => {
    /* A caller with no isAdmin/isSuperadmin and no entitlements still sees the
       section list, but every privileged section is filtered out — so the nav
       entry grants reach, never privilege. */
    const gates = SETTINGS_SRC.match(/\(section !== "[^"]+" \|\|/g) || [];
    assert.equal(gates.length, 3, "expected exactly the three existing section gates");
    assert.doesNotMatch(SETTINGS_SRC, /if \(!isAdmin && !isSuperadmin\) return null/);
  });
});

/* --------------------------- 5. the destination and page are unchanged */

describe("5. /app/settings still resolves to the existing implementation", () => {
  test("buildAppPath maps Settings to the existing path", () => {
    assert.equal(buildAppPath("Settings"), "/app/settings");
  });

  test("the destination the navigation links to resolves to the admin shell", () => {
    const parsed = parseAppPath(buildAppPath("Settings"));
    assert.equal(parsed?.view, "admin");
    assert.equal(parsed?.page, "Settings");
    /* Full tab-slug round-trip coverage already exists in adminRoutes.test.mjs;
       this only proves the destination the new navigation entry points at. */
    assert.ok(Object.keys(SETTINGS_TAB_SLUGS).length > 0);
  });

  test("the render branch and its props are unchanged", () => {
    assert.match(LAYOUT_SRC, /"Settings" \? \(/);
    assert.match(
      LAYOUT_SRC,
      /<SettingsAdmin key=\{settingsTab\} initialTab=\{settingsTab\} isAdmin=\{onlinePermissions\.isAdmin\} isSuperadmin=\{onlinePermissions\.isSuperadmin\} entitlements=\{onlinePermissions\.entitlements\} \/>/,
    );
  });

  test("no second Settings page or route was created", () => {
    assert.equal((LAYOUT_SRC.match(/<SettingsAdmin/g) || []).length, 1);
    assert.equal((LAYOUT_SRC.match(/import SettingsAdmin from/g) || []).length, 1);
    assert.doesNotMatch(LAYOUT_SRC, /SettingsAdmin2|SecondSettings/);
  });

  test("the navigation still routes through the existing path builder", () => {
    assert.match(LAYOUT_SRC, /return buildAppPath\(nextPage, \{ settingsTab \}\);/);
    assert.match(LAYOUT_SRC, /navigate\("Settings", \{ settingsTab: tab \|\| "General" \}\)/);
  });
});
