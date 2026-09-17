/*
 * T9A - permanent tests for the generic field-path resolver / payload builder.
 * Run with: node --test tests/
 * Direct fields, relationship traversal, nested paths, implicit/explicit
 * array collections, constants and templates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveFieldPath, resolveFirst, buildPayload } from "../services/integrationFieldResolver.js";

const saleData = {
  sales: {
    sale_id: "S-1001",
    total: 42.5,
    customer: {
      id: "C-9",
      name: "Acme Ltd",
      address: { postcode: "SW1A 1AA", line1: "1 Main St" },
    },
  },
};

const purchaseData = {
  purchase: {
    id: "P-77",
    supplier: { name: "North Foods" },
    items: [
      { quantity: 3, unitCost: 1.2, product: { ean: "5000111000011", name: "Beans" } },
      { quantity: 7, unitCost: 0.9, product: { ean: "5000111000028", name: "Soup" } },
    ],
  },
};

test("direct field resolves", () => {
  assert.equal(resolveFirst("sales.sale_id", saleData), "S-1001");
});

test("related/nested field resolves (sales.customer.name)", () => {
  assert.equal(resolveFirst("sales.customer.name", saleData), "Acme Ltd");
});

test("deeply nested field resolves (sales.customer.address.postcode)", () => {
  assert.equal(resolveFirst("sales.customer.address.postcode", saleData), "SW1A 1AA");
});

test("missing path resolves to not-found without throwing", () => {
  const results = resolveFieldPath("sales.customer.phone", saleData);
  assert.equal(results.length, 1);
  assert.equal(results[0].found, false);
  assert.equal(resolveFirst("sales.nope.deep", saleData), undefined);
});

test("explicit array collection resolves every element (items[].quantity)", () => {
  const results = resolveFieldPath("purchase.items[].quantity", purchaseData);
  assert.deepEqual(
    results.filter((r) => r.found).map((r) => r.value),
    [3, 7]
  );
});

test("implicit collection over plain segment (items.product.ean)", () => {
  const results = resolveFieldPath("purchase.items.product.ean", purchaseData);
  assert.deepEqual(
    results.filter((r) => r.found).map((r) => r.value),
    ["5000111000011", "5000111000028"]
  );
});

test("collection traversal continues past the array (items.product.name)", () => {
  assert.deepEqual(
    resolveFieldPath("purchase.items.product.name", purchaseData)
      .filter((r) => r.found)
      .map((r) => r.value),
    ["Beans", "Soup"]
  );
  // resolveFirst deliberately returns only the first found leaf.
  assert.equal(resolveFirst("purchase.items.product.name", purchaseData), "Beans");
});

test("buildPayload: direct mapping only", () => {
  const { payload, missing } = buildPayload(
    [{ partnerFieldPath: "InvoiceNumber", oneposSourcePath: "sales.sale_id" }],
    saleData
  );
  assert.deepEqual(payload, { InvoiceNumber: "S-1001" });
  assert.deepEqual(missing, []);
});

test("buildPayload: nested + constant + template mappings", () => {
  const { payload, missing } = buildPayload(
    [
      { partnerFieldPath: "Contact", oneposSourcePath: "sales.customer.name" },
      { partnerFieldPath: "Currency", mappingType: "constant", staticValue: "GBP" },
      {
        partnerFieldPath: "Reference",
        mappingType: "template",
        staticValue: "POS-{sales.sale_id}-{sales.customer.address.postcode}",
      },
    ],
    saleData
  );
  assert.deepEqual(payload, {
    Contact: "Acme Ltd",
    Currency: "GBP",
    Reference: "POS-S-1001-SW1A 1AA",
  });
  assert.deepEqual(missing, []);
});

test("buildPayload: array mapping fans out into a JSON array", () => {
  const { payload, arrays } = buildPayload(
    [
      { partnerFieldPath: "Quantity", oneposSourcePath: "purchase.items[].quantity" },
      { partnerFieldPath: "EAN", oneposSourcePath: "purchase.items.product.ean" },
    ],
    purchaseData
  );
  assert.deepEqual(payload.Quantity, [3, 7]);
  assert.deepEqual(payload.EAN, ["5000111000011", "5000111000028"]);
  assert.deepEqual(arrays.sort(), ["EAN", "Quantity"]);
});

test("buildPayload: unresolved direct mapping is reported as missing", () => {
  const { payload, missing } = buildPayload(
    [{ partnerFieldPath: "Tax", oneposSourcePath: "sales.vatNumber" }],
    saleData
  );
  assert.deepEqual(payload, {});
  assert.deepEqual(missing, ["Tax"]);
});

test("buildPayload: accepts snake_case DB row shapes", () => {
  const { payload } = buildPayload(
    [
      {
        partner_field_path: "LineEANs",
        onepos_source_path: "purchase.items[].product.ean",
        mapping_type: "direct",
      },
    ],
    purchaseData
  );
  assert.deepEqual(payload.LineEANs, ["5000111000011", "5000111000028"]);
});
