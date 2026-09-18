/*
 * T10W tests - Accounting Integration Foundation.
 *
 * Pure service tests: no database, no HTTP, no provider.
 *
 *   node --test tests/accountingExport.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  money,
  sumMoney,
  vatCategoryLabel,
  normalizeSale,
  normalizePurchase,
  normalizeRefund,
  normalizeCustomerCreditTransaction,
  saleHeaderShape,
  saleItemShape,
  paymentShape,
  customerShape,
  storeShape,
  purchaseShape,
  purchaseItemShape,
  supplierShape,
  refundShape,
  stockReturnShape,
  loyaltyTransactionShape,
  ACCOUNTING_ENTITY_TYPES,
  sourceIdColumnFor,
  idempotencyLookupParams,
} from "../services/accountingExport.js";

/* ============================================================ money helpers */

test("money rounds to 2dp consistently", () => {
  assert.strictEqual(money(10), 10);
  assert.strictEqual(money(10.5), 10.5);
  assert.strictEqual(money(10.555), 10.56);
  assert.strictEqual(money(10.554), 10.55);
  assert.strictEqual(money("10.555"), 10.56);
  assert.strictEqual(money(null), 0);
    assert.strictEqual(money(undefined), 0);
});


test("normalizeSale handles walk-in customer (no customer_id)", () => {
  const walkInSale = { ...aSale, customer_id: null, customer_name: null, customer_email: null, customer_phone: null };
  const rec = normalizeSale(walkInSale, [], [], null, aStore);
  assert.strictEqual(rec.customer_id, null);
  assert.strictEqual(rec.customer_name, null);
  assert.strictEqual(rec.is_walk_in, true);
});

test("normalizeSale uses fallback names when customer object is absent", () => {
  const rec = normalizeSale(aSale, [], [], null, null);
  assert.strictEqual(rec.customer_name, "Jane Doe");
  assert.strictEqual(rec.customer_email, "jane@example.com");
  assert.strictEqual(rec.customer_phone, "07700 900123");
});

test("normalizeSale handles multiple payment methods", () => {
  const payments = [
    { payment_method: "Cash", amount: 50, provider_transaction_id: null },
    { payment_method: "Card", amount: 46, provider_transaction_id: "tpos-123" },
  ];
  const rec = normalizeSale(aSale, [], payments, null, null);
  assert.ok(rec.payment_summary.some((p) => p.payment_method === "Cash" && p.amount === 50));
  assert.ok(rec.payment_summary.some((p) => p.payment_method === "Card" && p.amount === 46));
  assert.strictEqual(rec.payment_total, 96);
});

test("normalizeSale with zero VAT (VAT exempt sale)", () => {
  const zeroVatSale = { ...aSale, subtotal: 50, tax: 0, total: 50 };
  const rec = normalizeSale(zeroVatSale, [], [], null, null);
  assert.strictEqual(rec.net_sales, 50);
  assert.strictEqual(rec.vat_amount, 0);
  assert.strictEqual(rec.gross_sales, 50);
});

test("saleHeaderShape / saleItemShape / paymentShape / customerShape / storeShape carry authoritative fields", () => {
  assert.deepStrictEqual(
    saleHeaderShape(aSale),
    {
      id: "sale-1",
      receipt_number: "POS-0001",
      created_at: "2025-01-15T10:00:00Z",
      store_id: "store-1",
      customer_id: "cust-1",
      customer_name: "Jane Doe",
      customer_email: "jane@example.com",
      customer_phone: "07700 900123",
      subtotal: 80,
      tax: 16,
      discount: 2,
      total: 96,
      status: "completed",
      completed_at: "2025-01-15T10:00:00Z",
      online_order_id: null,
    }
  );

  assert.deepStrictEqual(
    saleItemShape(aSaleItems[0]),
    {
      product_id: "prod-1",
      product_name: "Coffee",
      quantity: 2,
      unit_price: 3.5,
      discount: 0,
      tax: 0.7,
      total: 7.7,
      sku: "COF-001",
      barcode: "5012345678901",
      vat_rate: 20,
      vat_applicable: true,
    }
  );

  assert.deepStrictEqual(paymentShape(aPayments[0]), {
    payment_method: "Card",
    amount: 96,
    provider_transaction_id: "tpos-123",
  });

  assert.deepStrictEqual(customerShape(aCustomer), {
    id: "cust-1",
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "07700 900123",
  });

  assert.deepStrictEqual(storeShape(aStore), {
    id: "store-1",
    name: "High Street",
    code: "HS01",
  });

  assert.deepStrictEqual(storeShape(null), null);
});
/* ============================================================ sale normalization */

const aSale = {
  id: "sale-1",
  receipt_number: "POS-0001",
  created_at: "2025-01-15T10:00:00Z",
  store_id: "store-1",
  customer_id: "cust-1",
  customer_name: "Jane Doe",
  customer_email: "jane@example.com",
  customer_phone: "07700 900123",
  subtotal: 80.00,
  tax: 16.00,
  discount: 2.00,
  total: 96.00,
  status: "completed",
  completed_at: "2025-01-15T10:00:00Z",
  online_order_id: null,
};

const aSaleItems = [
  {
    product_id: "prod-1",
    product_name: "Coffee",
    quantity: 2,
    unit_price: 3.50,
    discount: 0,
    tax: 0.70,
    total: 7.70,
    sku: "COF-001",
    barcode: "5012345678901",
    vat_rate: 20,
    vat_applicable: true,
  },
  {
    product_id: "prod-2",
    product_name: "Tea",
    quantity: 1,
    unit_price: 2.50,
    discount: 0,
    tax: 0.50,
    total: 3.00,
    sku: "TEA-001",
    barcode: "5012345678902",
    vat_rate: 20,
    vat_applicable: true,
  },
];

const aPayments = [
  { payment_method: "Card", amount: 96.00, provider_transaction_id: "tpos-123" },
];

const aCustomer = { id: "cust-1", name: "Jane Doe", email: "jane@example.com", phone: "07700 900123" };
const aStore = { id: "store-1", name: "High Street", code: "HS01" };

test("normalizeSale produces provider-neutral accounting record", () => {
  const rec = normalizeSale(aSale, aSaleItems, aPayments, aCustomer, aStore);

  assert.strictEqual(rec.source_type, "sale");
  assert.strictEqual(rec.source_id, "sale-1");
  assert.strictEqual(rec.document_reference, "POS-0001");
  assert.strictEqual(rec.document_status, "completed");
  assert.strictEqual(rec.store_id, "store-1");
  assert.strictEqual(rec.store_name, "High Street");
  assert.strictEqual(rec.store_code, "HS01");
  assert.strictEqual(rec.customer_id, "cust-1");
  assert.strictEqual(rec.customer_name, "Jane Doe");
  assert.strictEqual(rec.customer_email, "jane@example.com");
  assert.strictEqual(rec.customer_phone, "07700 900123");
  assert.strictEqual(rec.is_walk_in, false);
  assert.strictEqual(rec.net_sales, 80);
  assert.strictEqual(rec.vat_amount, 16);
  assert.strictEqual(rec.gross_sales, 96);
  assert.ok(Array.isArray(rec.payment_summary));
  assert.ok(rec.payment_summary.some((p) => p.payment_method === "Card" && p.amount === 96));
  assert.strictEqual(rec.payment_total, 96);
  assert.ok(Array.isArray(rec.lines));
  assert.strictEqual(rec.lines.length, 2);
  const coffee = rec.lines.find((l) => l.product_id === "prod-1");
  assert.ok(coffee);
  assert.strictEqual(coffee.product_name, "Coffee");
  assert.strictEqual(coffee.quantity, 2);
  assert.strictEqual(coffee.unit_price, 3.5);
  assert.strictEqual(coffee.line_net, 7);
  assert.strictEqual(coffee.line_vat, 0.7);
  assert.strictEqual(coffee.line_gross, 7.7);
  assert.strictEqual(coffee.vat_rate, 20);
  assert.strictEqual(coffee.vat_category, "VAT_STANDARD");
  assert.strictEqual(coffee.vat_applicable, true);
  assert.strictEqual(coffee.product_sku, "COF-001");
      assert.strictEqual(coffee.product_barcode, "5012345678901");
});

test("money handles edge cases", () => {
  assert.strictEqual(money(NaN), 0);
  assert.strictEqual(money(Infinity), 0);
  assert.strictEqual(money(-10.555), -10.55);
});

test("sumMoney sums an array of money values", () => {
  assert.strictEqual(sumMoney([1, 2, 3]), 6);
  assert.strictEqual(sumMoney([1.5, 2.5]), 4);
  assert.strictEqual(sumMoney([]), 0);
      assert.strictEqual(sumMoney([0.1, 0.2]), 0.30000000000000004);
});

/* ============================================================ VAT categories */

test("vatCategoryLabel derives stable category from rate + applicability", () => {
  assert.strictEqual(vatCategoryLabel(20, true), "VAT_STANDARD");
  assert.strictEqual(vatCategoryLabel(20, false), "VAT_EXEMPT");
  assert.strictEqual(vatCategoryLabel(20, null), "VAT_EXEMPT");
  assert.strictEqual(vatCategoryLabel(20, undefined), "VAT_EXEMPT");
  assert.strictEqual(vatCategoryLabel(0, true), "VAT_ZERO");
  assert.strictEqual(vatCategoryLabel(5, true), "VAT_REDUCED");
  assert.strictEqual(vatCategoryLabel(4.9, true), "VAT_REDUCED");
  assert.strictEqual(vatCategoryLabel(5.1, true), "VAT_STANDARD");
      assert.strictEqual(vatCategoryLabel(null, true), "VAT_ZERO");
  assert.strictEqual(vatCategoryLabel(undefined, true), "VAT_STANDARD");
  assert.strictEqual(vatCategoryLabel(NaN, true), "VAT_STANDARD");
});

/* ============================================================ store isolation (pure logic) */

test("idempotencyLookupParams enforces company isolation in lookup key", () => {
  const compA = idempotencyLookupParams(ACCOUNTING_ENTITY_TYPES.SALE, "sale-1", "comp-A");
  const compB = idempotencyLookupParams(ACCOUNTING_ENTITY_TYPES.SALE, "sale-1", "comp-B");
  assert.notStrictEqual(compA.company_id, compB.company_id);
  // Same sale ID, different companies → different idempotency keys
  assert.notDeepStrictEqual(compA, compB);
});

test("idempotencyLookupParams preserves store scoping when present", () => {
  const withStore = idempotencyLookupParams(ACCOUNTING_ENTITY_TYPES.SALE, "sale-1", "comp-1", "store-1");
  const noStore = idempotencyLookupParams(ACCOUNTING_ENTITY_TYPES.SALE, "sale-1", "comp-1", null);
  assert.strictEqual(withStore.store_id, "store-1");
  assert.strictEqual(noStore.store_id, null);
});