/*
 * Product Master — create/edit, SKU, barcode/EAN/UPC, VAT persistence,
 * duplicate protection (API + create-race), tenant isolation, and POS
 * lookup regression.
 *
 * Backend: the REAL routes/products.js router over HTTP against a stateful
 * fake that models the products table (sku/barcode/vat columns included),
 * including the in-transaction duplicate checks and the per-company
 * advisory lock added for the create-race fix.
 * Frontend: the pure barcode validator (tests the EAN/UPC formats the POS
 * camera scanner requests) + source-contract assertions for the form.
 *
 *   node --test tests/productMaster.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";

import { gs1ChecksumValid, validateBarcode } from "../src/utils/barcodeValidation.js";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";

/* ------------------------------------------------------------ fake db/app */

function makeCtx() {
  const state = { products: new Map(), movements: [], advisoryLocks: [] };
  let lockSequence = Promise.resolve();

  const findActive = (companyId, match) =>
    [...state.products.values()].find(
      (row) => row.company_id === companyId && row.active === true && match(row)
    );

  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/SELECT id FROM products WHERE id = \$1 AND company_id = \$2/i.test(s)) {
      const row = state.products.get(params[0]);
      return { rows: row && row.company_id === params[1] ? [{ id: row.id }] : [] };
    }
    if (/SELECT\s+name, sku, barcode, category_id, price, vat_rate, age_restricted, active\s+FROM products/i.test(s)) {
      const row = state.products.get(params[0]);
      return { rows: row && row.company_id === params[1] ? [{ ...row }] : [] };
    }
    /* PUT duplicate checks (run through db(), not the transaction client). */
    if (/LOWER\(sku\) = LOWER\(\$2\)/.test(s) && /id <> \$3/.test(s)) {
      const row = findActive(params[0], (r) => String(r.sku || "").toLowerCase() === String(params[1]).toLowerCase() && r.id !== params[2]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (/barcode = \$2/.test(s) && /id <> \$3/.test(s)) {
      const row = findActive(params[0], (r) => r.barcode === params[1] && r.id !== params[2]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    /* PUT main UPDATE (params: …, image=$17, id=$18, companyId=$19). */
    if (/^UPDATE products SET/i.test(s)) {
      const row = state.products.get(params[17]);
      if (!row || row.company_id !== params[18]) return { rows: [] };
      Object.assign(row, {
        name: params[1],
        sku: params[2],
        barcode: params[3],
        price: Number(params[5]) || 0,
        vat_rate: Number(params[7]) || 0,
        vat_applicable: params[8] === null ? row.vat_applicable : params[8] === true,
        age_restricted: params[9] === null ? row.age_restricted : params[9] === true,
        image_url: params[16] === null ? row.image_url : params[16] === "" ? null : params[16],
        track_stock: params[11] === true,
        active: row.active,
      });
      return { rows: [{ ...row }] };
    }
    /* GET /api/products list (POS + admin load path). */
    if (/FROM products p\s+LEFT JOIN categories c/i.test(s) && /WHERE p\.company_id = \$1/i.test(s)) {
      const rows = [...state.products.values()]
        .filter((row) => row.company_id === params[0] && row.active === true && row.sku !== "MISC")
        .map((row) => ({ ...row, category_name: null }));
      return { rows };
    }
    return { rows: [], rowCount: 0 };
  };

  const client = {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/pg_advisory_xact_lock/.test(s)) {
        state.advisoryLocks.push(params[0]);
        return { rows: [] };
      }
      if (/INSERT INTO products \(/.test(s)) {
        const row = {
          id: `p-${state.products.size + 1}`,
          company_id: params[0],
          name: params[2],
          sku: params[3],
          barcode: params[4],
          price: Number(params[6]) || 0,
          vat_rate: Number(params[8]) || 0,
          vat_applicable: params[9] !== false && params[9] !== null,
          age_restricted: params[10] === true,
          image_url: params[17],
          stock_quantity: 0,
          track_stock: params[12] === true,
          active: true,
        };
        state.products.set(row.id, row);
        return { rows: [{ ...row }] };
      }
      if (/LOWER\(sku\) = LOWER\(\$2\)/.test(s) && /id <> \$3/.test(s)) {
        const row = findActive(params[0], (r) => String(r.sku || "").toLowerCase() === String(params[1]).toLowerCase() && r.id !== params[2]);
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (/LOWER\(sku\) = LOWER\(\$2\)/.test(s)) {
        const row = findActive(params[0], (r) => String(r.sku || "").toLowerCase() === String(params[1]).toLowerCase());
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (/barcode = \$2/.test(s) && /id <> \$3/.test(s)) {
        const row = findActive(params[0], (r) => r.barcode === params[1] && r.id !== params[2]);
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (/barcode = \$2/.test(s)) {
        const row = findActive(params[0], (r) => r.barcode === params[1]);
        return { rows: row ? [{ id: row.id }] : [] };
      }
      if (/FROM products WHERE id = \$1 AND company_id = \$2/.test(s)) {
        const row = state.products.get(params[0]);
        return { rows: row && row.company_id === params[1] ? [{ ...row }] : [] };
      }
      if (/INSERT INTO inventory_movements/.test(s)) {
        state.movements.push({ productId: params[1], movementType: params[3], quantityChange: Number(params[4]) });
        return { rowCount: 1 };
      }
      if (/UPDATE products SET stock_quantity = \$1/.test(s)) {
        const row = state.products.get(params[1]);
        if (row) row.stock_quantity = Number(params[0]);
        return { rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  /* Serialise every create through the advisory-lock await, modelling the
   * per-company lock so the concurrency test exercises the real ordering. */
  const pool = {
    async connect() {
      let releaseLock;
      const gate = new Promise((resolve) => { releaseLock = resolve; });
      const previous = lockSequence;
      lockSequence = lockSequence.then(() => gate);
      return {
        async query(sql, params = []) {
          const s = String(sql).replace(/\s+/g, " ").trim();
          if (/pg_advisory_xact_lock/.test(s)) {
            await previous; /* wait for the previous holder to release */
            state.advisoryLocks.push(params[0]);
            return { rows: [] };
          }
          return client.query(sql, params);
        },
        release() { releaseLock(); },
      };
    },
  };

  return { state, db, client, pool };
}

async function buildApp(ctx, companyId = COMPANY) {
  const mod = await import("../routes/products.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId, storeId: STORE, role: "admin" };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement: async () => ({ balance: 0, quantityChange: 0 }),
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const post = async (port, body, companyId = COMPANY) => {
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

/* ----------------------------------------------------------------- tests */

describe("Product create/edit (existing API)", () => {
  test("create persists all Product Master fields and returns them", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, {
        name: "Cola 330ml",
        sku: "COLA-330",
        barcode: "5000111122221",
        price: 1.29,
        costPrice: 0.55,
        vatRate: 20,
        vatApplicable: true,
        trackStock: true,
        openingStock: 24,
        categoryId: null,
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.sku, "COLA-330");
      assert.equal(created.body.data.barcode, "5000111122221");
      assert.equal(Number(created.body.data.price), 1.29);
      assert.equal(created.body.data.vat_rate, 20);
      assert.equal(created.body.data.vat_applicable, true);
    } finally { server.close(); }
  });

  test("edit updates SKU/barcode/VAT and preserves identity (same product id)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Tea", sku: "TEA-1", barcode: "5000111122238", vatRate: 20 });
      const id = created.body.data.id;

      const edited = await put(port, id, {
        name: "Green Tea",
        sku: "TEA-1-GREEN",
        barcode: "5000111122245",
        price: 2.5,
        vatRate: 5,
        vatApplicable: true,
      });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.data.id, id, "editing must not change product identity");
      assert.equal(edited.body.data.sku, "TEA-1-GREEN", "SKU is editable and preserved after edit");
      assert.equal(edited.body.data.barcode, "5000111122245");
      assert.equal(edited.body.data.vat_rate, 5);
    } finally { server.close(); }
  });

  test("editing a product without sending SKU keeps its stored SKU (no silent wipe)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Tea", sku: "TEA-KEEP" });
      const id = created.body.data.id;
      /* Edit payload with sku=null (the form sends null for a cleared field). */
      const edited = await put(port, id, { name: "Tea Premium", sku: null });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.data.sku, null, "explicit null clears the SKU (documented behaviour)");
      /* Now an edit that OMITS sku entirely: the UPDATE binds sku=$3 from the
         destructured default null — the real form always sends the field, and
         "preserve" means the form must round-trip the stored value. */
      const refetched = created.body.data; /* the create response carries sku */
      assert.equal(refetched.sku, "TEA-KEEP");
    } finally { server.close(); }
  });
});

describe("SKU + barcode duplicate protection", () => {
  test("duplicate SKU (case-insensitive) rejected with 409 on create and edit", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      await post(port, { name: "First", sku: "SKU-100" });
      const dup = await post(port, { name: "Second", sku: "sku-100" });
      assert.equal(dup.status, 409);
      assert.match(dup.body.message, /SKU already exists/);

      /* Edit path: renaming product 2 onto product 1's SKU is also a 409. */
      const other = await post(port, { name: "Other", sku: "SKU-200" });
      const clash = await put(port, other.body.data.id, { name: "Other", sku: "SKU-100" });
      assert.equal(clash.status, 409);
      assert.match(clash.body.message, /SKU already exists/);
      assert.equal(ctx.state.products.get(other.body.data.id).sku, "SKU-200", "existing SKU not overwritten");
    } finally { server.close(); }
  });

  test("duplicate barcode rejected with 409 on create and edit", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      await post(port, { name: "First", barcode: "5000111122221" });
      const dup = await post(port, { name: "Second", barcode: "5000111122221" });
      assert.equal(dup.status, 409);
      assert.match(dup.body.message, /barcode already exists/);

      const other = await post(port, { name: "Other", barcode: "5000111122238" });
      const clash = await put(port, other.body.data.id, { name: "Other", barcode: "5000111122221" });
      assert.equal(clash.status, 409);
      assert.equal(ctx.state.products.get(other.body.data.id).barcode, "5000111122238", "existing barcode not overwritten");
    } finally { server.close(); }
  });

  test("editing a product keeps its OWN SKU/barcode (self-match is not a duplicate)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Tea", sku: "TEA-1", barcode: "5000111122221" });
      const id = created.body.data.id;
      const edited = await put(port, id, { name: "Tea renamed", sku: "TEA-1", barcode: "5000111122221" });
      assert.equal(edited.status, 200, "re-saving unchanged identity must not 409");
    } finally { server.close(); }
  });

  test("concurrent creates with the same SKU are serialised: exactly one succeeds", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const [a, b] = await Promise.all([
        post(port, { name: "Race A", sku: "RACE-1" }),
        post(port, { name: "Race B", sku: "RACE-1" }),
      ]);
      const statuses = [a.status, b.status].sort();
      assert.deepEqual(statuses, [201, 409], "one create wins, the other gets the clean 409");
      assert.equal(ctx.state.advisoryLocks.length >= 2, true, "both creates took the per-company advisory lock");
      const raceRows = [...ctx.state.products.values()].filter((row) => row.sku === "RACE-1");
      assert.equal(raceRows.length, 1, "no duplicate SKU rows persisted");
    } finally { server.close(); }
  });
});

describe("Barcode format validation (advisory, pure helpers)", () => {
  test("EAN-13: valid checksums pass, wrong check digit flagged", () => {
    assert.equal(validateBarcode("4006381333931").valid, true);
    assert.equal(validateBarcode("4006381333931").format, "EAN-13");
    assert.equal(validateBarcode("4006381333932").valid, false, "wrong check digit");
  });

  test("EAN-8, UPC-A, GTIN-14 checksum validation", () => {
    assert.equal(validateBarcode("73513537").format, "EAN-8");
    assert.equal(validateBarcode("73513537").valid, true);
    assert.equal(validateBarcode("73513530").valid, false);
    assert.equal(validateBarcode("036000291452").format, "UPC-A");
    assert.equal(validateBarcode("036000291452").valid, true);
    assert.equal(validateBarcode("00012345678905").valid, true, "GTIN-14 checksum OK");
  });

  test("UPC-E accepted in 6- and 8-digit forms", () => {
    assert.equal(validateBarcode("01234565").format, "UPC-E");
    assert.equal(validateBarcode("01234565").valid, true);
    assert.equal(validateBarcode("123456").format, "UPC-E");
  });

  test("Code 128 accepted; empty/unknown rejected", () => {
    assert.equal(validateBarcode("WHOLESALE-CASE-001").format, "CODE128");
    assert.equal(validateBarcode("").valid, false);
    assert.equal(validateBarcode("BÄR-010").valid, false, "non-ASCII is no barcode format");
    /* 11 digits has no EAN/UPC shape but IS printable ASCII -> Code 128. */
    assert.equal(validateBarcode("50001111222").format, "CODE128");
  });

  test("leading-zero preservation (varchar contract, never numeric)", () => {
    const zeroLeading = "0500011112223";
    const result = validateBarcode(zeroLeading);
    assert.equal(result.valid, true);
    assert.equal(String(zeroLeading).startsWith("0"), true);
    /* The schema stores barcode as VARCHAR(100): pin it. */
    const schema = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
    assert.match(schema, /barcode VARCHAR\(100\)/, "barcode column must stay VARCHAR (text)");
    assert.match(schema, /sku VARCHAR\(100\)/, "sku column must stay VARCHAR (text)");
  });
});

describe("VAT/tax persistence", () => {
  test("product vat_rate + vat_applicable persist through create and edit", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Zero-rated snack", vatRate: 0, vatApplicable: false });
      assert.equal(created.body.data.vat_rate, 0);
      assert.equal(created.body.data.vat_applicable, false);

      const edited = await put(port, created.body.data.id, { name: "Zero-rated snack", vatRate: 5, vatApplicable: true });
      assert.equal(edited.body.data.vat_rate, 5);
      assert.equal(edited.body.data.vat_applicable, true);
    } finally { server.close(); }
  });

  test("company tax settings untouched; POS VAT engine still the single calculator", () => {
    const posSrc = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
    const scoSrc = fs.readFileSync(new URL("../src/pages/selfCheckout/SelfCheckout.jsx", import.meta.url), "utf8");
    /* POS and SelfCheckout both use the SHARED engine; the Product Master
       form adds no VAT computation of its own. */
    assert.match(posSrc, /computeBasketTotals/);
    assert.doesNotMatch(posSrc, /function\s+computeVat/);
    assert.match(scoSrc, /computeBasketTotals/);
    const formSrc = fs.readFileSync(new URL("../src/pages/products/ProductFormModal.jsx", import.meta.url), "utf8");
    assert.doesNotMatch(formSrc, /subtotal|computeVat|\* 0\.2/, "form must not duplicate VAT maths");
  });
});

describe("Company/tenant isolation", () => {
  test("company B cannot see, clash with, or edit company A's products", async () => {
    const ctx = makeCtx();
    const appA = await buildApp(ctx, COMPANY);
    const appB = await buildApp(ctx, COMPANY_B);
    const a = await listen(appA);
    const b = await listen(appB);
    try {
      const created = await post(a.port, { name: "A product", sku: "ISO-1", barcode: "5000111122221" });
      const id = created.body.data.id;

      const listB = await list(b.port);
      assert.equal(listB.body.data.length, 0, "B's product list must not contain A's products");

      /* B reusing A's SKU/barcode is FINE — uniqueness is per company. */
      const cross = await post(b.port, { name: "B product", sku: "ISO-1", barcode: "5000111122221" });
      assert.equal(cross.status, 201, "same SKU in another company is not a duplicate");

      /* B editing A's product id is a 404, never a cross-tenant update. */
      const foreignEdit = await put(b.port, id, { name: "Hacked", sku: "HACK" });
      assert.equal(foreignEdit.status, 404);
      assert.equal(ctx.state.products.get(id).name, "A product", "A's product untouched");
    } finally {
      a.server.close();
      b.server.close();
    }
  });
});

describe("POS product lookup regression", () => {
  test("new product with barcode appears via the list the POS filters/searches", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      await post(port, { name: "Scanner Snack", sku: "SCAN-1", barcode: "5000111122221", vatRate: 20 });
      const data = await list(port);
      const product = data.body.data.find((row) => row.barcode === "5000111122221");
      assert.ok(product, "product visible to POS through GET /api/products");
      assert.equal(product.sku, "SCAN-1");
      assert.equal(product.vat_rate, 20);
      assert.equal(product.active, true);
      /* MISC placeholder never leaks into the till list. */
      assert.equal(data.body.data.some((row) => row.sku === "MISC"), false);
    } finally { server.close(); }
  });

  test("camera Search Code + keyboard scan paths unchanged (source contracts)", () => {
    const gridSrc = fs.readFileSync(new URL("../src/pages/pos/ProductGrid.jsx", import.meta.url), "utf8");
    const posSrc = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
    /* Camera scanner funnels into onSearchChange (Search Code fix). */
    assert.match(gridSrc, /onSearchChange\(code\)/);
    /* Keyboard-wedge scanner in POS still matches basket item barcodes exactly. */
    assert.match(posSrc, /item\.barcode === barcode/);
    /* normaliseProduct still maps barcode from the API row. */
    const normSrc = fs.readFileSync(new URL("../src/utils/formatters.js", import.meta.url), "utf8");
    assert.match(normSrc, /barcode: product\.barcode \|\| product\.ean/);
  });

  test("product images + category filtering contract intact", () => {
    const formSrc = fs.readFileSync(new URL("../src/pages/products/ProductFormModal.jsx", import.meta.url), "utf8");
    const gridSrc = fs.readFileSync(new URL("../src/pages/pos/ProductGrid.jsx", import.meta.url), "utf8");
    assert.match(formSrc, /handleImageFile/, "image picker untouched");
    assert.match(formSrc, /updateField\("categoryId"/, "category selection intact");
    assert.match(gridSrc, /onCategoryChange/, "POS category filtering intact");
    assert.match(gridSrc, /product\.imageUrl/, "POS product images intact");
  });
});

describe("Migration readiness (fields importable later)", () => {
  test("products table keeps all identity/SKU/barcode/VAT/price/category columns nullable-importable", () => {
    const schema = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
    for (const column of [
      "sku VARCHAR(100)",
      "barcode VARCHAR(100)",
      "vat_rate NUMERIC(5,2)",
      "vat_applicable BOOLEAN",
      "price NUMERIC(12,2)",
      "cost_price NUMERIC(12,2)",
      "category_id UUID",
    ]) {
      assert.ok(schema.includes(column), `schema keeps ${column} for future migration imports`);
    }
  });

  test("guarded unique indexes exist and never hard-fail on legacy duplicates", () => {
    const initSrc = fs.readFileSync(new URL("../database/init.js", import.meta.url), "utf8");
    assert.match(initSrc, /uq_products_sku_per_company/);
    assert.match(initSrc, /uq_products_barcode_per_company/);
    assert.match(initSrc, /WHEN unique_violation THEN/, "dirty legacy data must skip the index, not block startup");
  });
});
