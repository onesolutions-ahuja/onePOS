import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const modal = readFileSync(new URL("../src/pages/customers/CustomerCreditModal.jsx", import.meta.url), "utf8");
const customers = readFileSync(new URL("../src/pages/customers/CustomersAdmin.jsx", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/customers.js", import.meta.url), "utf8");

test("customer credit UI loads summary and paginated filtered ledger", () => {
  assert.match(modal, /\/api\/customers\/\$\{customer\.id\}\/credit/);
  assert.match(modal, /\/api\/customers\/\$\{customer\.id\}\/credit\/ledger/);
  assert.match(modal, /ledgerFilters/);
  assert.match(modal, /pageSize: "10"/);
  assert.match(modal, /direction/);
  assert.match(modal, /entryType/);
  assert.match(modal, /running_balance/);
});

test("customer credit UI gates configuration, adjustments, and payments by supplied permissions", () => {
  assert.match(customers, /canManageCredit = isAdmin \|\| permissions\.includes\("customer\.edit"\)/);
  assert.match(customers, /canTakeCustomerPayment = isAdmin \|\| permissions\.includes\("payment\.manage"\)/);
  assert.match(modal, /canManageCredit/);
  assert.match(modal, /canTakePayment/);
  assert.match(modal, /disabled=\{savingPayment \|\| !credit\?\.enabled \|\| !canTakePayment\}/);
});

test("customer credit mutations use existing routes, validation, and idempotency", () => {
  assert.match(modal, /\/api\/customers\/\$\{customer\.id\}\/credit\/payments/);
  assert.match(modal, /\/api\/customers\/\$\{customer\.id\}\/credit\/adjustments/);
  assert.match(modal, /validateCreditPaymentAmount/);
  assert.match(modal, /idempotencyKey: `admin-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(modal, /disabled=\{adjustmentSaving\}/);
  assert.match(routes, /authorize\("payment\.manage", "customer\.edit"\)/);
  assert.match(routes, /idempotency_key/);
});

test("customer ledger endpoint keeps filters parameterized and company/store scoped", () => {
  assert.match(routes, /\/customers\/:id\/credit\/ledger/);
  assert.match(routes, /company_id = \$1/);
  assert.match(routes, /customer_id = \$2/);
  assert.match(routes, /pageSize/);
  assert.match(routes, /ILIKE \$\$\{index\}/);
  assert.match(routes, /Unsupported customer ledger entry type/);
  assert.match(routes, /Ledger direction must be debit or credit/);
});
