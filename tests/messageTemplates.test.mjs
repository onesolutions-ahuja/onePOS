import test from "node:test";
import assert from "node:assert/strict";
import { extractMergeFields, renderMessageTemplate } from "../services/messageTemplates.js";

test("message templates render permitted scalar merge fields without code execution", () => {
  assert.deepEqual(extractMergeFields("Hello {{ customer.name }} {{order_number}}"), ["customer.name", "order_number"]);
  assert.equal(renderMessageTemplate("Order {{order_number}} is {{status}}", { order_number: "A-1", status: "READY" }, new Set(["order_number", "status"])), "Order A-1 is READY");
});

test("message templates reject unavailable merge fields", () => {
  assert.throws(() => renderMessageTemplate("{{secret}}", {}, new Set()), /Invalid or unavailable merge fields/);
});
