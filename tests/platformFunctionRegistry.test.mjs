import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_FUNCTIONS, getPlatformFunction } from "../services/platformFunctionRegistry.js";
import { DEFAULT_PAYMENT_METHODS, listPaymentMethods } from "../services/paymentMethods.js";

test("registered function keys are unique and payment capabilities are discoverable", () => {
  const keys = PLATFORM_FUNCTIONS.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(getPlatformFunction("payment.methods.list"));
  assert.ok(getPlatformFunction("payment.method.validate"));
});

test("payment methods have canonical defaults without a database", async () => {
  const methods = await listPaymentMethods(null, null);
  assert.deepEqual(methods.map((item) => item.code), DEFAULT_PAYMENT_METHODS.map((item) => item.code));
  assert.equal(methods.find((item) => item.code === "cash").allowOffline, true);
  assert.equal(methods.find((item) => item.code === "card").allowOffline, false);
});

test("pricing, inventory and supplier-account capabilities are canonical registered functions", async () => {
  for (const key of [
    "pricing.resolve", "pricing.discount.apply", "pricing.quantity_offer.apply",
    "supplier.invoice.status.resolve", "supplier.payment.allocate",
    "inventory.low_stock.classify", "inventory.batch.expiry_status", "inventory.batch.fefo_sort",
    "inventory.replenishment.classify", "inventory.valuation.calculate",
    "combo_deal.validate", "combo_deal.apply",
  ]) assert.ok(getPlatformFunction(key), `missing ${key}`);

  const pricing = await getPlatformFunction("pricing.resolve").handler({ inputs: { basePrice: 10, promotions: [{ id: "p1", active: true, discount_type: "percent", discount_value: 10 }] } });
  assert.equal(pricing.unitPrice, 9);

  const status = await getPlatformFunction("supplier.invoice.status.resolve").handler({ inputs: { total: 100, paid: 25 } });
  assert.equal(status, "PARTIALLY_PAID");

  const value = await getPlatformFunction("inventory.valuation.calculate").handler({ inputs: { quantity: 3, unitCost: 2.5 } });
  assert.equal(value, 7.5);
});


test("transactional inventory and till rules are registered and reusable", async () => {
  for (const key of [
    "inventory.movement.create", "inventory.balance.rebuild", "inventory.balance.reconcile",
    "inventory.batch.receive", "inventory.batch.allocate_fefo", "inventory.batch.consume",
    "inventory.batch.sync_movement", "till.cash.calculate", "till.close.calculate",
    "till.cash_movement.validate"
  ]) assert.ok(getPlatformFunction(key), `${key} should be registered`);

  const cash = await getPlatformFunction("till.cash.calculate").handler({ inputs: { openingCash: 100, cashIn: 20, cashOut: 5, cashSales: 50, cashRefunds: 10 } });
  assert.equal(cash, 155);
  const close = await getPlatformFunction("till.close.calculate").handler({ inputs: { openingCash: 100, cashSales: 50, cashRefunds: 10, countedCash: 138 } });
  assert.deepEqual(close, { expectedCash: 140, countedCash: 138, cashDifference: -2 });
});

test("returns and exchanges reuse canonical payment/settlement functions", async () => {
  for (const key of ["payment.refund.remaining", "payment.refund.allocate", "exchange.settlement.calculate"])
    assert.ok(getPlatformFunction(key), `${key} should be registered`);

  const payments = [{ method: "cash", amount: 10 }, { method: "card", amount: 20 }];
  const refundedByMethod = { cash: 4 };
  const remaining = await getPlatformFunction("payment.refund.remaining").handler({ inputs: { payments, refundedByMethod } });
  assert.equal(remaining, 26);
  const allocated = await getPlatformFunction("payment.refund.allocate").handler({ inputs: { payments, refundAmount: 12, refundedByMethod } });
  assert.deepEqual(allocated, { allocation: [{ method: "cash", amount: 6 }, { method: "card", amount: 6 }], unallocated: 0 });
  const settlement = await getPlatformFunction("exchange.settlement.calculate").handler({ inputs: { returnTotal: 10, replacementTotal: 15 } });
  assert.deepEqual(settlement, { returnTotal: 10, replacementTotal: 15, difference: 5, exchangeCredit: 10 });
});

test("payment.tender.validate is canonical and rejects duplicate/split mismatches", async () => {
  const fn = getPlatformFunction("payment.tender.validate");
  assert.ok(fn);
  const lines = await fn.handler({ inputs: { payments: [{ paymentMethod: "cash", amount: 5 }, { paymentMethod: "card", amount: 7 }], total: 12, allowedMethods: ["cash", "card"] } });
  assert.deepEqual(lines, [{ method: "cash", amount: 5 }, { method: "card", amount: 7 }]);
  await assert.rejects(() => fn.handler({ inputs: { payments: [{ paymentMethod: "cash", amount: 5 }, { paymentMethod: "cash", amount: 7 }], total: 12, allowedMethods: ["cash"] } }), /Duplicate payment method/);
});


test("batch 2 purchasing, supplier and layaway capabilities are registered", () => {
  for (const key of [
    "purchase.receipt.plan", "purchase.receive",
    "supplier.invoice.status.resolve", "supplier.payment.allocate", "supplier.payment.execute", "supplier.feed.normalize", "supplier.feed.match",
    "layaway.balance.calculate", "layaway.deposit.validate", "layaway.payment.validate", "layaway.completion.check"
  ]) assert.ok(getPlatformFunction(key), `${key} should be registered`);
});

test("batch 3 customer, loyalty, tax and online-order capabilities are canonical", async () => {
  const keys = new Set(PLATFORM_FUNCTIONS.map((fn) => fn.key));
  for (const key of [
    "customer.credit.transaction.build_sale",
    "customer.credit.balance.calculate",
    "loyalty.earn.calculate",
    "loyalty.redemption.calculate",
    "loyalty.reversal.calculate",
    "tax.calculate",
    "online_order.create",
    "online_order.transition",
  ]) assert.equal(keys.has(key), true, `${key} should be registered`);

  const tax = await getPlatformFunction("tax.calculate").handler({ inputs: { amount: 120, rate: 20, inclusive: true } });
  assert.deepEqual(tax, { net: 100, tax: 20, gross: 120, rate: 20 });
  const earn = await getPlatformFunction("loyalty.earn.calculate").handler({ inputs: { saleTotal: 100, programme: { loyalty_enabled: true, loyalty_earning_rate: 0.01 } } });
  assert.deepEqual(earn, { points: 1, eligible: true });
});
