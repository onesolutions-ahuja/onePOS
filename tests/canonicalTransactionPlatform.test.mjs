import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  createCanonicalRelatedTransaction,
  syncCanonicalSaleTransaction,
} from "../services/canonicalTransactions.js";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "b0000000-0000-4000-8000-000000000002";
const STORE = "c0000000-0000-4000-8000-000000000003";
const SALE = "d0000000-0000-4000-8000-000000000004";
const PRODUCT_A = "e0000000-0000-4000-8000-000000000005";
const PRODUCT_B = "f0000000-0000-4000-8000-000000000006";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function makeClient({ originalCompany = COMPANY } = {}) {
  const calls = [];
  const saleItems = [];
  const ledger = [];
  const payments = [{ id: "p-1", amount: "10.00" }];
  return {
    calls,
    saleItems,
    ledger,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ text, params });
      if (/SELECT id(?:, store_id)? FROM sales/i.test(text)) {
        return { rows: originalCompany === params[1] ? [{ id: SALE, store_id: STORE }] : [] };
      }
      if (/SELECT id, company_id, store_id, customer_id/i.test(text)) {
        return { rows: [{ id: SALE, company_id: COMPANY, store_id: STORE, customer_id: "customer-1", receipt_number: "INV-1", subtotal: "8.00", tax: "2.00", total: "10.00" }] };
      }
      if (/INSERT INTO sales/i.test(text)) return { rows: [{ id: "canonical-1" }] };
      if (/INSERT INTO sale_items/i.test(text)) {
        saleItems.push({ saleId: params[0], productId: params[1], quantity: params[3] });
        return { rows: [] };
      }
      if (/SELECT id, amount FROM payments/i.test(text)) return { rows: payments };
      if (/INSERT INTO financial_ledger_entries/i.test(text)) {
        ledger.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test("canonical Platform metadata registers transaction, line, payment, and ledger model", () => {
  const metadata = source("../services/platformMetadata.js");
  const systemObjects = source("../services/platformSystemObjects.js");
  const schema = source("../database/schema.sql");
  assert.match(metadata, /key: "sale"/);
  assert.match(metadata, /transaction_type/);
  assert.match(metadata, /original_transaction_id/);
  assert.match(metadata, /key: "sale_line"/);
  assert.match(metadata, /key: "payment"/);
  assert.match(metadata, /key: "financial_ledger"/);
  assert.match(metadata, /transaction_type.*SALE.*RETURN.*EXCHANGE/s);
  assert.match(metadata, /transaction_type.*original_transactions/s);
  assert.match(metadata, /sale_line.*product.*lookup/s);
  assert.match(metadata, /sale.*sale_line.*lines.*one_to_many/s);
  assert.match(metadata, /sale.*payment.*payments.*one_to_many/s);
  assert.match(metadata, /sale.*financial_ledger.*ledger_entries.*one_to_many/s);
  assert.match(metadata, /recordTypeKey, label, value/);
  assert.match(systemObjects, /\["payment", "payments"/);
  assert.match(systemObjects, /\["financial_ledger", "financial_ledger_entries"/);
  assert.equal(existsSync(new URL("../src/utils/platformSystemObjectAccess.js", import.meta.url)), true);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS financial_ledger_entries/);
  assert.match(schema, /ALTER TABLE payments ALTER COLUMN sale_id DROP NOT NULL/);
  assert.match(source("../server.js"), /canonicalTransactionWriter: syncCanonicalSaleTransaction/);
  assert.match(source("../server.js"), /canonicalTransactionWriter: createCanonicalRelatedTransaction/);
  assert.match(source("../routes/returns.js"), /transactionType: "RETURN"/);
  assert.match(source("../routes/exchanges.js"), /transactionType: "EXCHANGE"/);
});

test("canonical transaction creates multiple Sale Lines under one Sale and links Payment/Ledger", async () => {
  const client = makeClient();
  const id = await createCanonicalRelatedTransaction(client, {
    companyId: COMPANY,
    storeId: STORE,
    userId: "user-1",
    transactionType: "SALE",
    originalTransactionId: SALE,
    referenceNumber: "INV-2",
    subtotal: 18,
    tax: 2,
    total: 20,
    lines: [
      { productId: PRODUCT_A, quantity: 2, unitPrice: 5, total: 10 },
      { productId: PRODUCT_B, quantity: 1, unitPrice: 10, total: 10 },
    ],
  });
  assert.equal(id, "canonical-1");
  assert.deepEqual(client.saleItems.map((line) => line.saleId), ["canonical-1", "canonical-1"]);
  assert.deepEqual(client.saleItems.map((line) => line.productId), [PRODUCT_A, PRODUCT_B]);
  assert.ok(client.ledger.length >= 2);
  assert.ok(client.calls.some(({ text }) => /UPDATE payments/i.test(text)));
});

test("canonical RETURN and EXCHANGE require an in-scope original transaction", async () => {
  const client = makeClient();
  await createCanonicalRelatedTransaction(client, {
    companyId: COMPANY,
    storeId: STORE,
    userId: "user-1",
    transactionType: "RETURN",
    originalTransactionId: SALE,
    referenceNumber: "RET-1",
    total: -10,
    lines: [{ productId: PRODUCT_A, quantity: -1, unitPrice: 10, total: -10 }],
  });
  await assert.rejects(
    () => syncCanonicalSaleTransaction(makeClient({ originalCompany: OTHER_COMPANY }), {
      saleId: SALE,
      companyId: COMPANY,
      storeId: STORE,
      transactionType: "EXCHANGE",
      originalTransactionId: "other-sale",
    }),
    /Original transaction is outside/
  );
});
