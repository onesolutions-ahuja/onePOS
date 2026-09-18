/*
 * T10Q - Supplier Integration Foundation regression suite.
 *   node --test tests/supplierFeed.test.mjs
 * Read-only boundary: normalise + match + HTTP preview. Writes nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  normaliseSupplierFeed,
  normaliseSupplierRow,
  SUPPLIER_FEED_LIMIT,
} from "../services/supplierFeedAdapter.js";
import { matchSupplierFeed } from "../services/supplierFeedMatch.js";
import createIntegrationsRouter from "../routes/integrations.js";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";

/* Valid checksum GTINs (Global Product Master validGtin contract). */
const EAN_BEANS = "5000112548167";
const EAN_SOUP = "5012345678900";
const EAN_CRISPS = "4006381333931";

const PRODUCTS_A = [
  { id: "p-beans", company_id: COMPANY_A, name: "Heinz Beans", sku: "HB-1", barcode: EAN_BEANS, active: true },
  { id: "p-soup", company_id: COMPANY_A, name: "Heinz Soup", sku: "HS-1", barcode: EAN_SOUP, active: true },
];

test("normalise: generic supplier aliases map to the canonical shape", () => {
  const { rows, errors } = normaliseSupplierFeed([
    {
      supplier_code: "SUP-1", barcode: EAN_BEANS, product_name: "Beans",
      manufacturer: "Heinz", category_name: "Tinned", unit_price: "1.2",
      vat_rate: "20", quantity: "6", reference: "PO-9",
      last_updated: "2026-01-02T10:00:00.000Z",
    },
  ]);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    supplierCode: "SUP-1", ean: EAN_BEANS, name: "Beans", brand: "Heinz",
    category: "Tinned", supplierPrice: 1.2, vatRate: 20, vatApplicable: true,
    availableQty: 6, supplierRef: "PO-9",
    updatedAt: "2026-01-02T10:00:00.000Z", row: 1,
  });
});

test("normalise: invalid EAN, negatives, bad VAT and bad dates are errors", () => {
  const { rows, errors } = normaliseSupplierFeed([
    { name: "Bad EAN", ean: "123" },
    { name: "Neg price", ean: EAN_BEANS, supplierPrice: -1 },
    { name: "Neg qty", ean: EAN_SOUP, availableQty: -2 },
    { name: "Bad VAT", ean: EAN_CRISPS, vatRate: 101 },
    { name: "Bad date", updatedAt: "not-a-date" },
    { name: "" },
  ]);
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 6);
});

test("normalise: duplicate EAN keeps the first row", () => {
  const { rows, errors } = normaliseSupplierFeed([
    { name: "First", ean: EAN_BEANS },
    { name: "Second", ean: EAN_BEANS },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "First");
  assert.equal(errors.length, 1);
  assert.match(errors[0].errors[0], /Duplicate EAN/);
});

test("normalise: non-object rows reported, over-limit feeds rejected", () => {
  assert.ok(normaliseSupplierRow(null, 3).error);
  const big = Array.from({ length: SUPPLIER_FEED_LIMIT + 1 }, (_, i) => ({ name: `P${i}` }));
  const { rows, errors } = normaliseSupplierFeed(big);
  assert.equal(rows.length, 0);
  assert.match(errors[0], /preview limit/);
});

test("match: EAN-first, company-scoped, purchaseLine needs qty and price", () => {
  const feed = normaliseSupplierFeed([
    { name: "Beans", ean: EAN_BEANS, supplierPrice: 1.2, availableQty: 4 },
    { name: "Unknown", ean: EAN_CRISPS, supplierPrice: 0.5, availableQty: 2 },
    { name: "SoupNoQty", ean: EAN_SOUP, supplierPrice: 0.9, availableQty: 0 },
  ]).rows;
  const { matches, errors } = matchSupplierFeed(feed, { products: PRODUCTS_A, companyId: COMPANY_A });
  assert.equal(errors.length, 0);
  const [beans, unknown, noQty] = matches;
  assert.equal(beans.status, "matched");
  assert.equal(beans.productId, "p-beans");
  assert.equal(beans.resolvedVia, "ean");
  assert.equal(beans.productPreview, null);
  assert.deepEqual(beans.purchaseLine, { productId: "p-beans", quantity: 4, unitCost: 1.2 });
  assert.equal(unknown.status, "no_match");
  assert.equal(unknown.purchaseLine, null);
  assert.deepEqual(unknown.productPreview, { name: "Unknown", barcode: EAN_CRISPS, description: null });
  assert.equal(noQty.status, "matched");
  assert.equal(noQty.purchaseLine, null);
  const cross = matchSupplierFeed(feed, { products: PRODUCTS_A, companyId: COMPANY_B });
  assert.ok(cross.matches.every((m) => m.status === "no_match"));
});

test("match: ambiguous EAN reported, SKU fallback works", () => {
  const dupes = [
    { id: "p-1", company_id: COMPANY_A, name: "One", sku: "S-1", barcode: EAN_BEANS },
    { id: "p-2", company_id: COMPANY_A, name: "Two", sku: "S-2", barcode: EAN_BEANS },
  ];
  const feed = normaliseSupplierFeed([{ name: "Beans", ean: EAN_BEANS }]).rows;
  const amb = matchSupplierFeed(feed, { products: dupes, companyId: COMPANY_A });
  assert.equal(amb.matches[0].status, "ambiguous");
  assert.equal(amb.errors.length, 1);
  const skuFeed = normaliseSupplierFeed([{ name: "Beans", supplierCode: "hb-1" }]).rows;
  const sku = matchSupplierFeed(skuFeed, { products: PRODUCTS_A, companyId: COMPANY_A });
  assert.equal(sku.matches[0].status, "matched");
  assert.equal(sku.matches[0].resolvedVia, "sku");
});

function makeApp({ products, canManage, writes }) {
  const app = express();
  app.use(express.json());
  const authenticate = (req, _res, next) => {
    req.user = { id: "u-1", companyId: COMPANY_A, storeId: "s-1" };
    next();
  };
  const authorize = () => (_req, res, next) => {
    if (!canManage) return res.status(403).json({ success: false, message: "Forbidden" });
    next();
  };
  const fakeDb = async (sql, params = []) => {
    if (/INSERT|UPDATE|DELETE/i.test(String(sql))) {
      writes.push(String(sql));
      throw new Error("preview must not write");
    }
    if (/FROM products/i.test(String(sql))) {
      assert.deepEqual(params, [COMPANY_A]);
      return { rows: products };
    }
    if (/FROM integration_connections/i.test(String(sql))) return { rows: [] };
    return { rows: [] };
  };
  app.use("/api", createIntegrationsRouter({
    authenticate, authorize, db: fakeDb, pool: null, writeAudit: async () => {},
  }));
  return app;
}

async function preview(app, body) {
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/integrations/supplier-feed/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  } finally {
    server.close();
  }
}

test("preview endpoint: summary plus matches, company-scoped, read-only", async () => {
  const writes = [];
  const app = makeApp({ products: PRODUCTS_A, canManage: true, writes });
  const { status, json } = await preview(app, {
    rows: [
      { name: "Beans", ean: EAN_BEANS, supplierPrice: 1.2, availableQty: 4 },
      { name: "Ghost", ean: EAN_CRISPS },
      { name: "Bad", ean: "xyz" },
    ],
  });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(json.data.summary, { total: 3, valid: 2, matched: 1, unmatched: 1, ambiguous: 0 });
  assert.equal(json.data.matches.length, 2);
  assert.equal(json.data.errors.length, 1);
  assert.equal(writes.length, 0);
  assert.equal(json.data.matches[0].productId, "p-beans");
  assert.deepEqual(Object.keys(json.data.matches[1].productPreview).sort(), ["barcode", "description", "name"]);
});

test("preview endpoint: 403 without integration.manage, 400 without rows array", async () => {
  const forbidden = await preview(
    makeApp({ products: PRODUCTS_A, canManage: false, writes: [] }),
    { rows: [{ name: "Beans", ean: EAN_BEANS }] }
  );
  assert.equal(forbidden.status, 403);
  const bad = await preview(
    makeApp({ products: PRODUCTS_A, canManage: true, writes: [] }),
    { rows: "nope" }
  );
  assert.equal(bad.status, 400);
  const over = await preview(
    makeApp({ products: PRODUCTS_A, canManage: true, writes: [] }),
    { rows: Array.from({ length: SUPPLIER_FEED_LIMIT + 1 }, (_, i) => ({ name: `P${i}` })) }
  );
  assert.equal(over.status, 400);
});
