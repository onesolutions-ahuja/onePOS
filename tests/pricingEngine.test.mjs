import test from "node:test";
import assert from "node:assert/strict";
import { applyQuantityOffer, resolvePrice } from "../services/pricingEngine.js";

test("price lists and scheduled prices resolve before promotions", () => {
  const result = resolvePrice({
    basePrice: 10,
    scheduledPrices: [{ price: 12, starts_at: "2025-01-01T00:00:00Z", active: true }],
    priceListPrice: 9,
    promotions: [{ id: "sale", discount_type: "percent", discount_value: 10, active: true }],
    at: new Date("2025-06-01T00:00:00Z"),
  });
  assert.equal(result.pricingSource, "price_list");
  assert.equal(result.unitPrice, 8.1);
});

test("customer pricing wins over group and price list", () => {
  const result = resolvePrice({
    basePrice: 10,
    customerPrice: 7.5,
    groupPrice: 8,
    priceListPrice: 9,
  });
  assert.equal(result.unitPrice, 7.5);
  assert.equal(result.pricingSource, "customer");
});

test("overlapping promotions choose the lowest non-negative result", () => {
  const result = resolvePrice({
    basePrice: 10,
    promotions: [
      { id: "percent", discount_type: "percent", discount_value: 10, active: true },
      { id: "fixed", discount_type: "fixed", discount_value: 15, active: true },
    ],
  });
  assert.equal(result.unitPrice, 0);
  assert.equal(result.promotionId, "fixed");
});

test("BOGO and buy-two-get-one never create negative totals", () => {
  assert.deepEqual(applyQuantityOffer(1, 10, { buy_quantity: 1, get_quantity: 1 }), {
    total: 10, paidQuantity: 1, freeQuantity: 0,
  });
  assert.deepEqual(applyQuantityOffer(2, 10, { buy_quantity: 1, get_quantity: 1 }), {
    total: 10, paidQuantity: 1, freeQuantity: 1,
  });
  assert.deepEqual(applyQuantityOffer(6, 10, { buy_quantity: 2, get_quantity: 1 }), {
    total: 40, paidQuantity: 4, freeQuantity: 2,
  });
  assert.equal(applyQuantityOffer(3, 10, { buy_quantity: 2, get_quantity: 1, offer_type: "fixed_set", set_price: 25 }).total, 25);
  const resolved = resolvePrice({
    basePrice: 10,
    quantity: 2,
    promotions: [{ id: "bogo", discount_type: "percent", discount_value: 0, buy_quantity: 1, get_quantity: 1, active: true }],
  });
  assert.equal(resolved.total, 10);
  assert.equal(resolved.freeQuantity, 1);
});

test("expired and future prices/promotions are ignored", () => {
  const result = resolvePrice({
    basePrice: 10,
    scheduledPrices: [
      { price: 5, starts_at: "2027-01-01T00:00:00Z", active: true },
      { price: 6, starts_at: "2024-01-01T00:00:00Z", ends_at: "2025-01-01T00:00:00Z", active: true },
    ],
    promotions: [{ id: "future", discount_type: "fixed", discount_value: 9, starts_at: "2027-01-01T00:00:00Z", active: true }],
    at: new Date("2025-06-01T00:00:00Z"),
  });
  assert.equal(result.unitPrice, 10);
});
