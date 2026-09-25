import test from "node:test";
import assert from "node:assert/strict";
import {
  ConditionError,
  evaluateCondition,
  validateConditionConfig,
  validateConditionalRequired,
} from "../services/platformConditions.js";

const fields = [
  { api_name: "enabled", field_type: "boolean", active: true },
  { api_name: "amount", field_type: "decimal", active: true },
  { api_name: "note", field_type: "text", active: true },
  { api_name: "total", field_type: "formula", active: true, readable: true, config: { resultType: "decimal" } },
];

test("conditions support equality, ordering, empty checks, ALL, and ANY", () => {
  assert.equal(evaluateCondition({ conditions: [{ field: "enabled", operator: "equals", value: true }] }, fields, { enabled: true }), true);
  assert.equal(evaluateCondition({ conditions: [{ field: "enabled", operator: "not_equals", value: true }] }, fields, { enabled: false }), true);
  assert.equal(evaluateCondition({ conditions: [{ field: "amount", operator: "greater_than_or_equal", value: 10 }] }, fields, { amount: 10 }), true);
  assert.equal(evaluateCondition({ conditions: [{ field: "amount", operator: "less_than", value: 10 }] }, fields, { amount: 9 }), true);
  assert.equal(evaluateCondition({ conditions: [{ field: "note", operator: "is_empty" }] }, fields, { note: "" }), true);
  assert.equal(evaluateCondition({ conditions: [{ field: "note", operator: "is_not_empty" }] }, fields, { note: "x" }), true);
  assert.equal(evaluateCondition({ match: "all", conditions: [{ field: "enabled", operator: "equals", value: true }, { field: "amount", operator: "greater_than", value: 5 }] }, fields, { enabled: true, amount: 6 }), true);
  assert.equal(evaluateCondition({ match: "any", conditions: [{ field: "enabled", operator: "equals", value: true }, { field: "amount", operator: "greater_than", value: 50 }] }, fields, { enabled: false, amount: 60 }), true);
});

test("conditional rules support dotted record paths for related fields", () => {
  const record = { customer: { status: "active", balance: 12 } };
  const previous = { customer: { status: "guest", balance: 10 } };
  assert.equal(evaluateCondition({ conditions: [{ field: "customer.status", operator: "equals", value: "active" }] }, fields, record), true);
  assert.equal(evaluateCondition({ conditions: [{ field: "customer.balance", operator: "changed_from", value: 10 }] }, fields, record, previous), true);
  assert.equal(evaluateCondition({ conditions: [{ field: "customer.balance", operator: "greater_than_or_equal", value: 12 }] }, fields, record), true);
});

test("conditional required uses formula values and rejects invalid metadata", () => {
  const conditional = { ...fields[2], label: "Note", config: { requiredCondition: { conditions: [{ field: "total", operator: "greater_than", value: 10 }] } } };
  assert.equal(validateConditionalRequired([...fields.slice(0, 2), conditional, fields[3]], { total: 11, note: "" }), "Note is required");
  assert.equal(validateConditionalRequired([...fields.slice(0, 2), conditional, fields[3]], { total: 9, note: "" }), null);
  assert.throws(() => validateConditionConfig({ conditions: [{ field: "missing", operator: "equals", value: 1 }] }, fields, "visibilityCondition"), ConditionError);
  assert.throws(() => validateConditionConfig({ match: "bad", conditions: [] }, fields, "requiredCondition"), ConditionError);
});
