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
import { settingSectionAccess, sectionIsVisible } from "../src/utils/settingsAccess.js";

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
  test("Settings is intentionally excluded from the dock because the header gear owns it", () => {
    assert.doesNotMatch(DOCK_SRC, /"Accounting", "Settings", "Audit Log"/);
    assert.match(DOCK_SRC, /filter\(\(name\) => name !== "Settings"\)/);
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
  test("Appearance is not duplicated inside company Settings navigation", () => {
    assert.doesNotMatch(SETTINGS_SRC, /const APPEARANCE_TAB = "Appearance"/);
    assert.doesNotMatch(SETTINGS_SRC, /visibleGroups\.splice\(0, 0/);
    assert.doesNotMatch(SETTINGS_SRC, /tab === APPEARANCE_TAB/);
  });

  test("the section list and the render branches read ONE access map", () => {
    /* The bug this pins: the Platform render branch accepted
       user.isPlatformDeveloper while the section list accepted only
       isAdmin || isSuperadmin, so a permitted Platform Developer was allowed
       through the gate but could never select the section. Both now derive
       from settingSectionAccess, so they cannot disagree. */
    assert.match(SETTINGS_SRC, /const access = settingSectionAccess\(\{/);
    assert.match(SETTINGS_SRC, /sections: group\.sections\.filter\(/);
    assert.match(SETTINGS_SRC, /sectionIsVisible\(access, section\)/);
    assert.match(SETTINGS_SRC, /isPlatformDeveloper: user\?\.isPlatformDeveloper === true/);
    /* No section may keep its own inline role expression instead. */
    assert.doesNotMatch(SETTINGS_SRC, /\(section !== "[^"]+" \|\|/);
    assert.doesNotMatch(SETTINGS_SRC, /const sections = group\.sections\.filter\(/);
  });

  test("every gated render branch is guarded by the same access map", () => {
    assert.match(SETTINGS_SRC, /tab === "Server \/ API Configuration" .*access\["Server \/ API Configuration"\].*<ServerApiSettings/);
    assert.match(SETTINGS_SRC, /tab === "Platform" && access\["Platform"\] && <PlatformAdmin/);
    assert.match(SETTINGS_SRC, /tab === "Message Templates" && access\["Message Templates"\] && <MessageTemplatesAdmin/);
    /* A section listed in the navigation but rendered blank is the same class
       of bug: Message Templates was offered to everyone while its content was
       admins-only. */
    assert.equal(sectionIsVisible(settingSectionAccess({}), "Message Templates"), false);
  });

  test("a Platform Developer permitted to configure Platform can select it", () => {
    /* The reported inconsistency. isPlatformDeveloper is the identity the
       Platform surface itself recognises — not a new role, and not granted to
       ordinary users below. */
    const developer = settingSectionAccess({ isPlatformDeveloper: true });
    assert.equal(sectionIsVisible(developer, "Platform"), true, "the Platform section must be selectable");
    assert.equal(sectionIsVisible(developer, "Server / API Configuration"), false, "host config stays superadmin-only");
    assert.equal(sectionIsVisible(developer, "Message Templates"), false, "company messaging stays admins-only");
  });

  test("the existing role and entitlement rules are unchanged", () => {
    const admin = settingSectionAccess({ isAdmin: true });
    assert.deepEqual(
      Object.entries(admin).filter(([, allowed]) => allowed).map(([section]) => section),
      ["Platform", "Message Templates"],
    );
    const superadmin = settingSectionAccess({ isSuperadmin: true });
    assert.deepEqual(
      Object.entries(superadmin).filter(([, allowed]) => allowed).map(([section]) => section),
      ["Server / API Configuration", "Platform", "Message Templates"],
    );
    assert.equal(sectionIsVisible(settingSectionAccess({ loyalty: true }), "Customer Loyalty"), true);
  });

  test("an unauthorized user gains no Settings privilege from the nav entry", () => {
    /* A caller with no isAdmin/isSuperadmin, no Platform Developer identity
       and no entitlements still sees the ungated section list, but every
       privileged section is filtered out — so the nav entry grants reach,
       never privilege. */
    const ordinary = settingSectionAccess({});
    assert.deepEqual(Object.values(ordinary), [false, false, false, false]);
    for (const section of Object.keys(ordinary)) {
      assert.equal(sectionIsVisible(ordinary, section), false, `${section} must stay hidden`);
    }
    /* Every other section is ungated, so the surface is never empty. */
    assert.equal(sectionIsVisible(ordinary, "General"), true);
    assert.equal(sectionIsVisible(ordinary, "Tax / VAT"), true);
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
    /* Every prop the surface already required is still supplied, in order. The
       `user` prop was added afterwards so the surface's own per-user gate
       (Platform Developer) has the session user to read; it is additive and
       the surface defaults it to null. */
    assert.match(
      LAYOUT_SRC,
      /<SettingsAdmin initialTab=\{settingsTab\} onTabChange=\{\(tab\) => navigate\("Settings", \{ settingsTab: tab \}\)\} user=\{user\} isAdmin=\{onlinePermissions\.isAdmin\} isSuperadmin=\{onlinePermissions\.isSuperadmin\} entitlements=\{onlinePermissions\.entitlements\} \/>/,
    );
  });

  test("no second Settings page or route was created", () => {
    assert.equal((LAYOUT_SRC.match(/<SettingsAdmin/g) || []).length, 1);
    assert.equal((LAYOUT_SRC.match(/const SettingsAdmin = lazy\(\(\) => import\("\.\.\/settings\/SettingsAdmin\.jsx"\)\)/g) || []).length, 1);
    assert.doesNotMatch(LAYOUT_SRC, /SettingsAdmin2|SecondSettings/);
  });

  test("the navigation still routes through the existing path builder", () => {
    assert.match(LAYOUT_SRC, /return buildAppPath\(nextPage, \{ settingsTab \}\);/);
    assert.match(LAYOUT_SRC, /onTabChange=\{\(tab\) => navigate\("Settings", \{ settingsTab: tab \}\)\}/);
  });

  test("Platform deep links keep Platform selected without remounting the Settings shell", () => {
    assert.equal(parseAppPath("/app/settings/platform").settingsTab, "Platform");
    assert.match(LAYOUT_SRC, /const \[settingsTab, setSettingsTab\] = useState\(\(\) => resolveRoute\(\)\.settingsTab \|\| "General"\)/);
    assert.doesNotMatch(LAYOUT_SRC, /<SettingsAdmin key=\{settingsTab\}/);
  });
});
