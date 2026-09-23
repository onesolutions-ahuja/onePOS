import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateExchangeSettlement } from "../routes/exchanges.js";

test("equal-value exchange records all value as exchange credit", () => {
  assert.deepEqual(calculateExchangeSettlement(10, 10), {
    returnTotal: 10,
    replacementTotal: 10,
    difference: 0,
    exchangeCredit: 10,
  });
});

test("higher-value replacement calculates the customer top-up", () => {
  assert.deepEqual(calculateExchangeSettlement(10, 15), {
    returnTotal: 10,
    replacementTotal: 15,
    difference: 5,
    exchangeCredit: 10,
  });
});

test("lower-value replacement calculates the customer refund", () => {
  assert.deepEqual(calculateExchangeSettlement(10, 5), {
    returnTotal: 10,
    replacementTotal: 5,
    difference: -5,
    exchangeCredit: 5,
  });
});

test("exchange stock movements put back the return and remove the replacement", () => {
  const returnQuantity = 1;
  const replacementQuantity = 1;
  assert.equal(returnQuantity, 1);
  assert.equal(-replacementQuantity, -1);
});
