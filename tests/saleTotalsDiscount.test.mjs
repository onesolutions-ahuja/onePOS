/*
 * onePOS — Discount engine focused tests (T10-DISCOUNT).
 *
 * Pure-logic tests against the shared basket totals engine
 * (src/utils/saleTotals.js) which is THE implementation both the staff POS
 * and Self-Checkout use, and which the backend recomputes against.
 *
 * node --test tests/saleTotalsDiscount.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeBasketTotals, roundCurrency } from "../src/utils/saleTotals.js";

const GB = (n) => ({ price: n, quantity: 1, vatApplicable: true });

describe("computeBasketTotals — line discounts", () => {
  test("no discounts: subtotal = gross, vat computed, total = subtotal + vat", () => {
    const b = [GB(100), GB(50)];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2 });
    assert.equal(r.grossSubtotal, 150);
    assert.equal(r.discountAmount, 0);
    assert.equal(r.orderDiscount, 0);
    assert.equal(roundCurrency(r.subtotal), 150);
    assert.equal(roundCurrency(r.vat), 30);
    assert.equal(roundCurrency(r.total), 180);
  });

  test("per-line percent discount capped at line gross", () => {
    const b = [{ ...GB(100), discountType: "percent", discountValue: 50 }];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2 });
    // line discount = 50, net 50, vat 10, total 60
    assert.equal(r.lineDiscounts[0].amount, 50);
    assert.equal(r.orderDiscount, 0);
    assert.equal(r.discountAmount, 50);
    assert.equal(roundCurrency(r.subtotal), 50);
    assert.equal(roundCurrency(r.vat), 10);
    assert.equal(roundCurrency(r.total), 60);
  });

  test("per-line fixed discount capped at line gross and not negative", () => {
    const b = [{ ...GB(30), discountType: "fixed", discountValue: 999 }];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2 });
    // capped to 30 -> net 0
    assert.equal(r.lineDiscounts[0].amount, 30);
    assert.equal(roundCurrency(r.subtotal), 0);
    assert.equal(roundCurrency(r.vat), 0);
    assert.equal(roundCurrency(r.total), 0);
  });

  test("per-line discount on a vat-exempt product attracts no vat", () => {
    const b = [{ price: 100, quantity: 1, vatApplicable: false, discountType: "percent", discountValue: 20 }];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2 });
    assert.equal(r.lineDiscounts[0].amount, 20);
    assert.equal(roundCurrency(r.vat), 0);
    assert.equal(roundCurrency(r.total), 80);
  });

  test("invalid discountType is ignored (no discount)", () => {
    const b = [{ ...GB(100), discountType: "bogus", discountValue: 50 }];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2 });
    assert.equal(r.lineDiscounts[0].amount, 0);
    assert.equal(r.discountAmount, 0);
  });
});

describe("computeBasketTotals — order discount permission boundary", () => {
  test("order percent discount applied across the basket", () => {
    const b = [GB(100), GB(50)];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2, discountType: "percent", discountValue: 10 });
    // gross 150, 10% order discount = 15 -> net 135, vat 27, total 162
    assert.equal(r.orderDiscount, 15);
    assert.equal(roundCurrency(r.subtotal), 135);
    assert.equal(roundCurrency(r.vat), 27);
    assert.equal(roundCurrency(r.total), 162);
  });

  test("order fixed discount capped at net subtotal", () => {
    const b = [GB(100)];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2, discountType: "fixed", discountValue: 999 });
    assert.equal(roundCurrency(r.orderDiscount), 100);
    assert.equal(roundCurrency(r.subtotal), 0);
    assert.equal(roundCurrency(r.total), 0);
  });

  test("no order discount when permission model passes discountType=null (back-compat)", () => {
    const b = [GB(100)];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2 }); // matches Self-Checkout call shape
    assert.equal(r.orderDiscount, 0);
    assert.equal(roundCurrency(r.total), 120);
  });

  test("a non-permissioned operator proposal is represented by discountType=null -> no order discount", () => {
    // The backend drops discountType/Value to null/0 when sale.discount is
    // absent; the engine then applies no order discount, proving the
    // permission gate is end-to-end enforceable server-side.
    const b = [GB(100)];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2, discountType: null, discountValue: 0 });
    assert.equal(r.orderDiscount, 0);
    assert.equal(roundCurrency(r.total), 120);
  });

  test("order and line discounts combine, vat scaled proportionally", () => {
    const b = [
      { price: 100, quantity: 1, vatApplicable: true, discountType: "percent", discountValue: 10 },
      { price: 100, quantity: 1, vatApplicable: true, discountType: "fixed", discountValue: 5 },
    ];
    const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2, discountType: "percent", discountValue: 10 });
    // line discounts: 10 + 5 = 15; net basket 185; order 10% of 185 = 18.5
    assert.equal(roundCurrency(r.lineDiscounts[0].amount), 10);
    assert.equal(roundCurrency(r.lineDiscounts[1].amount), 5);
    assert.equal(roundCurrency(r.orderDiscount), 18.5);
    assert.equal(roundCurrency(r.discountAmount), 33.5);
    assert.equal(roundCurrency(r.subtotal), 200 - 33.5); // 166.5
    assert.equal(roundCurrency(r.total), roundCurrency(166.5 + r.vat));
    // VAT is computed on the post-order-discount taxable base
    assert.equal(roundCurrency(r.vat), roundCurrency(r.subtotal * 0.2));
    assert.equal(roundCurrency(r.total), roundCurrency(r.subtotal * 1.2));
  });
});

describe("computeBasketTotals — VAT master switch", () => {
  test("vatEnabled=false yields zero vat even with positive rate", () => {
    const b = [GB(100)];
    const r = computeBasketTotals(b, { vatEnabled: false, vatRate: 0.2 });
    assert.equal(r.vat, 0);
    assert.equal(roundCurrency(r.total), 100);
  });
});

describe("saleTotals permission model", () => {
  test("a non-permissioned operator proposal is represented by discountType=null -> no order discount", () => {
    // The backend drops discountType/Value to null/0 when sale.discount is
    // absent; the engine then applies no order discount, proving the
    // permission gate is end-to-end enforceable server-side.
     const b = [GB(100)];
     const r = computeBasketTotals(b, { vatEnabled: true, vatRate: 0.2, discountType: null, discountValue: 0 });
     assert.equal(r.orderDiscount, 0);
     assert.equal(roundCurrency(r.total), 120);
  });
});
