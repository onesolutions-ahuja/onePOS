import test from "node:test";
import assert from "node:assert/strict";
import { planReceipt } from "../services/purchasing.js";

const lines = [{ purchase_item_id: "a", product_id: "p", quantity: 100, received_quantity: 0 }];

test("receipt planning supports partial and remaining receipt", () => {
  const first = planReceipt(lines, [{ purchaseItemId: "a", quantity: 60 }]);
  assert.equal(first[0].quantity, 60);
  const second = planReceipt([{ ...lines[0], received_quantity: 60 }]);
  assert.equal(second[0].quantity, 40);
});

test("receipt planning rejects over-receiving and duplicate empty receipt", () => {
  assert.throws(() => planReceipt(lines, [{ purchaseItemId: "a", quantity: 101 }]), /remaining quantity/);
  assert.deepEqual(planReceipt([{ ...lines[0], received_quantity: 100 }]), []);
});
