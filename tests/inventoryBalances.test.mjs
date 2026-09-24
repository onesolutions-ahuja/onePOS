import test from "node:test";
import assert from "node:assert/strict";
import { redactAuditDetails } from "../services/auditLog.js";
import { rebuildInventoryBalances } from "../services/inventory.js";

test("audit redaction removes credential-shaped keys recursively", () => {
  const safe = redactAuditDetails({
    before: { name: "Tea", passwordHash: "secret", nested: { apiToken: "x", qty: 2 } },
    after: { name: "Coffee", qty: 3 },
  });
  assert.deepEqual(safe, {
    before: { name: "Tea", nested: { qty: 2 } },
    after: { name: "Coffee", qty: 3 },
  });
});

test("inventory rollup rebuild is scoped and writes ledger totals", async () => {
  const statements = [];
  const client = {
    async query(sql, params) {
      statements.push({ sql, params });
      if (sql.includes("INSERT INTO inventory_balance_rollups")) {
        return { rows: [{ company_id: "c1", store_id: "s1", product_id: "p1", ledger_quantity: "4" }] };
      }
      return { rows: [] };
    },
  };
  const rows = await rebuildInventoryBalances(client, { companyId: "c1", storeId: "s1", productId: "p1" });
  assert.equal(rows[0].ledger_quantity, "4");
  assert.match(statements[0].sql, /DELETE FROM inventory_balance_rollups/);
  assert.deepEqual(statements[0].params, ["c1", "s1", "p1"]);
  assert.match(statements[1].sql, /GROUP BY m\.company_id,m\.store_id,m\.product_id/);
});
