import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, validateConditionConfig } from "../services/platformConditions.js";

const fields = [{ api_name: "status", field_type: "text", active: true }];

test("field-change conditions distinguish unchanged and changed values", () => {
  const current = { status: "Approved" };
  assert.equal(evaluateCondition({ conditions: [{ field: "status", operator: "changed" }] }, fields, current, { status: "Pending" }), true);
  assert.equal(evaluateCondition({ conditions: [{ field: "status", operator: "changed" }] }, fields, current, { status: "Approved" }), false);
});

test("field-change conditions support from, to and from-to matching", () => {
  const config = { match: "all", conditions: [
    { field: "status", operator: "changed_from_to", value: { from: "Pending", to: "Approved" } },
  ] };
  validateConditionConfig(config, fields, "Automation conditions");
  assert.equal(evaluateCondition(config, fields, { status: "Approved" }, { status: "Pending" }), true);
  assert.equal(evaluateCondition(config, fields, { status: "Ready" }, { status: "Pending" }), false);
});
