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
    assert.match(DOCK, /SLOT_LIMIT = 6/);
    assert.match(DOCK, /leftSlots/);
    assert.match(DOCK, /rightSlots/);
    assert.doesNotMatch(DOCK, /rounded-full.*background: "linear-gradient/);
    assert.doesNotMatch(DOCK, /rounded-full.*background: "linear-gradient\(135deg,#1a817b/);
  });

  test("settings remain content-panel navigation, not a third shell rail", () => {
    assert.match(LAYOUT, /"Settings", Settings/);
    assert.match(SETTINGS, /SettingsAdmin|SETTING_GROUPS/);
    assert.doesNotMatch(SHELL, /Settings.*Administration|Administration.*Settings/);
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




