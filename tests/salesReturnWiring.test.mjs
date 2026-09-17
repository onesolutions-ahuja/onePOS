/*
 * T9M-SMALL - Sales Return UI/Service Wiring Audit
 *
 * Integration tests that wire validateSalesReturn() (from src/services/salesReturn.js)
 * against the shape of data used by the CustomerReturnModal UI and the
 * POST /api/returns/customer route handler.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSalesReturn } from "../src/services/salesReturn.js";

function saleItem(id, productId, quantity, unitPrice, discount = 0, tax = 0) {
  return {
    id,
    product_id: productId,
    quantity,
    unit_price: unitPrice,
    discount,
    tax,
    total: (quantity * unitPrice) + tax - discount,
  };
}

function returnItem(saleItemId, productId, quantity, unitPrice, tax = 0, discount = 0) {
  return { saleItemId, productId, quantity, unitPrice, tax, discount };
}

test("T9M-SMALL: partial return of two items - valid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 5, 4.0), saleItem("si-2", "prod-b", 2, 7.5)];
  const request = { saleId: "sale-100", items: [returnItem("si-1", "prod-a", 3, 4.0), returnItem("si-2", "prod-b", 1, 7.5)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(result.valid);
  assert.equal(result.items.length, 2);
  assert.equal(result.subtotal, 3 * 4.0 + 1 * 7.5);
});

test("T9M-SMALL: exceeding remaining quantity - invalid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 2, 5.0)];
  const request = { saleId: "sale-100", items: [returnItem("si-1", "prod-a", 3, 5.0)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.saleItemId === "si-1" && e.message.includes("exceeds remaining")), result.errors.map((e) => e.message).join("; "));
});

test("T9M-SMALL: duplicate saleItemId in request - invalid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 4, 6.0)];
  const request = { saleId: "sale-100", items: [returnItem("si-1", "prod-a", 1, 6.0), returnItem("si-1", "prod-a", 2, 6.0)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.saleItemId === "si-1" && e.message.includes("Duplicate saleItemId")), result.errors.map((e) => e.message).join("; "));
});


test("T9M-SMALL: invalid quantity (zero) - invalid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 4, 6.0)];
  const request = { saleId: "sale-100", items: [returnItem("si-1", "prod-a", 0, 6.0)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.saleItemId === "si-1" && e.message.includes("quantity must be greater than 0")), result.errors.map((e) => e.message).join("; "));
});

test("T9M-SMALL: invalid quantity (NaN) - invalid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 4, 6.0)];
  const request = { saleId: "sale-100", items: [returnItem("si-1", "prod-a", "abc", 6.0)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.saleItemId === "si-1" && e.message.includes("quantity must be a number")), result.errors.map((e) => e.message).join("; "));
});
test("T9M-SMALL: missing saleId - invalid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 4, 6.0)];
  const request = { items: [returnItem("si-1", "prod-a", 1, 6.0)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.saleItemId === null && e.message.includes("saleId is required")), result.errors.map((e) => e.message).join("; "));
});

test("T9M-SMALL: empty items array - invalid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 4, 6.0)];
  const request = { saleId: "sale-100", items: [] };
  const result = validateSalesReturn(request, saleItems);

test("T9M-SMALL: productId mismatch against original - invalid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 4, 6.0)];
  const request = { saleId: "sale-100", items: [returnItem("si-1", "prod-b", 1, 6.0)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.saleItemId === "si-1" && e.message.includes("productId does not match")), result.errors.map((e) => e.message).join("; "));
});

test("T9M-SMALL: refund calculation includes tax and discount - valid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 1, 100.0, 0, 15.0)];
  const request = { saleId: "sale-100", items: [returnItem("si-1", "prod-a", 1, 100.0, 15.0)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(result.valid);
  assert.equal(result.tax, 15.0);
  assert.equal(result.discount, 0);
  assert.equal(result.total, 115.0);
});

test("T9M-SMALL: discount cannot exceed line subtotal + tax - invalid", () => {
  const saleItems = [saleItem("si-1", "prod-a", 1, 10.0, 0, 1.0)];
  const request = { saleId: "sale-100", items: [returnItem("si-1", "prod-a", 1, 10.0, 1.0, 20.0)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.saleItemId === "si-1" && e.message.includes("discount cannot exceed")), result.errors.map((e) => e.message).join("; "));
});


test("T9M-SMALL: fully returned item cannot be returned again - invalid", () => {
  const saleItems = [{ id: "si-1", product_id: "prod-a", quantity: 3, unit_price: 6.0, returnedQuantity: 3 }];
  const request = { saleId: "sale-100", items: [returnItem("si-1", "prod-a", 1, 6.0)] };
  const result = validateSalesReturn(request, saleItems);
  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.saleItemId === "si-1" && e.message.includes("already been fully returned")), result.errors.map((e) => e.message).join("; "));
});

  assert.ok(!result.valid);
  assert.ok(result.errors.some((e) => e.saleItemId === null && e.message.includes("Return must include at least one item")), result.errors.map((e) => e.message).join("; "));
});


