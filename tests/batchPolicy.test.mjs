import test from "node:test";
import assert from "node:assert/strict";
import { resolveBatchEntry, BATCH_INVENTORY_MODES } from "../services/batchPolicy.js";

test("required batch mode validates number and both dates", () => {
  const policy = { mode: BATCH_INVENTORY_MODES.REQUIRED_DATES, defaultMfgRule: "none", defaultExpiryRule: "none" };
  assert.throws(() => resolveBatchEntry(policy, { productBatchTracking: true, batchNumber: "B1" }), /date.*required/i);
  assert.equal(resolveBatchEntry(policy, { productBatchTracking: true, batchNumber: "B1", manufacturingDate: "2026-01-01", expiryDate: "2027-01-01" }).batchNumber, "B1");
});

test("optional dates mode applies distinguishable defaults", () => {
  const result = resolveBatchEntry({
    mode: BATCH_INVENTORY_MODES.OPTIONAL_DATES,
    defaultMfgRule: "today",
    defaultExpiryRule: "today_plus_days",
    defaultExpiryDays: 365,
  }, { productBatchTracking: true, batchNumber: "B1" });
  assert.equal(result.manufacturingDateSource, "DEFAULT");
  assert.equal(result.expiryDateSource, "DEFAULT");
  assert.throws(() => resolveBatchEntry({ mode: BATCH_INVENTORY_MODES.OPTIONAL_DATES }, { productBatchTracking: true }), /Batch number is required/);
});

test("no batch mode ignores product-level batch flag", () => {
  const result = resolveBatchEntry({ mode: BATCH_INVENTORY_MODES.NONE }, { productBatchTracking: true, batchNumber: "B1" });
  assert.equal(result.batchNumber, null);
});
