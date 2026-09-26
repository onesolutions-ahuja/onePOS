import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { packageDefinitions } from "../services/packageRegistry.js";
import { invoiceStatus, allocateSupplierPayment } from "../services/supplierAccounts.js";

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("Finance Core is a hidden, non-billable foundation package", () => {
  const definition = packageDefinitions().find((entry) => entry.packageKey === "finance_core");
  assert.ok(definition);
  assert.equal(definition.manifest.packageType, "FOUNDATION");
  assert.equal(definition.manifest.visibility, "HIDDEN");
  assert.equal(definition.manifest.billable, false);
  assert.equal(definition.manifest.systemOnly, true);
  assert.deepEqual(definition.dependencies, ["suppliers"]);
});

test("Finance Core adopts all authoritative financial objects without a replacement table", () => {
  const definition = packageDefinitions().find((entry) => entry.packageKey === "finance_core");
  const objects = definition.manifest.objects;
  assert.deepEqual(objects.map((object) => object.objectKey), [
    "supplier_invoice",
    "supplier_payment",
    "supplier_payment_allocation",
    "supplier_ledger",
    "financial_ledger",
  ]);
  assert.deepEqual(objects.map((object) => object.sourceTable), [
    "supplier_invoices",
    "supplier_payments",
    "supplier_payment_allocations",
    "supplier_ledger_entries",
    "financial_ledger_entries",
  ]);
  assert.doesNotMatch(JSON.stringify(objects), /finance_core_ledger/);
});

test("Finance Core exposes historical invoice, payment, allocation and ledger fields", () => {
  const definition = packageDefinitions().find((entry) => entry.packageKey === "finance_core");
  const fields = new Map(definition.manifest.objects.map((object) => [
    object.objectKey,
    new Set(object.fields.map((field) => field.apiName)),
  ]));
  assert.deepEqual([...fields.get("supplier_invoice")].filter((field) => [
    "company_id", "supplier_id", "purchase_id", "invoice_number", "invoice_date",
    "due_date", "subtotal", "tax", "total", "status", "created_at", "updated_at",
  ].includes(field)), [
    "company_id", "supplier_id", "purchase_id", "invoice_number", "invoice_date",
    "due_date", "subtotal", "tax", "total", "status", "created_at", "updated_at",
  ]);
  assert.deepEqual([...fields.get("supplier_payment_allocation")], ["payment_id", "invoice_id", "amount"]);
  assert.ok(fields.get("financial_ledger").has("supplier_invoice_id"));
});

test("Finance Core relationships preserve supplier, purchase-order and ledger references", () => {
  const definition = packageDefinitions().find((entry) => entry.packageKey === "finance_core");
  const relationships = definition.manifest.relationships;
  for (const key of ["invoices", "payments", "allocations", "payment", "invoice", "purchase_order", "supplier"]) {
    assert.ok(relationships.some((relationship) => relationship.relationshipKey === key));
  }
  assert.ok(relationships.some((relationship) =>
    relationship.parentObjectKey === "supplier_invoice" &&
    relationship.relationshipKey === "purchase_order" &&
    relationship.parentFieldApiName === "purchase_id"
  ));
});

test("existing supplier accounting behavior remains authoritative", () => {
  assert.equal(invoiceStatus(1000, 0), "OPEN");
  assert.equal(invoiceStatus(1000, 600), "PARTIALLY_PAID");
  assert.equal(invoiceStatus(1000, 1000), "PAID");
  assert.deepEqual(
    allocateSupplierPayment(700, [
      { id: "invoice-1", total: 1000, paid: 600 },
      { id: "invoice-2", total: 500, paid: 0 },
    ]),
    [{ invoiceId: "invoice-1", amount: 400 }, { invoiceId: "invoice-2", amount: 300 }]
  );
});

test("supplier payment execution retains idempotency and over-allocation protections", () => {
  const execution = source("../services/supplierPaymentExecution.js");
  assert.match(execution, /supplier_payments WHERE company_id=\$1 AND idempotency_key=\$2/);
  assert.match(execution, /Payment allocation exceeds invoice balance/);
  assert.match(execution, /supplier_payment_allocations/);
  assert.match(execution, /UPDATE supplier_invoices SET status/);
  assert.match(execution, /INSERT INTO supplier_ledger_entries/);
});

test("Finance Core lifecycle metadata is additive and preserves financial rows", () => {
  const registry = source("../services/packageRegistry.js");
  const schema = source("../services/platformMetadata.js");
  assert.match(registry, /INSERT INTO platform_objects/);
  assert.match(registry, /managed=true/);
  assert.match(registry, /package_metadata_ownership/);
  assert.doesNotMatch(registry, /DROP TABLE.*supplier_(invoices|payments|payment_allocations|ledger_entries)/i);
  assert.match(schema, /package_id UUID REFERENCES package_registry/);
});

test("Finance Core reuses existing RBAC and tenant-scoped supplier accounting routes", () => {
  const routes = source("../routes/supplierAccounts.js");
  assert.match(routes, /authorize\(\.\.\.view\)/);
  assert.match(routes, /authorize\(\.\.\.manage\)/);
  assert.match(routes, /company_id=\$2/);
  assert.match(routes, /supplier_ledger_entries/);
  assert.match(routes, /statement/);
});
