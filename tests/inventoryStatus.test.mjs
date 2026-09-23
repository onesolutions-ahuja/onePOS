import test from "node:test";
import assert from "node:assert/strict";
import { classifyLowStock } from "../services/inventory.js";

test("low-stock status distinguishes above, at, below, and untracked stock", () => {
  assert.equal(classifyLowStock({ stock_quantity: 7, low_stock_level: 5, track_stock: true }).isLow, false);
  assert.equal(classifyLowStock({ stock_quantity: 5, low_stock_level: 5, track_stock: true }).isLow, true);
  assert.equal(classifyLowStock({ stock_quantity: 3, low_stock_level: 5, track_stock: true }).isLow, true);
  assert.equal(classifyLowStock({ stock_quantity: 0, low_stock_level: 5, track_stock: false }).isLow, false);
  assert.equal(classifyLowStock({ stock_quantity: 0, low_stock_level: 0, track_stock: true }).isLow, false);
});
