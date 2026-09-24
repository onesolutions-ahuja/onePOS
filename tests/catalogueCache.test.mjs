import assert from "node:assert/strict";
import test from "node:test";
import { applyCatalogueChanges } from "../src/services/catalogueCache.js";

test("applies only changed products and removes deactivated records", () => {
  const next = applyCatalogueChanges({
    version: "10",
    products: [
      { id: "old", name: "Old" },
      { id: "changed", name: "Before" },
    ],
    categories: [{ id: "cat", name: "Grocery", active: true }],
  }, {
    version: "11",
    products: [
      { id: "changed", name: "After" },
      { id: "old", active: false },
      { id: "new", name: "New", active: true },
    ],
    categories: [{ id: "cat", name: "Food", active: true }],
  });

  assert.equal(next.version, "11");
  assert.deepEqual(next.products, [
    { id: "changed", name: "After" },
    { id: "new", name: "New", active: true },
  ]);
  assert.equal(next.categories[0].name, "Food");
});

test("retains last known good cache when a payload has no version", () => {
  const current = { version: "10", products: [{ id: "p1" }], categories: [] };
  const next = applyCatalogueChanges(current, { products: [] });
  assert.equal(next.version, "10");
  assert.deepEqual(next.products, [{ id: "p1" }]);
});

test("modifier cache is tenant/store/product scoped and supports offline lazy lookup", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const { saveModifierCache, loadModifierCache } = await import("../src/services/catalogueCache.js");
  const a = { companyId: "c1", storeId: "s1" };
  const b = { companyId: "c1", storeId: "s2" };
  assert.equal(await saveModifierCache(a, "p1", [{ id: "m1", group_id: "g1" }]), true);
  assert.deepEqual((await loadModifierCache(a, "p1")).rows, [{ id: "m1", group_id: "g1" }]);
  assert.equal(await loadModifierCache(a, "p2"), null);
  assert.equal(await loadModifierCache(b, "p1"), null);
  delete globalThis.localStorage;
});
