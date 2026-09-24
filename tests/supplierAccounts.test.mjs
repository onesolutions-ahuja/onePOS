import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allocateSupplierPayment, invoiceStatus } from "../services/supplierAccounts.js";

test("supplier invoice status tracks unpaid, partial and paid balances", () => {
  assert.equal(invoiceStatus(1000, 0), "OPEN");
  assert.equal(invoiceStatus(1000, 600), "PARTIALLY_PAID");
  assert.equal(invoiceStatus(1000, 1000), "PAID");
});

test("supplier payment allocation never exceeds invoice balances", () => {
  assert.deepEqual(
    allocateSupplierPayment(700, [
      { id: "one", total: 1000, paid: 600 },
      { id: "two", total: 500, paid: 0 },
    ]),
    [{ invoiceId: "one", amount: 400 }, { invoiceId: "two", amount: 300 }]
  );
});

test("supplier accounts expose authenticated credit/debit ledger adjustments with tenant checks", () => {
  const source = fs.readFileSync(new URL("../routes/supplierAccounts.js", import.meta.url), "utf8");
  assert.match(source, /router\.post\("\/supplier-ledger-entries", authenticate, authorize\(\.\.\.manage\)/);
  assert.match(source, /RETURN_CREDIT/);
  assert.match(source, /typeof debit !== "boolean"/);
  assert.match(source, /suppliers WHERE id=\$1 AND company_id=\$2/);
  assert.match(source, /stores WHERE id=\$1 AND company_id=\$2/);
  assert.match(source, /supplier_ledger_entries/);
  assert.match(source, /router\.get\("\/suppliers\/:id\/statement", authenticate, authorize\(\.\.\.view\)/);
});

test("supplier account frontend integrates summary, ledger filters and guarded adjustment actions", () => {
  const source = fs.readFileSync(new URL("../src/pages/suppliers/SupplierAccountsModal.jsx", import.meta.url), "utf8");
  const suppliersSource = fs.readFileSync(new URL("../src/pages/suppliers/SuppliersAdmin.jsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/suppliers\/\$\{supplier\.id\}\/summary/);
  assert.match(source, /\/api\/suppliers\/\$\{supplier\.id\}\/ledger/);
  assert.match(source, /query\.set\("search"/);
  assert.match(source, /query\.set\("entryType"/);
  assert.match(source, /query\.set\("debit"/);
  assert.match(source, /\/api\/supplier-credits/);
  assert.match(source, /\/api\/supplier-debits/);
  assert.match(source, /\/api\/supplier-credit-notes/);
  assert.match(source, /idempotencyKey: `web-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(source, /disabled=\{saving\}/);
  assert.match(suppliersSource, /canManageAccounts = isAdmin \|\| permissions\.includes\("purchase\.edit"\) \|\| permissions\.includes\("inventory\.adjust"\)/);
  assert.match(source, /\{canManage && <div className="mb-5/);
});
