import test from "node:test";
import assert from "node:assert/strict";
import { inventoryValue, valuationRow } from "../services/inventoryValuation.js";

test("inventory valuation uses quantity multiplied by cost, not selling price", () => {
  assert.equal(inventoryValue(95, 4.25), 403.75);
  assert.deepEqual(valuationRow({ stock_quantity: "3", cost_price: "2.50", price: "9.99" }), {
    stock_quantity: "3",
    cost_price: "2.50",
    price: "9.99",
    quantity: 3,
    unitCost: 2.5,
    stockValue: 7.5,
  });
});

test("missing cost does not invent a valuation", () => {
  assert.equal(valuationRow({ quantity: 5, cost_price: null }).stockValue, null);
});
