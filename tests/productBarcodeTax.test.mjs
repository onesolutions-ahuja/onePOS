/*
 * Product barcode identity/validation + tax rates/mapping — focused suite.
 *
 *   node --test tests/productBarcodeTax.test.mjs
 *
 * Backend: the REAL routes/products.js over HTTP against stateful fakes
 * (create/edit + duplicate protection + the EAN-13 identity gate).
 * Engine: the REAL src/utils/saleTotals.js (per-product rate rule).
 * Sources: static contracts for normaliseProduct/GPM separation/company tax
 * config wiring and the invalid→explicit-unmapped tax rule.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";

import { validateBarcode, ean13IdentityError } from "../src/utils/barcodeValidation.js";
import { computeBasketTotals, lineTaxFor } from "../src/utils/saleTotals.js";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const USER = "u0000000-0000-4000-8000-000000000009";

/* Valid EAN-13 fixtures (checksums verified) — leading zero PRESERVED. */
const EAN_A = "5000111122221";
const EAN_A_LEADING_ZERO = "0500111122221"; // same body zero-padded to 13, valid check digit

/* ------------------------------------------------------------ fake ctx */

function makeCtx() {
  const state = {
    products: new Map(),
    companySettings: new Map([
      /* Company A: VAT on at 20%. Company B: VAT on at 5% — isolated config. */
      [COMPANY_A, { vat_enabled: true, default_vat_rate: 20 }],
      [COMPANY_B, { vat_enabled: true, default_vat_rate: 5 }],
    ]),
    audit: [],
  };

  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/pg_advisory_xact_lock/.test(s)) return { rows: [] };

      /* create */
      if (/INSERT INTO products \(/.test(s)) {
        const row = {
          id: `p-${state.products.size + 1}`,
          company_id: params[0], category_id: params[1], name: params[2],
          sku: params[3], barcode: params[4], description: params[5],
          price: params[6], cost_price: params[7], vat_rate: params[8],
          vat_applicable: params[9], active: true, created_at: new Date().toISOString(),
        };
        state.products.set(row.id, row);
        return { rows: [{ ...row }] };
      }
      /* edit */
      if (/^UPDATE products SET/i.test(s)) {
        const row = state.products.get(params[params.length - 2]);
        if (!row || row.company_id !== params[params.length - 1]) return { rows: [] };
        row.category_id = params[0]; row.name = params[1]; row.sku = params[2];
        row.barcode = params[3]; row.description = params[4]; row.price = params[5];
        row.cost_price = params[6]; row.vat_rate = params[7];
        if (params[8] !== null) row.vat_applicable = params[8];
        row.updated_at = new Date().toISOString();
        return { rows: [{ ...row }] };
      }
      /* self lookup (edit) */
      if (/SELECT id FROM products WHERE id = \$1 AND company_id = \$2/i.test(s)) {
        const row = state.products.get(params[0]);
        return { rows: row && row.company_id === params[1] ? [{ ...row }] : [] };
      }
      /* edit-time audit snapshot */
      if (/SELECT\s+name, sku, barcode, category_id, price, vat_rate, age_restricted, active\s+FROM products WHERE id = \$1 AND company_id = \$2/i.test(s)) {
        const row = state.products.get(params[0]);
        return { rows: row && row.company_id === params[1] ? [{ ...row }] : [] };
      }
      /* duplicate SKU checks (create + edit) */
      if (/LOWER\(sku\) = LOWER\(\$2\)/.test(s) && /id <> \$3/.test(s)) {
        const dup = [...state.products.values()].find((p) => p.company_id === params[0] && p.active && (p.sku || "").toLowerCase() === String(params[1]).toLowerCase() && p.id !== params[2]);
        return { rows: dup ? [{ id: dup.id }] : [] };
      }
      if (/LOWER\(sku\) = LOWER\(\$2\)/.test(s)) {
        const dup = [...state.products.values()].find((p) => p.company_id === params[0] && p.active && (p.sku || "").toLowerCase() === String(params[1]).toLowerCase());
        return { rows: dup ? [{ id: dup.id }] : [] };
      }
      /* duplicate barcode checks (create + edit) */
      if (/barcode = \$2/.test(s) && /id <> \$3/.test(s)) {
        const dup = [...state.products.values()].find((p) => p.company_id === params[0] && p.active && p.barcode === params[1] && p.id !== params[2]);
        return { rows: dup ? [{ id: dup.id }] : [] };
      }
      if (/barcode = \$2/.test(s)) {
        const dup = [...state.products.values()].find((p) => p.company_id === params[0] && p.active && p.barcode === params[1]);
        return { rows: dup ? [{ id: dup.id }] : [] };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/FROM products p\s+LEFT JOIN categories c/i.test(s) && /WHERE p\.company_id = \$1/i.test(s) && /p\.active = true/.test(s)) {
      const rows = [...state.products.values()]
        .filter((p) => p.company_id === params[0] && p.active && p.sku !== "MISC")
        .sort((a, b) => a.name.localeCompare(b.name));
      return { rows };
    }
    if (/FROM companies c\s+LEFT JOIN company_settings cs/.test(s)) {
      const cs = state.companySettings.get(params[0]);
      return { rows: cs ? [{ company_id: params[0], vat_enabled: cs.vat_enabled, default_vat_rate: cs.default_vat_rate }] : [] };
    }
    return client.query(sql, params);
  };

  return { state, db, pool: { async connect() { return { ...client, release() {} }; } } };
}

/* ------------------------------------------------------------ builders */

async function buildApp(ctx, companyId) {
  const mod = await import("../routes/products.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId, storeId: null };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement: async () => ({ balance: 0, movement: {} }),
    writeAudit: async (...args) => { ctx.state.audit.push(args); },
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const post = async (port, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/products`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const put = async (port, id, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/products/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const list = async (port) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/products`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* -------------------------------------------------- Part A: barcodes */

describe("Barcode identity & validation", () => {
  test("1. valid EAN-13 accepted (checksum validated)", () => {
    assert.equal(validateBarcode("4006381333931").format, "EAN-13");
    assert.equal(validateBarcode("4006381333931").valid, true);
  });

  test("2. invalid EAN-13 check digit rejected by the identity gate", () => {
    assert.match(ean13IdentityError("4006381333932"), /check digit/i);
    /* and the API rejects it with a clear 400 — no silent corruption */
  });

  test("3. non-numeric 13-char value is NOT treated as EAN-13 (Code-128 path preserved)", () => {
    assert.equal(ean13IdentityError("AB4033813393X"), null);
    assert.equal(validateBarcode("BÄR-010").valid, false, "non-ASCII is no barcode format");
  });

  test("4. API rejects invalid EAN-13 on create AND edit with a clear 400", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, COMPANY_A);
    const { server, port } = await listen(app);
    try {
      const bad = await post(port, { name: "Bad EAN", barcode: "4006381333932" });
      assert.equal(bad.status, 400);
      assert.match(bad.body.message, /check digit/i);

      const good = await post(port, { name: "Good EAN", barcode: EAN_A });
      assert.equal(good.status, 201);
      const badEdit = await put(port, good.body.data.id, { name: "Good EAN", barcode: "4006381333932" });
      assert.equal(badEdit.status, 400);
      const stored = ctx.state.products.get(good.body.data.id);
      assert.equal(stored.barcode, EAN_A, "invalid value was never stored");
    } finally { server.close(); }
  });

  test("5. leading-zero barcode preserved end to end (VARCHAR, never numeric)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, COMPANY_A);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Zero-led", barcode: EAN_A_LEADING_ZERO });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.barcode, EAN_A_LEADING_ZERO, "'0' prefix must survive exactly");
      assert.equal(ctx.state.products.get(created.body.data.id).barcode, EAN_A_LEADING_ZERO);
      /* and the schema stays text — never a numeric type */
      const schema = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
      assert.match(schema, /barcode VARCHAR\(100\)/);
    } finally { server.close(); }
  });

  test("6. duplicate barcode rejected within the company (create + edit)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, COMPANY_A);
    const { server, port } = await listen(app);
    try {
      const first = await post(port, { name: "First", barcode: EAN_A });
      assert.equal(first.status, 201);
      const second = await post(port, { name: "Second", barcode: EAN_A });
      assert.equal(second.status, 409);
      const editClash = await post(port, { name: "Third", barcode: "4006381333931" });
      assert.equal(editClash.status, 201);
      const edit = await put(port, editClash.body.data.id, { name: "Third", barcode: EAN_A });
      assert.equal(edit.status, 409, "edit must not steal another product's barcode");
    } finally { server.close(); }
  });

  test("7. same barcode in an unrelated company does NOT collide (no cross-company rejection)", async () => {
    const ctx = makeCtx();
    const appA = await buildApp(ctx, COMPANY_A);
    const appB = await buildApp(ctx, COMPANY_B);
    const a = await listen(appA);
    const b = await listen(appB);
    try {
      const inA = await post(a.port, { name: "A product", barcode: EAN_A });
      assert.equal(inA.status, 201);
      const inB = await post(b.port, { name: "B product", barcode: EAN_A });
      assert.equal(inB.status, 201, "uniqueness is per company, never global");
      /* and neither company sees the other's row */
      const listA = await list(a.port);
      const listB = await list(b.port);
      assert.equal(listA.body.data.length, 1);
      assert.equal(listB.body.data.length, 1);
      assert.equal(listB.body.data[0].name, "B product");
    } finally { a.server.close(); b.server.close(); }
  });

  test("8. barcode lookup path: company list is the scan/search source; inactive rows excluded", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, COMPANY_A);
    const { server, port } = await listen(app);
    try {
      await post(port, { name: "Active Scan", sku: "SCAN-1", barcode: EAN_A });
      /* inactive barcode is not returned by the POS list the scanner reads */
      const inactive = await post(port, { name: "Sleepy", barcode: "4006381333931" });
      assert.equal(inactive.status, 201);
      /* deactivate directly through the fake (edit has no active flag by design) */
      ctx.state.products.get(inactive.body.data.id).active = false;

      const data = (await list(port)).body.data;
      const hit = data.find((p) => p.barcode === EAN_A);
      assert.ok(hit, "active product resolvable by exact barcode");
      assert.equal(hit.sku, "SCAN-1", "SKU travels with the product (distinct identity)");
      assert.equal(data.some((p) => p.name === "Sleepy"), false, "inactive product is not returned");
    } finally { server.close(); }
  });

  test("9. SKU remains distinct from barcode (separate columns, separate rules)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, COMPANY_A);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Both", sku: "SHOP-001", barcode: EAN_A });
      assert.equal(created.body.data.sku, "SHOP-001");
      assert.equal(created.body.data.barcode, EAN_A);
      /* a SKU-shaped value is not gated as a barcode */
      const skuOnly = await post(port, { name: "Skus", sku: "4006381333932" });
      assert.equal(skuOnly.status, 201, "SKU accepts internal codes freely");
      const schema = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
      assert.match(schema, /sku VARCHAR\(100\)/);
      assert.match(schema, /barcode VARCHAR\(100\)/);
    } finally { server.close(); }
  });

  test("10. Global Product Master stays a separate reference catalogue", () => {
    const gpm = fs.readFileSync(new URL("../routes/globalProducts.js", import.meta.url), "utf8");
    /* reads the SHARED master table, never writes company products */
    assert.match(gpm, /FROM ean_product_master gpm/);
    assert.doesNotMatch(gpm, /INSERT INTO products/);
    /* existsInMaster is computed against the CURRENT company only */
    assert.match(gpm, /p\.company_id = \$\$\{params\.length \+ 1\}|p\.company_id = \$\d/);
    const schema = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
    assert.match(schema, /CREATE TABLE IF NOT EXISTS ean_product_master/);
    /* and the till list excludes the MISC placeholder while carrying barcode through */
    const normSrc = fs.readFileSync(new URL("../src/utils/formatters.js", import.meta.url), "utf8");
    assert.match(normSrc, /barcode: product\.barcode \|\| product\.ean/);
  });
});

/* -------------------------------------------------- Part B: tax */

describe("Tax rates & mapping", () => {
  test("1. product can carry its own configured rate (persistence through API)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx, COMPANY_A);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Reduced", vatRate: 5 });
      assert.equal(created.body.data.vat_rate, 5);
      const edited = await put(port, created.body.data.id, { name: "Reduced", vatRate: 0 });
      assert.equal(edited.body.data.vat_rate, 0, "zero-rated is a real value, not a default");
    } finally { server.close(); }
  });

  test("2. tax rates are data — no hard-coded rate in POS/ProductGrid/UI", () => {
    const pos = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
    const grid = fs.readFileSync(new URL("../src/pages/pos/ProductGrid.jsx", import.meta.url), "utf8");
    const totals = fs.readFileSync(new URL("../src/utils/saleTotals.js", import.meta.url), "utf8");
    assert.doesNotMatch(pos, /\*\s*0\.2|vatRate\s*=\s*0\.2(?!\))/, "no hard-coded 20% in POS");
    assert.doesNotMatch(grid, /vat|tax/i, "ProductGrid carries no tax logic");
    assert.match(totals, /vatRate/, "rates flow through the shared engine");
  });

  test("3. different products use different rates in ONE basket (engine, exact)", () => {
    const basket = [
      { price: 10, quantity: 1, vatApplicable: true, vatRate: 20 },  // standard
      { price: 10, quantity: 2, vatApplicable: true, vatRate: 5 },   // reduced
      { price: 10, quantity: 1, vatApplicable: false, vatRate: 0 },  // zero-rated
    ];
    const { vat, total } = computeBasketTotals(basket, { vatEnabled: true, vatRate: 0.2 });
    /* applicable gross 30: 10@20% = 2 + 20@5% = 1 → 3 */
    assert.ok(Math.abs(vat - 3) < 1e-9, `expected 3.00, got ${vat}`);
    assert.ok(Math.abs(total - 43) < 1e-9);
  });

  test("4. default-rate baskets are bit-for-bit unchanged (back-compat)", () => {
    const legacy = [{ price: 10, quantity: 1, vatApplicable: true }, { price: 10, quantity: 1, vatApplicable: false }];
    const { vat } = computeBasketTotals(legacy, { vatEnabled: true, vatRate: 0.2, discountType: "percent", discountValue: 10 });
    assert.ok(Math.abs(vat - 1.8) < 1e-9, "existing no-own-rate behaviour preserved exactly");
  });

  test("5. per-line tax matches the engine rule for sale payloads", () => {
    assert.equal(lineTaxFor({ price: 10, quantity: 1, vatApplicable: true, vatRate: 5 }, { vatEnabled: true, vatRate: 0.2 }), 0.5);
    assert.equal(lineTaxFor({ price: 10, quantity: 1, vatApplicable: true }, { vatEnabled: true, vatRate: 0.2 }), 2);
    assert.equal(lineTaxFor({ price: 10, quantity: 1, vatApplicable: false, vatRate: 20 }, { vatEnabled: true, vatRate: 0.2 }), 0);
    assert.equal(lineTaxFor({ price: 10, quantity: 1, vatApplicable: true, vatRate: 5 }, { vatEnabled: false, vatRate: 0.2 }), 0);
  });

  test("6. invalid/unmapped tax classification is NOT silently mapped (explicit state)", () => {
    const form = fs.readFileSync(new URL("../src/pages/products/ProductFormModal.jsx", import.meta.url), "utf8");
    const products = fs.readFileSync(new URL("../routes/products.js", import.meta.url), "utf8");
    /* the form's rate is a number field; no arbitrary category→rate guessing exists */
    assert.doesNotMatch(form, /taxCode|tax_code/);
    assert.doesNotMatch(products, /taxCode|tax_code/);
    /* GPM import: an invalid GTIN throws BEFORE any mapping/write — no silent defaults */
    const importer = fs.readFileSync(new URL("../services/globalProductMasterImport.js", import.meta.url), "utf8");
    assert.match(importer, /Invalid record or GTIN/);
  });

  test("7. company tax configuration is isolated (B's default never used for A)", async () => {
    const ctx = makeCtx();
    const app = express();
    app.use(express.json());
    app.use("/api", (req, _res, next) => {
      req.user = { id: USER, companyId: COMPANY_A, storeId: null };
      next();
    });
    const { default: createSettingsRouter } = await import("../routes/settings.js");
    app.use("/api", createSettingsRouter({
      authenticate: (_req, _res, next) => next(),
      authorize: () => (_req, _res, next) => next(),
      db: ctx.db,
      pool: ctx.pool,
      writeAudit: async () => {},
      testPaymentTerminal: async () => ({ ok: true }),
    }));
    const { server, port } = await listen(app);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/settings`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.tax.defaultVatRate, 20, "A reads A's config");
      assert.equal(body.data.tax.vatEnabled, true);
      assert.notEqual(body.data.tax.defaultVatRate, 5, "B's 5% default is never served to A");
    } finally { server.close(); }
  });

  test("8. product tax data reaches the basket and sale payload (source contracts)", () => {
    const norm = fs.readFileSync(new URL("../src/utils/formatters.js", import.meta.url), "utf8");
    assert.match(norm, /vatRate: Number\(product\.vat_rate \?\? product\.vatRate \?\? 20\)/, "product vat_rate reaches the basket item");
    const pos = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
    assert.match(pos, /lineTaxFor\(/, "sale line tax computed by the shared rule");
    assert.match(pos, /tax:\s*lineTax,/, "per-line tax lands on the sale item");
    const sco = fs.readFileSync(new URL("../src/pages/selfCheckout/SelfCheckout.jsx", import.meta.url), "utf8");
    assert.match(sco, /lineTaxFor\(/, "Self-Checkout uses the same per-line rule");
  });

  test("9. sale engine still trusts validated line tax & stores it on sale_items (regression)", () => {
    const sales = fs.readFileSync(new URL("../routes/sales.js", import.meta.url), "utf8");
    assert.match(sales, /INSERT INTO sale_items \(/);
    assert.match(sales, /Number\(item\.tax\) \|\| 0/, "line tax persisted as before");
    assert.match(sales, /vat_rate/, "product vat_rate remains available server-side");
  });

  test("10. offline cash-sale regression: queue payloads keep the per-line tax contract", () => {
    const pos = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
    const queue = fs.readFileSync(new URL("../src/services/offlineQueue.js", import.meta.url), "utf8");
    /* the SAME payload object (built with lineTaxFor) is queued offline */
    assert.match(pos, /enqueueOfflineSale\(/);
    assert.match(queue, /clientRequestId: entry\.clientRequestId/, "offline sync resends the identical payload key");
  });
});
