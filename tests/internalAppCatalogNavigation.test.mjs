import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/admin/AdminLayout.jsx", import.meta.url), "utf8");

test("AdminLayout loads the authenticated runtime app catalogue", () => {
  assert.match(source, /apiRequest\("\/api\/platform\/runtime\/app-catalog"\)/);
  assert.match(source, /new Set\(data\.data\.map/);
});

test("catalogue availability is intersected with existing permission-filtered navigation", () => {
  assert.match(source, /const permissionFilteredItems = \[/);
  assert.match(source, /filterNavigationByCatalog\(permissionFilteredItems, catalogKeys\)/);
  assert.match(source, /catalogKeys\.has\(moduleKey\)/);
});

test("existing application labels map to canonical catalogue keys", () => {
  assert.match(source, /Products: "products"/);
  assert.match(source, /Inventory: "inventory"/);
  assert.match(source, /Customers: "customers"/);
  assert.match(source, /"Order Prep": "online_orders"/);
  assert.match(source, /Integrations: "integrations"/);
});

test("catalogue failures preserve the existing navigation fallback", () => {
  assert.match(source, /const \[catalogKeys, setCatalogKeys\] = useState\(null\)/);
  assert.match(source, /retain the existing permission-filtered navigation/);
  assert.match(source, /if \(alive\) setCatalogKeys\(null\)/);
});

test("essential shell controls are not catalogue-filtered", () => {
  assert.match(source, /Settings/);
  assert.match(source, /Licensing/);
  assert.doesNotMatch(source, /Settings: "platform"/);
});
