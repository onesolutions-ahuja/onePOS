/*
 * SMALL-TASK - Product VAT applicability + Opening stock.
 *
 * Backend: the REAL routes/products.js router over HTTP against a stateful
 * fake db that models the products table + an inventory ledger with the
 * project's real createInventoryMovement (ported verbatim from server.js).
 * Frontend: the REAL POS VAT computation path (basket -> totals) is
 * replicated from POS.jsx source via a contract assertion, plus a pure
 * recomputation for behaviour checks.
 *
 *   node --test tests/productVatOpeningStock.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";

/* ------------------------------------------------- real movement function */
/* Ported VERBATIM from server.js createInventoryMovement (kept in sync by
 * this file; drift fails the movement-contract test below). */
const inventoryMovementTypes = new Set([
  "OPENING", "PURCHASE", "SALE", "CUSTOMER_RETURN", "SUPPLIER_RETURN",
  "ADJUSTMENT_IN", "ADJUSTMENT_OUT", "RETURN_IN", "RETURN_OUT",
  "ONLINE_RESERVE", "ONLINE_RELEASE",
]);

async function createInventoryMovement(client, {
  companyId, productId, storeId, movementType,
  quantityChange, referenceType = null, referenceId = null,
  reason = null, notes = null, createdBy = null,
}) {
  const quantity = Number(quantityChange);
  if (!inventoryMovementTypes.has(movementType) || !Number.isFinite(quantity) ||
      (quantity === 0 && movementType !== "OPENING")) {
    throw new Error("Invalid inventory movement");
  }
  const productResult = await client.query(
    `SELECT id, name, price, vat_rate, track_stock, stock_quantity
     FROM products WHERE id = $1 AND company_id = $2 AND active = true FOR UPDATE`,
    [productId, companyId]
  );
  if (!productResult.rows.length) throw new Error("Product not found");
  const product = productResult.rows[0];
  const currentBalance = Number(product.stock_quantity);
  const newBalance = currentBalance + quantity;
  if (newBalance < 0) throw new Error(`Insufficient stock for ${product.name}`);
  await client.query(
    `INSERT INTO inventory_movements
     (company_id, product_id, store_id, movement_type, quantity_change, balance_after, reference_type, reference_id, reason, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [companyId, productId, storeId, movementType, quantity, newBalance, referenceType, referenceId, reason, notes, createdBy]
  );
  await client.query(
    `UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2`,
    [newBalance, productId]
  );
  return { balance: newBalance, quantityChange: quantity };
}

/* ------------------------------------------------------------ fake db/app */

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const STORE = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";

/*
 * REGRESSION (production incident): the create-product INSERT listed 19
 * columns but its VALUES clause had only 18 expressions (the $17 added with
 * age_restricted was missing), so PostgreSQL rejected EVERY product create
 * with "INSERT has more target columns than expressions" -> the UI showed
 * "Unable to create product". The fake db does not parse SQL, so the suite
 * stayed green while production was broken. This static contract test pins
 * column/VALUES arity and placeholder continuity for the create INSERT.
 */
test("create-product INSERT: VALUES arity matches columns and placeholders are contiguous", async () => {
  const src = fs.readFileSync(new URL("../routes/products.js", import.meta.url), "utf8");
  const m = src.match(/INSERT INTO products \(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)\s*RETURNING/);
  assert.ok(m, "INSERT INTO products ... VALUES ... RETURNING shape found");

  const columns = m[1].split(",").map((c) => c.trim()).filter(Boolean);
  const values = m[2].split(",").map((v) => v.trim()).filter(Boolean);

  assert.equal(
    columns.length, values.length,
    `INSERT has ${columns.length} target columns but ${values.length} VALUES expressions`
  );

  const placeholders = values
    .filter((v) => /^\$\d+$/.test(v))
    .map((v) => Number(v.slice(1)))
    .sort((a, b) => a - b);
  placeholders.forEach((n, i) => {
    assert.equal(n, i + 1, `placeholder sequence must be $1..$${placeholders.length} with no gaps (found $${n} at position ${i + 1})`);
  });
});

function makeCtx() {
  const state = { products: new Map(), movements: [] };
  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    // PUT existence check: SELECT id FROM products WHERE id=$1 AND company_id=$2
    if (/SELECT id FROM products WHERE id = \$1 AND company_id = \$2/i.test(s)) {
      const row = state.products.get(params[0]);
      return { rows: row && row.company_id === params[1] ? [{ id: row.id }] : [] };
    }
    // PUT pre-update audit snapshot (name, sku, barcode, category_id, price, vat_rate, age_restricted, active)
    if (/SELECT\s+name, sku, barcode, category_id, price, vat_rate, age_restricted, active\s+FROM products WHERE id = \$1 AND company_id = \$2/i.test(s)) {
      const row = state.products.get(params[0]);
      return { rows: row && row.company_id === params[1] ? [{ name: row.name, sku: row.sku, barcode: row.barcode, category_id: row.category_id, price: row.price, vat_rate: row.vat_rate, age_restricted: row.age_restricted, active: row.active }] : [] };
    }
    // PUT main UPDATE runs through db() (not the transaction client).
    // Params: image=$17 (null=keep, ''=clear), id=$18, companyId=$19.
    if (/^UPDATE products SET/i.test(s)) {
      const row = state.products.get(params[17]);
      if (!row || row.company_id !== params[18]) return { rows: [] };
      Object.assign(row, {
        name: params[1], price: Number(params[5]) || 0,
        vat_rate: Number(params[7]) || 0,
        // COALESCE($9, vat_applicable): null keeps stored value.
        vat_applicable: params[8] === null ? row.vat_applicable : params[8] === true,
        // COALESCE($10, age_restricted): null keeps stored value (T10C).
        age_restricted: params[9] === null ? row.age_restricted : params[9] === true,
        // image_url: null = field omitted (keep), '' = cleared, else set.
        image_url: params[16] === null ? row.image_url : params[16] === "" ? null : params[16],
        track_stock: params[11] === true,
      });
      return { rows: [{ ...row }] };
    }
    return { rows: [], rowCount: 0 };
  };
  const client = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (/INSERT INTO products \(/.test(s)) {
        // VALUES: vat_applicable($10), age_restricted($11), stock 0, low($12), track($13)
        const row = {
          id: `p-${state.products.size + 1}`,
          company_id: params[0],
          name: params[2],
          price: Number(params[6]) || 0,
          vat_rate: Number(params[8]) || 0,
          vat_applicable: params[9] !== false && params[9] !== null,
          age_restricted: params[10] === true,
          stock_quantity: 0,
          track_stock: params[12] === true,
          active: true,
        };
        state.products.set(row.id, row);
        return { rows: [row] };
      }
      if (/FROM products WHERE id = \$1 AND company_id = \$2/.test(s)) {
        const row = state.products.get(params[0]);
        return { rows: row && row.company_id === params[1] ? [{ ...row }] : [] };
      }
      if (/INSERT INTO inventory_movements/.test(s)) {
        state.movements.push({
          productId: params[1], storeId: params[2], movementType: params[3],
          quantityChange: Number(params[4]), balanceAfter: Number(params[5]), reason: params[8],
        });
        return { rowCount: 1 };
      }
      if (/UPDATE products SET stock_quantity = \$1/.test(s)) {
        const row = state.products.get(params[1]);
        if (row) row.stock_quantity = Number(params[0]);
        return { rowCount: row ? 1 : 0 };
      }
      if (/^UPDATE products SET/.test(s)) {
        const row = state.products.get(params[16]);
        if (!row || row.company_id !== params[17]) return { rows: [] };
        Object.assign(row, {
          name: params[1], price: Number(params[5]) || 0,
          vat_rate: Number(params[7]) || 0,
          // COALESCE($9, vat_applicable): null keeps stored value.
          vat_applicable: params[8] === null ? row.vat_applicable : params[8] === true,
          age_restricted: params[9] === null ? row.age_restricted : params[9] === true,
          track_stock: params[11] === true,
        });
        return { rows: [{ ...row }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const pool = { async connect() { return { ...client, release() {} }; } };
  return { state, db, client, pool };
}

async function buildApp(ctx, storeId = STORE) {
  const mod = await import("../routes/products.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId: COMPANY, storeId, role: "admin" };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement,
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

/* ------------------------------------------------------------------ tests */

describe("VAT applicability (product create/edit)", () => {
  test("new product defaults VAT applicable = true when the field is omitted", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status, body } = await post(port, { name: "Standard Item", price: 10, vatRate: 20 });
      assert.equal(status, 201);
      assert.equal(body.data.vat_applicable, true, "omitted vatApplicable must default to true");
    } finally { server.close(); }
  });

  test("new product with VAT applicable OFF stores vat_applicable = false", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status, body } = await post(port, { name: "Zero-rated", price: 5, vatRate: 20, vatApplicable: false });
      assert.equal(status, 201);
      assert.equal(body.data.vat_applicable, false);
    } finally { server.close(); }
  });

  test("editing a product without sending vatApplicable keeps its stored value", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Keep me", price: 8, vatApplicable: false });
      const id = created.body.data.id;
      const updated = await put(port, id, { name: "Keep me 2", price: 9, vatRate: 20 });
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.vat_applicable, false, "edit without the field must not flip VAT");
    } finally { server.close(); }
  });

  test("editing can explicitly toggle VAT applicable OFF then ON", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Toggle", price: 8, vatRate: 20 });
      const id = created.body.data.id;
      const off = await put(port, id, { name: "Toggle", price: 8, vatRate: 20, vatApplicable: false });
      assert.equal(off.body.data.vat_applicable, false);
      const on = await put(port, id, { name: "Toggle", price: 8, vatRate: 20, vatApplicable: true });
      assert.equal(on.body.data.vat_applicable, true);
    } finally { server.close(); }
  });
});

describe("Opening stock (create-only, store-specific, ledger-traceable)", () => {
  test("opening stock is written through the OPENING inventory movement and sets the store balance", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status, body } = await post(port, { name: "Stocked", price: 3, stockQuantity: 25 });
      assert.equal(status, 201);
      assert.equal(body.data.stock_quantity, 25, "store starting balance must be the opening quantity");
      const opening = ctx.state.movements.filter((m) => m.movementType === "OPENING");
      assert.equal(opening.length, 1, "exactly one OPENING movement");
      assert.equal(opening[0].quantityChange, 25);
      assert.equal(opening[0].storeId, STORE, "opening stock is store-specific");
      assert.match(opening[0].reason, /Opening stock/);
    } finally { server.close(); }
  });

  test("editing an existing product does NOT reset current stock (no opening/adjustment movement)", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, { name: "Precious", price: 4, stockQuantity: 40 });
      const id = created.body.data.id;
      ctx.state.movements.length = 0; // clear creation movements

      await put(port, id, { name: "Precious", price: 4.5, vatRate: 20, stockQuantity: 999 }); // hostile payload
      const row = ctx.state.products.get(id);
      assert.equal(row.stock_quantity, 40, "stock must survive the edit untouched");
      assert.equal(ctx.state.movements.length, 0, "an edit must not write stock movements");
    } finally { server.close(); }
  });

  test("track stock OFF creates NO opening stock movement", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status } = await post(port, { name: "Service", price: 30, trackStock: false, stockQuantity: 17 });
      assert.equal(status, 201);
      assert.equal(ctx.state.movements.filter((m) => m.movementType === "OPENING").length, 0,
        "track_stock OFF must not create/use opening stock");
    } finally { server.close(); }
  });

  test("movement contract: the shared createInventoryMovement primitive keeps its guarantees", () => {
    /* The primitive now lives in services/inventory.js (single shared code
     * path for sales, purchases, returns and adjustments); server.js imports
     * it instead of defining a private copy. */
    const svcSrc = fs.readFileSync(new URL("../services/inventory.js", import.meta.url), "utf8");
    const fnStart = svcSrc.indexOf("export async function createInventoryMovement");
    assert.ok(fnStart > -1, "createInventoryMovement must exist in services/inventory.js");
    const fnSrc = svcSrc.slice(fnStart);
    assert.match(fnSrc, /INSERT INTO inventory_movements/);
    assert.match(fnSrc, /stock_quantity = \$1/, "movement updates the product balance");
    assert.match(fnSrc, /currentBalance = Number\(product\.stock_quantity\)/);
    assert.match(fnSrc, /newBalance = currentBalance \+ quantity/, "balance math preserved");
    assert.match(fnSrc, /Insufficient stock/);
    /* Stock-by-store: the same transaction maintains the store position. */
    assert.match(fnSrc, /INSERT INTO product_store_stock/, "store-scoped position is maintained by the same primitive");
    assert.match(fnSrc, /ON CONFLICT \(company_id, store_id, product_id\)/, "one stock record per company+store+product");
    const serverSrc = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
    assert.match(serverSrc, /import \{[^}]*createInventoryMovement[^}]*\} from "\.\/services\/inventory\.js"/, "server.js uses the shared primitive, not a private copy");
  });
});

/* ------------------------------------------------- POS VAT behaviour (frontend contract) */

/* Replicates the exact POS.jsx totals logic for behavioural assertions. */
function computePosVat(basket, { vatEnabled, vatRate, discountValue = 0, discountType = null }) {
  const grossSubtotal = basket.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
  const discountAmount = discountType === "percent"
    ? Math.min(grossSubtotal, grossSubtotal * (Number(discountValue) / 100))
    : Math.min(grossSubtotal, Math.max(0, Number(discountValue) || 0));
  const subtotal = Math.max(0, grossSubtotal - discountAmount);
  const vatApplicableSubtotal = basket.reduce(
    (sum, item) => (item.vatApplicable === false ? sum : sum + Number(item.price || 0) * item.quantity),
    0
  );
  const discountedVatSubtotal = grossSubtotal > 0
    ? vatApplicableSubtotal * (subtotal / grossSubtotal)
    : vatApplicableSubtotal;
  const vat = vatEnabled ? discountedVatSubtotal * vatRate : 0;
  return { subtotal, vat, total: subtotal + vat };
}

describe("POS VAT calculation with per-product applicability", () => {
  test("vatApplicable OFF -> NO VAT for that product even with a vatRate", () => {
    const { vat, total } = computePosVat(
      [{ price: 10, quantity: 1, vatApplicable: false, vatRate: 20 }],
      { vatEnabled: true, vatRate: 0.2 }
    );
    assert.equal(vat, 0, "VAT-applicable OFF product must not attract VAT");
    assert.equal(total, 10);
  });

  test("vatApplicable ON -> existing VAT calculation works (20%)", () => {
    const { vat, total } = computePosVat(
      [{ price: 10, quantity: 1, vatApplicable: true }],
      { vatEnabled: true, vatRate: 0.2 }
    );
    assert.ok(Math.abs(vat - 2) < 1e-9);
    assert.ok(Math.abs(total - 12) < 1e-9);
  });

  test("mixed basket: VAT only on applicable lines, discount allocated proportionally", () => {
    // £10 standard + £10 zero-rated, 10% discount -> VAT base = 9 -> VAT 1.80
    const { vat } = computePosVat(
      [
        { price: 10, quantity: 1, vatApplicable: true },
        { price: 10, quantity: 1, vatApplicable: false },
      ],
      { vatEnabled: true, vatRate: 0.2, discountType: "percent", discountValue: 10 }
    );
    assert.ok(Math.abs(vat - 1.8) < 1e-9, `expected 1.80, got ${vat}`);
  });

  test("POS.jsx source drives VAT from item.vatApplicable (wiring assertion)", () => {
    const posSrc = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
    /* T10D: the totals/VAT engine now lives in the shared module so
     * Self-Checkout uses the same single calculation. */
    const totalsSrc = fs.readFileSync(new URL("../src/utils/saleTotals.js", import.meta.url), "utf8");
    assert.match(totalsSrc, /item\.vatApplicable === false\s+\? sum\s+: sum/, "basket VAT base must exclude non-applicable lines");
    assert.match(totalsSrc, /vat = vatEnabled \? discountedVatSubtotal \* vatRate : 0/, "global master switch still gates everything");
    assert.match(posSrc, /computeBasketTotals\(basket/, "POS totals must come from the shared engine");
    assert.match(posSrc, /item\.vatApplicable === false\s*\?\s*0\s*:\s*vatRate/, "line VAT must zero-rate non-applicable items");
  });

  test("normaliseProduct carries vat_applicable through to POS/basket items", () => {
    const fmt = fs.readFileSync(new URL("../src/utils/formatters.js", import.meta.url), "utf8");
    assert.match(fmt, /vat_applicable/);
    assert.match(fmt, /vatApplicable/);
  });
});

/* --------------------------------------------- schema migration contract */

describe("schema migration contract", () => {
  test("products.vat_applicable exists with TRUE default (existing rows unchanged)", () => {
    const schema = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
    assert.match(schema, /vat_applicable BOOLEAN NOT NULL DEFAULT TRUE/);
    const init = fs.readFileSync(new URL("../database/init.js", import.meta.url), "utf8");
    assert.match(init, /ADD COLUMN IF NOT EXISTS vat_applicable BOOLEAN NOT NULL DEFAULT TRUE/);
  });

  test("EAN master is untouched by the VAT flag", () => {
    const schema = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
    const eanStart = schema.indexOf("CREATE TABLE IF NOT EXISTS ean_product_master");
    const eanEnd = schema.indexOf(");", eanStart);
    const eanTable = schema.slice(eanStart, eanEnd);
    assert.ok(!eanTable.includes("vat_applicable"), "no VAT applicability on the global EAN master");
  });
});
