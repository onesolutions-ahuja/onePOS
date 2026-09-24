import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { executeInventoryPlatformAction } from "../services/inventoryPlatform.js";
import { getWorkflowActionDefinition } from "../services/platformWorkflow.js";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const STORE_A = "c0000000-0000-4000-8000-000000000001";
const STORE_B = "c0000000-0000-4000-8000-000000000002";
const PRODUCT = "p0000000-0000-4000-8000-000000000001";

function client() {
  return {
    async query(sql, params) {
      if (/SELECT id FROM stores/.test(sql)) return { rows: [{ id: params[0] }] };
      return { rows: [] };
    },
  };
}

test("inventory Platform metadata exposes stock, movement, batch, and transaction fields", () => {
  const source = fs.readFileSync(new URL("../services/platformMetadata.js", import.meta.url), "utf8");
  assert.match(source, /key: "inventory"/);
  assert.match(source, /key: "inventory_movement"/);
  assert.match(source, /key: "inventory_batch"/);
  assert.ok(source.includes('"transaction_id", "Sale / Transaction"'));
  assert.ok(source.includes('"batch_id", "Batch"'));
  assert.match(source, /inventory_movement_type/);
  assert.match(source, /stock_positions/);
});

test("inventory Platform adjustment action uses the atomic movement service", async () => {
  const calls = [];
  const result = await executeInventoryPlatformAction({
    client: client(),
    companyId: COMPANY,
    userId: "u-1",
    action: {
      type: "WASTAGE",
      productId: PRODUCT,
      storeId: STORE_A,
      quantity: 2,
      referenceId: "ref-1",
      reason: "Expired",
    },
    inventoryMovement: async (_client, movement) => {
      calls.push(movement);
      return { movement: { id: "movement-1" }, balance: 8, storeBalance: 8 };
    },
  });
  assert.equal(result.status, "completed");
  assert.equal(calls[0].movementType, "ADJUSTMENT_OUT");
  assert.equal(calls[0].quantityChange, -2);
  assert.equal(calls[0].reason, "Expired");
  assert.equal(calls[0].createdBy, "u-1");
});

test("inventory Platform transfer validates company stores and posts paired effects", async () => {
  const calls = [];
  const result = await executeInventoryPlatformAction({
    client: client(),
    companyId: COMPANY,
    action: { type: "TRANSFER", productId: PRODUCT, fromStoreId: STORE_A, toStoreId: STORE_B, quantity: 3 },
    inventoryMovement: async (_client, movement) => {
      calls.push(movement);
      return { movement: { id: `movement-${calls.length}` } };
    },
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(calls.map((call) => [call.storeId, call.movementType, call.quantityChange]), [
    [STORE_A, "TRANSFER_OUT", -3],
    [STORE_B, "TRANSFER_IN", 3],
  ]);
});

test("inventory workflow actions are registered through the existing workflow engine", () => {
  assert.ok(getWorkflowActionDefinition("INVENTORY_ACTION"));
  assert.ok(getWorkflowActionDefinition("RECONCILE_INVENTORY"));
  assert.ok(getWorkflowActionDefinition("REBUILD_INVENTORY"));
});
