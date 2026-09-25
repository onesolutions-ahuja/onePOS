/*
 * TILL ACTIONS — permanent suite (Misc Item, Petty Cash, Print).
 *
 * Backend: drives the REAL routes/sales.js (POST /api/sales with miscLines)
 * and routes/products.js (POST /api/products/misc-line, till list) over HTTP
 * against a stateful fake db — the same harness pattern as
 * tests/tillProductView.test.mjs. Proves misc lines are REAL sale rows
 * (item_type='MISC', correct money maths, receipt-bearing, no stock
 * movement), that validation rejects bad input, that the placeholder never
 * leaks into the till grid, and that ordinary product sales are untouched.
 *
 * Frontend: static contract tests over the real POS.jsx / CartPanel.jsx /
 * TillActionsModals.jsx / TillSessionModal.jsx sources pin the action bar,
 * the modal behaviour and the print path.
 *
 *   node --test tests/tillMiscPettyPrint.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";

/* ------------------------------------------------------------ fake db */

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const TERMINAL_1 = "t0000000-0000-4000-8000-000000000001";
const USER_1 = "u0000000-0000-4000-8000-000000000001";

function makeDb() {
  const state = {
    products: [
      {
        id: "p-cola",
        company_id: COMPANY_A,
        name: "Cola",
        sku: "SKU-COLA",
        barcode: "5001",
        price: 1.5,
        vat_rate: 0.2,
        vat_applicable: true,
        age_restricted: false,
        track_stock: true,
        stock_quantity: 10,
        active: true,
      },
      {
        id: "p-tracked",
        company_id: COMPANY_A,
        name: "Tracked Widget",
        sku: "SKU-W",
        barcode: "5002",
        price: 5,
        vat_rate: 0.2,
        vat_applicable: true,
        age_restricted: false,
        track_stock: true,
        stock_quantity: 3,
        active: true,
      },
      {
        id: "p-foreign",
        company_id: COMPANY_B,
        name: "Foreign Product",
        sku: "SKU-B",
        barcode: "9999",
        price: 9,
        vat_rate: 0.2,
        vat_applicable: true,
        age_restricted: false,
        track_stock: true,
        stock_quantity: 5,
        active: true,
      },
    ],
    tillSessions: [
      {
        id: "ts-1",
        company_id: COMPANY_A,
        store_id: STORE_1,
        terminal_id: TERMINAL_1,
        terminal_number: "T1",
        status: "open",
        opening_cash: 100,
        opened_at: "2026-09-19T08:00:00Z",
      },
    ],
    tillOpenRow: {
      id: "ts-1",
      terminal_id: TERMINAL_1,
      terminal_number: "T1",
      timezone: "Europe/London",
    },
    sales: [],
    saleItems: [],
    payments: [],
    cashMovements: [],
    miscId: null,
    movements: [],
    nextId: 1,
    sqlLog: [],
  };

  const id = (prefix) => `${prefix}-${state.nextId++}`;

  const rows = (sql, params) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    state.sqlLog.push({ sql: s, params });

    /* ---- till session lookup inside the sale transaction ---- */
    if (/SELECT ts\.id, ts\.terminal_id, t\.terminal_number, c\.timezone FROM till_sessions ts/.test(s)) {
      return { rows: state.tillSessions.length ? [state.tillOpenRow] : [] };
    }

    /* ---- MISC placeholder find-or-create ---- */
    if (/INSERT INTO products \(/.test(s) && /sku/i.test(s) && String(params?.[1]) === "MISC") {
      if (!state.miscId) state.miscId = id("p-misc");
      return { rows: [{ id: state.miscId }] };
    }

    /* ---- product FOR UPDATE / SELECT by id+company ---- */
    if (/FROM products WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const product = state.products.find(
        (p) => p.id === params[0] && p.company_id === params[1]
      );
      return { rows: product ? [product] : [] };
    }

    /* ---- receipt numbering helpers ---- */
    if (/to_char\(timezone\(\$1, NOW\(\)\), 'YYYYMMDD'\)/.test(s)) {
      return { rows: [{ date_key: "20260919" }] };
    }
    if (/pg_advisory_xact_lock/.test(s)) {
      return { rows: [] };
    }
    if (/MAX\(NULLIF\(split_part\(receipt_number/.test(s)) {
      const prefix = params[2].replace(/[%\\_]/g, "");
      const max = state.sales
        .filter((sale) => sale.receipt_number.startsWith(prefix))
        .reduce((acc, sale) => {
          const n = Number(sale.receipt_number.split("-")[2]) || 0;
          return Math.max(acc, n);
        }, 0);
      return { rows: [{ next_number: max + 1 }] };
    }

    /* ---- negative-billing setting probe ---- */
    if (/SELECT allow_negative_inventory_billing FROM company_settings/.test(s)) {
      return { rows: [] };
    }

    /* ---- INSERT INTO sales ---- */
    if (/INSERT INTO sales \(/.test(s)) {
      const sale = {
        id: id("sale"),
        company_id: params[0],
        store_id: params[1],
        user_id: params[2],
        terminal_id: params[4],
        receipt_number: params[5],
        subtotal: params[6],
        tax: params[7],
        discount: params[8],
        total: params[9],
        created_at: new Date().toISOString(),
      };
      state.sales.push(sale);
      return { rows: [{ id: sale.id, created_at: sale.created_at, total: sale.total, receipt_number: sale.receipt_number }] };
    }

    /* ---- INSERT INTO sale_items ---- */
    if (/INSERT INTO sale_items \(/.test(s)) {
      /* VALUES ($1..$8, 'PRODUCT') or ($1..$7, 'MISC') */
      const isProduct = String(s).includes("'PRODUCT'");
      const record = isProduct
        ? {
            id: id("si"),
            sale_id: params[0],
            product_id: params[1],
            product_name: params[2],
            quantity: params[3],
            unit_price: params[4],
            discount: params[5],
            tax: params[6],
            total: params[7],
            item_type: "PRODUCT",
          }
        : {
            id: id("si"),
            sale_id: params[0],
            product_id: params[1],
            product_name: params[2],
            quantity: params[3],
            unit_price: params[4],
            discount: 0,
            tax: params[5],
            total: params[6],
            item_type: "MISC",
          };
      state.saleItems.push(record);
      return { rows: [] };
    }

    /* ---- INSERT INTO payments ---- */
    if (/INSERT INTO payments \(/.test(s)) {
      state.payments.push({ sale_id: params[0], payment_method: params[1], amount: params[2] });
      return { rows: [] };
    }

    /* ---- inventory movement (tracked product sales) ---- */
    if (/INSERT INTO inventory_movements/i.test(s)) {
      state.movements.push(params);
      return { rows: [{ balance: 0 }] };
    }

    /* ---- ROLLBACK / COMMIT / BEGIN ---- */
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) {
      return { rows: [] };
    }

    /* ---- fire-and-forget post-commit probes (loyalty/whatsapp/etc) ---- */
    if (/FROM company_settings WHERE company_id = \$1$/.test(s) || /loyalty_enabled/.test(s)) {
      return { rows: [] };
    }

    /* ---- GET /api/products (till list) ---- */
    /* Mock mirrors Postgres three-valued logic: with the OLD `sku <> 'MISC'
     * shape a NULL sku row was silently dropped (NULL <> 'MISC' -> NULL);
     * with the NULL-safe `sku IS DISTINCT FROM 'MISC'` shape it is kept. */
    if (/FROM products p LEFT JOIN categories c ON c\.id = p\.category_id/.test(s)) {
      const active = /p\.active = true/.test(s);
      const nullSafeMisc = /p\.sku\s+IS\s+DISTINCT\s+FROM\s+'MISC'/.test(s);
      const excludeMiscLegacy = /p\.sku\s*<>\s*'MISC'/.test(s);
      const list = state.products.filter((p) => {
        if (p.company_id !== params[0]) return false;
        if (active && !p.active) return false;
        if (nullSafeMisc) return p.sku !== "MISC";
        if (excludeMiscLegacy) return p.sku != null && p.sku !== "MISC";
        return true;
      });
      return { rows: list };
    }

    /* ---- POST /api/products/misc-line (find-or-create via ON CONFLICT) ---- */
    if (/INSERT INTO products \(/.test(s) && /ON CONFLICT \(company_id\) WHERE sku = 'MISC'/.test(s)) {
      if (!state.miscId) {
        state.miscId = id("p-misc");
        state.products.push({
          id: state.miscId,
          company_id: COMPANY_A,
          name: "Misc Item",
          sku: "MISC",
          barcode: null,
          price: 0,
          vat_rate: 20,
          vat_applicable: false,
          age_restricted: false,
          track_stock: false,
          stock_quantity: 0,
          active: false,
        });
      }
      return { rows: [{ id: state.miscId }] };
    }

    /* ---- till current-session (for reference) ---- */
    if (/GROUP BY ts\.id, t\.name, u\.username, c\.id, s\.id/.test(s)) {
      return { rows: [] };
    }

    /* ---- cash movements: session ownership check ---- */
    if (/SELECT id FROM till_sessions WHERE id=\$1 AND company_id=\$2 AND store_id=\$3 AND status='open'/.test(s)) {
      const session = state.tillSessions.find(
        (t) => t.id === params[0] && t.company_id === params[1] && t.store_id === params[2]
      );
      return { rows: session ? [session] : [] };
    }

    /* ---- cash movements: insert ---- */
    if (/INSERT INTO cash_movements/.test(s)) {
      const movement = {
        id: id("cm"),
        till_session_id: params[0],
        user_id: params[1],
        type: params[2],
        amount: params[3],
        reason: params[4],
        created_at: new Date().toISOString(),
      };
      state.cashMovements.push(movement);
      return { rows: [movement] };
    }

    /* ---- cash movements: history ---- */
    if (/FROM cash_movements cm LEFT JOIN users u/.test(s)) {
      return { rows: state.cashMovements.filter((m) => m.till_session_id === params[0]) };
    }

    return { rows: [] };
  };

  const db = async (sql, params = []) => rows(sql, params);
  const client = {
    async query(sql, params = []) {
      if (/^BEGIN$/.test(String(sql).trim())) state.tx = true;
      return rows(sql, params);
    },
    release() {},
  };

  return { state, db, client, id };
}

/* --------------------------------------------------------- app builder */

function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE_1, userId = USER_1 } = {}) {
  const salesMod = import("../routes/sales.js");
  const productsMod = import("../routes/products.js");
  const app = express();
  app.use(express.json());
  let salesRouter = null;
  let productsRouter = null;
  app.use("/api", (req, res, next) => {
    req.user = { id: userId, companyId, storeId, roleId: "role-1", username: "till" };
    if (salesRouter && req.path.startsWith("/sales")) return salesRouter(req, res, next);
    if (productsRouter && req.path.startsWith("/products")) return productsRouter(req, res, next);
    next();
  });
  return (async () => {
    const [sMod, pMod] = await Promise.all([salesMod, productsMod]);
    salesRouter = sMod.default({
      authenticate: (_req, _res, next) => next(),
      authorize: () => (_req, _res, next) => next(),
      db: ctx.db,
      pool: { async connect() { return ctx.client; } },
      createInventoryMovement: async (client, opts) => {
        ctx.state.movements.push(opts);
        const product = ctx.state.products.find((p) => p.id === opts.productId);
        if (product) {
          product.stock_quantity = Number(product.stock_quantity) + Number(opts.quantityChange);
          return { balance: Number(product.stock_quantity) };
        }
        return { balance: 0 };
      },
      associateCustomerWithStore: async () => {},
      writeAudit: async () => {},
    });
    productsRouter = pMod.default({
      authenticate: (_req, _res, next) => next(),
      authorize: () => (_req, _res, next) => next(),
      db: ctx.db,
      pool: { async connect() { return { query: ctx.db, release() {} }; } },
      writeAudit: async () => {},
    });
    return app;
  })();
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const req = async (port, method, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* ------------------------------------------------------ backend tests */

describe("Misc Item sale lines (POST /api/sales miscLines)", () => {
  test("misc line becomes a REAL item_type='MISC' sale row with correct money maths", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Emergency Item", price: 7.5, quantity: 1, vatRate: 0.2 }],
        subtotal: 7.5,
        tax: 1.5,
        discount: 0,
        total: 9,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 201);

      const sale = ctx.state.sales[0];
      assert.ok(sale, "sale recorded");
      const miscRow = ctx.state.saleItems.find((i) => i.item_type === "MISC");
      assert.ok(miscRow, "misc row exists");
      assert.equal(miscRow.product_name, "Emergency Item");
      assert.equal(Number(miscRow.unit_price), 7.5);
      assert.equal(Number(miscRow.quantity), 1);
      assert.equal(Number(miscRow.tax), 1.5); // 7.50 × 0.20
      assert.equal(Number(miscRow.total), 9);
      assert.ok(miscRow.product_id, "references the MISC placeholder product");
    } finally {
      server.close();
    }
  });

  test("misc sale does NOT create an inventory movement (no stock change)", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Emergency Item", price: 7.5, quantity: 1, vatRate: 0.2 }],
        subtotal: 7.5,
        tax: 1.5,
        discount: 0,
        total: 9,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 201);
      assert.equal(ctx.state.movements.length, 0, "no stock movements for misc lines");
    } finally {
      server.close();
    }
  });

  test("mixed basket: product line decrements stock, misc line does not", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [{ productId: "p-cola", quantity: 2, unitPrice: 1.5, tax: 0.6, discount: 0, total: 3.6 }],
        miscLines: [{ description: "Emergency Item", price: 7.5, quantity: 1, vatRate: 0.2 }],
        subtotal: 9,
        tax: 2.1,
        discount: 0,
        total: 11.1,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 201);
      const productRows = ctx.state.saleItems.filter((i) => i.item_type === "PRODUCT");
      const miscRows = ctx.state.saleItems.filter((i) => i.item_type === "MISC");
      assert.equal(productRows.length, 1);
      assert.equal(miscRows.length, 1);
      const cola = ctx.state.products.find((p) => p.id === "p-cola");
      assert.equal(Number(cola.stock_quantity), 8, "stock decremented for the real product only");
    } finally {
      server.close();
    }
  });

  test("zero price rejected", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Free", price: 0, quantity: 1, vatRate: 0.2 }],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 400);
      assert.match(r.body.message, /greater than zero/i);
      assert.equal(ctx.state.sales.length, 0, "no sale recorded");
    } finally {
      server.close();
    }
  });

  test("negative price rejected", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Neg", price: -3, quantity: 1, vatRate: 0.2 }],
        subtotal: -3,
        tax: 0,
        discount: 0,
        total: -3,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 400);
      assert.equal(ctx.state.sales.length, 0);
    } finally {
      server.close();
    }
  });

  test("non-numeric price rejected", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Bad", price: "abc", quantity: 1, vatRate: 0.2 }],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 400);
      assert.equal(ctx.state.sales.length, 0);
    } finally {
      server.close();
    }
  });

  test("zero quantity rejected", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Zero qty", price: 5, quantity: 0, vatRate: 0.2 }],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 400);
      assert.match(r.body.message, /quantity/i);
      assert.equal(ctx.state.sales.length, 0);
    } finally {
      server.close();
    }
  });

  test("missing description rejected", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "   ", price: 5, quantity: 1, vatRate: 0.2 }],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 400);
      assert.match(r.body.message, /description/i);
      assert.equal(ctx.state.sales.length, 0);
    } finally {
      server.close();
    }
  });

  test("out-of-range VAT rate rejected", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Bad VAT", price: 5, quantity: 1, vatRate: 1.5 }],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 400);
      assert.match(r.body.message, /VAT rate/i);
      assert.equal(ctx.state.sales.length, 0);
    } finally {
      server.close();
    }
  });

  test("percent-style VAT rate (20 not 0.2) is rejected — fraction convention enforced", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Percent-style", price: 5, quantity: 1, vatRate: 20 }],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 400);
      assert.equal(ctx.state.sales.length, 0);
    } finally {
      server.close();
    }
  });

  test("misc VAT tax = 0 when the till's VAT master switch is off", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Emergency Item", price: 10, quantity: 1, vatRate: 0.2 }],
        subtotal: 10,
        tax: 0,
        discount: 0,
        total: 10,
        paymentMethod: "cash",
        vatEnabled: false,
      });
      assert.equal(r.status, 201);
      const miscRow = ctx.state.saleItems.find((i) => i.item_type === "MISC");
      assert.equal(Number(miscRow.tax), 0);
      assert.equal(Number(miscRow.total), 10);
    } finally {
      server.close();
    }
  });

  test("payment row records the misc sale; receipt number issued", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [],
        miscLines: [{ description: "Emergency Item", price: 7.5, quantity: 1, vatRate: 0.2 }],
        subtotal: 7.5,
        tax: 1.5,
        discount: 0,
        total: 9,
        paymentMethod: "cash",
        vatEnabled: true,
      });
      assert.equal(r.status, 201);
      assert.equal(ctx.state.payments.length, 1);
      assert.equal(ctx.state.payments[0].payment_method, "cash");
      assert.equal(Number(ctx.state.payments[0].amount), 9);
      assert.match(r.body.sale.receipt_number, /^T1-\d{8}-\d{4}$/);
    } finally {
      server.close();
    }
  });

  test("no miscLines key → behaviour identical to before (regression)", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const r = await req(port, "POST", "/api/sales", {
        items: [{ productId: "p-cola", quantity: 1, unitPrice: 1.5, tax: 0.3, discount: 0, total: 1.8 }],
        subtotal: 1.5,
        tax: 0.3,
        discount: 0,
        total: 1.8,
        paymentMethod: "cash",
      });
      assert.equal(r.status, 201);
      assert.equal(ctx.state.saleItems.length, 1);
      assert.equal(ctx.state.saleItems[0].item_type, "PRODUCT");
    } finally {
      server.close();
    }
  });
});

describe("MISC placeholder product (POST /api/products/misc-line)", () => {
  test("find-or-create returns an id; till list never shows the placeholder", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const create = await req(port, "POST", "/api/products/misc-line", {});
      assert.equal(create.status, 201);
      assert.ok(create.body.data.productId);

      // Pre-seed the placeholder into the fake catalogue to prove exclusion.
      ctx.state.products.push({
        id: create.body.data.productId,
        company_id: COMPANY_A,
        name: "Misc Item",
        sku: "MISC",
        track_stock: false,
        stock_quantity: 0,
        active: false,
      });

      const list = await req(port, "GET", "/api/products");
      assert.equal(list.status, 200);
      assert.equal(list.body.data.some((p) => p.sku === "MISC"), false, "MISC placeholder hidden from till grid");
    } finally {
      server.close();
    }
  });
});

describe("Petty cash backend contract (routes/till.js)", () => {
  const TILL_SRC = fs.readFileSync(new URL("../routes/till.js", import.meta.url), "utf8");

  test("cash-movement endpoint records cash_out with amount, user and reason", () => {
    assert.ok(TILL_SRC.includes("/till/sessions/:id/cash-movements"), "movement endpoint exists");
    assert.ok(/INSERT INTO cash_movements \(till_session_id, user_id, type, amount, reason(?:, store_id, terminal_id)?\)/.test(TILL_SRC), "insert captures session, user, type, amount, reason");
    assert.ok(/type === "cash_in" \? "cash\.adjustment" : "cash\.payout"/.test(TILL_SRC), "cash_out requires the cash.payout permission");
    assert.ok(/value <= 0/.test(TILL_SRC), "zero/negative amounts rejected");
  });

  test("expected cash at close subtracts cash_out movements (petty cash reduces it)", () => {
    assert.match(TILL_SRC, /SELECT COALESCE\(SUM\(amount\),0\) AS total FROM cash_movements WHERE till_session_id=\$1 AND type='cash_out'/);
    assert.match(TILL_SRC, /opening \+ inTotal - outTotal \+ salesTotal/);
  });
});

/* ------------------------------------------------------ frontend contracts */

const POS_SRC = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");
const MODALS_SRC = fs.readFileSync(new URL("../src/pages/pos/TillActionsModals.jsx", import.meta.url), "utf8");
const CART_SRC = fs.readFileSync(new URL("../src/pages/pos/CartPanel.jsx", import.meta.url), "utf8");

describe("Till action bar", () => {
  test("Misc Item, Petty Cash and Print buttons exist beside the checkout actions", () => {
    assert.ok(POS_SRC.includes('data-testid="misc-item-button"'), "Misc Item button");
    assert.ok(POS_SRC.includes('data-testid="petty-cash-button"'), "Petty Cash button");
    assert.ok(POS_SRC.includes('data-testid="print-button"'), "Print button");
    assert.ok(POS_SRC.indexOf("Misc Item") < POS_SRC.indexOf("<AdminNavDock"), "action bar sits above the dock");
  });

  test("Print is disabled until a sale completes; enabled by both online and offline completions", () => {
    assert.match(POS_SRC, /disabled=\{!lastSale\}/);
    assert.match(POS_SRC, /id: data\.sale\.id/);
    assert.match(POS_SRC, /receiptNumber: queued\.entry\?\.provisionalReceipt/);
  });
});

describe("Misc Item modal contracts", () => {
  test("validates description, price (>0, 2dp) and quantity (>0) before adding", () => {
    assert.match(MODALS_SRC, /Description is required/);
    assert.match(MODALS_SRC, /Price must be a number greater than zero/);
    assert.match(MODALS_SRC, /Price can have at most 2 decimal places/);
    assert.match(MODALS_SRC, /Quantity must be a whole number greater than zero/);
  });

  test("uses the existing VAT configuration — no invented rates; VAT off disables the selector", () => {
    assert.match(MODALS_SRC, /disabled=\{!vatEnabled\}/);
    assert.match(MODALS_SRC, /vatRate: vatEnabled \? vatOption : 0/);
    assert.match(MODALS_SRC, /Standard 20%/);
    assert.match(MODALS_SRC, /Reduced 5%/);
  });

  test("cart renders misc lines with the MISC tag and one remove control; checkout allowed with misc-only basket", () => {
    assert.match(CART_SRC, /data-testid="misc-cart-line"/);
    assert.match(CART_SRC, /onRemoveMiscLine\(index\)/);
    assert.match(CART_SRC, /basket\.length === 0 && miscLines\.length === 0/);
  });

  test("misc lines ride the normal sale payload and clear with the basket; held sales keep them", () => {
    assert.match(POS_SRC, /miscLines: miscLines\.map\(\(line\) => \(\{/);
    assert.match(POS_SRC, /setMiscLines\(\[\]\)/);
    assert.match(POS_SRC, /body: JSON\.stringify\(\{\s*\n\s*items: basket,\s*\n\s*miscLines,/);
  });
});

describe("Petty cash modal contracts", () => {
  test("records through the EXISTING cash-movement API as cash_out; no new cash system", () => {
    assert.match(MODALS_SRC, /\/api\/till\/sessions\/\$\{session\.id\}\/cash-movements/);
    assert.match(MODALS_SRC, /type: "cash_out"/);
    assert.ok(!/INSERT INTO cash_movements/.test(MODALS_SRC), "frontend never writes cash rows directly");
  });

  test("requires a positive amount and a reason; uses existing Pay In/Out terminology in till modal", () => {
    assert.match(MODALS_SRC, /Amount must be a number greater than zero/);
    assert.match(MODALS_SRC, /Please enter a reason/);
    const TILL_MODAL = fs.readFileSync(new URL("../src/pages/pos/TillSessionModal.jsx", import.meta.url), "utf8");
    /* Existing convention: the till modal's cash movement buttons are labelled
       In / Out (pay in / pay out); petty cash joins it as a cash_out entry. */
    assert.match(TILL_MODAL, /addMovement\("cash_in"\)/);
    assert.match(TILL_MODAL, /addMovement\("cash_out"\)/);
    assert.match(TILL_MODAL, /Recent cash movements/);
  });

  test("no stock or product side effects from petty cash modal", () => {
    assert.ok(!/\/api\/sales/.test(MODALS_SRC.split("PETTY CASH")[1].split("PRINT")[0]), "petty cash section never calls the sales API");
    assert.ok(!/inventory/i.test(MODALS_SRC.split("PETTY CASH")[1].split("PRINT")[0]));
  });
});

describe("Print modal contracts", () => {
  test("reprints from the existing sale-detail endpoint; browser printing; no duplicate sale", () => {
    assert.match(MODALS_SRC, /\/api\/sales\/\$\{lastSale\.id\}/);
    assert.match(MODALS_SRC, /window\.print\(\)/);
    assert.ok(!/apiRequest\(\s*"\/api\/sales",\s*\{\s*method: "POST"/.test(MODALS_SRC), "print never creates a sale");
  });

  test("receipt shows items, VAT, discount, total, payment method, receipt number", () => {
    assert.match(MODALS_SRC, /product_name/);
    assert.match(MODALS_SRC, /VAT/);
    assert.match(MODALS_SRC, /Discount/);
    assert.match(MODALS_SRC, /TOTAL/);
    assert.match(MODALS_SRC, /payment_method/);
    assert.match(MODALS_SRC, /receipt_number/);
  });

  test("offline sale reprint shows the provisional receipt with pending-sync note", () => {
    assert.match(MODALS_SRC, /offline copy — pending sync/);
  });
});
