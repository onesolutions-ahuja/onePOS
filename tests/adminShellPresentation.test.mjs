/*
 * onePOS Admin Shell contract tests.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSwitcherApps, groupNavItems } from "../src/utils/adminApps.js";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const LAYOUT = read("../src/pages/admin/AdminLayout.jsx");
const SHELL = read("../src/components/AdminShell.jsx");
const DOCK = read("../src/components/AdminNavDock.jsx");
const SETTINGS = read("../src/pages/settings/SettingsAdmin.jsx");

describe("admin shell contract", () => {
  test("top-bar floating menus use the shared dropdown layer", () => {
    assert.match(read("../src/index.css"), /--onepos-layer-dropdown: 30;/);
    assert.match(SHELL, /z-\[var\(--onepos-layer-dropdown\)\]/);
    assert.match(SHELL, /data-testid="admin-nav-menu"/);
  });

  test("shell header and Settings navigation use semantic layers", () => {
    const css = read("../src/index.css");
    assert.match(css, /\.onepos-shell-header \{[\s\S]*z-index: var\(--onepos-layer-sticky\);/);
    assert.match(css, /\.settings-sidebar \{[\s\S]*z-index: var\(--onepos-layer-page\);/);
  });

  test("AdminLayout renders the shared AdminShell with header + content frame", () => {
    assert.match(LAYOUT, /import AdminShell from "\.\.\/\.\.\/components\/AdminShell\.jsx";/);
    assert.match(LAYOUT, /<AdminShell/);
    assert.match(SHELL, /data-testid="admin-shell"/);
    assert.match(SHELL, /data-testid="admin-header"/);
    assert.match(SHELL, /data-testid="admin-shell-content"/);
  });

  test("the shell removes the permanent desktop sidebar and keeps a top launcher", () => {
    assert.doesNotMatch(SHELL, /data-testid="admin-sidebar"/);
    assert.doesNotMatch(SHELL, /onepos-sidebar/);
    assert.match(SHELL, /data-testid="admin-nav-menu-trigger"/);
    assert.match(SHELL, /data-testid="app-switcher"/);
  });

  test("dock keeps the launcher with non-teal styling and responsive left/right slots", () => {
    assert.match(DOCK, /quickSlots/);
    assert.match(DOCK, /admin-nav-dock-wing/);
    assert.match(DOCK, /SLOT_LIMIT = 6/);
    assert.doesNotMatch(DOCK, /rounded-full.*background: "linear-gradient/);
    assert.doesNotMatch(DOCK, /rounded-full.*background: "linear-gradient\(135deg,#1a817b/);
  });

  test("settings remain content-panel navigation, not a third shell rail", () => {
    assert.match(LAYOUT, /Settings/);
    assert.match(SETTINGS, /SettingsAdmin|SETTING_GROUPS/);
    assert.doesNotMatch(SHELL, /Settings.*Administration|Administration.*Settings/);
  });

  test("the shell and Settings forms retain small-screen layout fallbacks", () => {
    assert.match(SETTINGS, /grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3/);
    assert.match(SHELL, /data-testid="admin-shell-content"/);
    assert.match(read("../src/index.css"), /@media \(max-width: 639px\) \{[\s\S]*\.onepos-shell-header/);
  });
});

describe("navigation helpers", () => {
  test("app switcher still derives from the runtime catalog", () => {
    const apps = buildSwitcherApps([
      { module_key: "retail_pos", name: "POS & Sales", description: "Till sales.", route: "/app/sales" },
      { module_key: "products", name: "Products", route: "/app/products" },
    ]);
    assert.equal(apps.length, 2);
    assert.equal(apps[0].route, "/app/sales");
  });

  test("grouping keeps Settings in Administration once and does not invent pages", () => {
    const groups = groupNavItems([["Dashboard", null], ["Settings", null], ["Audit Log", null], ["Licensing", null]]);
    const administration = groups.find((group) => group.label === "Administration");
    assert.ok(administration);
    assert.deepEqual(administration.items.map(([name]) => name), ["Audit Log", "Licensing", "Settings"]);
    const total = groups.flatMap((group) => group.items).filter(([name]) => name === "Settings").length;
    assert.equal(total, 1);
  });
});



