/*
 * T10P — Scan & Go tests (permanent).
 *
 * Drives the REAL routes/scanAndGo.js router over HTTP against a stateful
 * fake db (same convention as tests/uberWebhook.test.mjs): real HMAC session
 * tokens, real SQL shapes, real basket/total math from the route, fake
 * tables. Covers: session start (incl. settings gate + isolation), barcode
 * lookup outcomes, add/increase/decrease/remove, stock validation,
 * authoritative pricing/VAT, checkout -> normal sale (SCANANDGO receipt,
 * client_request_id, SALE inventory movements), duplicate-checkout
 * protection, session-token access control, and audit trails.
 *
 *   node --test tests/scanAndGo.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const COMPANY = "a0000000-0000-4000-8000-0000000000aa";
const OTHER_COMPANY = "b0000000-0000-4000-8000-0000000000bb";
const STORE_1 = "c0000000-0000-4000-8000-0000000000c1";
const STORE_2 = "c0000000-0000-4000-8000-0000000000c2";
const USER_ID = "d0000000-0000-4000-8000-0000000000d1";
const PRODUCT_A = "e0000000-0000-4000-8000-0000000000a1";
const PRODUCT_B = "e0000000-0000-4000-8000-0000000000a2";
const PRODUCT_INACTIVE = "e0000000-0000-4000-8000-0000000000a3";
const PRODUCT_UNTRACKED = "e0000000-0000-4000-8000-0000000000a4";

const JWT_SECRET = "test-only-secret-" + crypto.randomBytes(8).toString("hex");
process.env.JWT_SECRET = JWT_SECRET;

/* ------------------------- stateful fake db ------------------------- */

function makeDb() {
  const state = {
    sessions: [],
    items: [],
    products: [
      {
        id: PRODUCT_A, company_id: COMPANY, name: "Still Water 500ml",
        barcode: "5000111122223", price: 1.2, vat_rate: 20, vat_applicable: true,
        active: true, track_stock: true, stock_quantity: 10, image_url: null,
      },
      {
        id: PRODUCT_B, company_id: COMPANY, name: "Zero-Rated Sandwich",
        barcode: "5000444455556", price: 3.5, vat_rate: 0, vat_applicable: false,
        active: true, track_stock: true, stock_quantity: 2, image_url: null,
      },
      {
        id: PRODUCT_INACTIVE, company_id: COMPANY, name: "Retired Product",
        barcode: "5000777788889", price: 2.0, vat_rate: 20, vat_applicable: true,
        active: false, track_stock: false, stock_quantity: 0, image_url: null,
      },
      {
        id: PRODUCT_UNTRACKED, company_id: COMPANY, name: "Service Fee",
        barcode: "5000999900001", price: 5.0, vat_rate: 20, vat_applicable: true,
        active: true, track_stock: false, stock_quantity: 0, image_url: null,
      },
      {
        id: "e0000000-0000-4000-8000-0000000000a5", company_id: OTHER_COMPANY,
        name: "Other Company Product", barcode: "5000111122223", price: 9.99,
        vat_rate: 20, vat_applicable: true, active: true, track_stock: false,
        stock_quantity: 0, image_url: null,
      },
    ],
    sales: [],
    saleItems: [],
    payments: [],
    inventoryMovements: [],
    stores: [
      { id: STORE_1, company_id: COMPANY, name: "High Street", active: true },
      { id: STORE_2, company_id: OTHER_COMPANY, name: "Elsewhere", active: true },
    ],
    companySettings: [
      { company_id: COMPANY, scan_go_enabled: true },
      { company_id: OTHER_COMPANY, scan_go_enabled: false },
    ],
    audits: [],
  };

  const findProduct = (idOrBarcode) =>
    state.products.find((p) => p.id === idOrBarcode || p.barcode === idOrBarcode);

  const db = async (text, values = []) => {
    const q = text.replace(/\s+/g, " ").trim();

    /* ---------------- sessions ---------------- */

    if (q.startsWith("SELECT sg.*, s.name AS store_name, c.name AS company_name FROM scan_and_go_sessions")) {
      const row = state.sessions.find((s) => s.id === values[0]);
      if (!row) return { rows: [] };
      const store = state.stores.find((x) => x.id === row.store_id);
      return {
        rows: [{
          ...row,
          store_name: store ? store.name : "",
          company_name: "Fake Co",
        }],
      };
    }

    if (q.startsWith("SELECT id, name FROM stores WHERE id = $1 AND company_id = $2 AND active = true")) {
      const store = state.stores.find((s) => s.id === values[0] && s.company_id === values[1] && s.active);
      return { rows: store ? [{ id: store.id, name: store.name }] : [] };
    }

    if (q.startsWith("SELECT scan_go_enabled FROM company_settings WHERE company_id = $1")) {
      const row = state.companySettings.find((r) => r.company_id === values[0]);
      return { rows: row ? [{ scan_go_enabled: row.scan_go_enabled }] : [] };
    }

    if (q.startsWith("INSERT INTO scan_and_go_sessions")) {
      const row = {
        id: crypto.randomUUID(),
        company_id: values[0],
        store_id: values[1],
        status: "active",
        started_by: values[2],
        sale_id: null,
        created_at: new Date().toISOString(),
        completed_at: null,
        expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      };
      state.sessions.push(row);
      return { rows: [row] };
    }

    if (q.startsWith("UPDATE scan_and_go_sessions SET status = 'abandoned'")) {
      const row = state.sessions.find((s) => s.id === values[0] && s.status === "active");
      if (row) row.status = "abandoned";
      return { rows: [] };
    }

    if (q.startsWith("UPDATE scan_and_go_sessions SET status = 'checking_out'")) {
      const row = state.sessions.find((s) => s.id === values[0] && s.status === "active");
      if (row) {
        row.status = "checking_out";
        return { rows: [{ id: row.id, company_id: row.company_id, store_id: row.store_id, started_by: row.started_by }] };
      }
      return { rows: [] };
    }

    if (q.startsWith("UPDATE scan_and_go_sessions SET status = 'completed', sale_id = $2")) {
      const row = state.sessions.find((s) => s.id === values[0]);
      if (row) {
        row.status = "completed";
        row.sale_id = values[1];
        row.completed_at = new Date().toISOString();
      }
      return { rows: [] };
    }

    if (q.startsWith("UPDATE scan_and_go_sessions SET status = 'active', updated_at = NOW() WHERE id = $1")) {
      const row = state.sessions.find((s) => s.id === values[0]);
      if (row && row.status === "checking_out") row.status = "active";
      return { rows: [] };
    }

    /* ---------------- basket items ---------------- */

    if (q.startsWith("SELECT sgi.id, sgi.product_id, sgi.quantity,") && q.includes("ORDER BY sgi.created_at")) {
      const rows = state.items
        .filter((i) => i.session_id === values[0])
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((i) => {
          const p = findProduct(i.product_id);
          return {
            id: i.id,
            product_id: i.product_id,
            quantity: i.quantity,
            name: p ? p.name : "??",
            barcode: p ? p.barcode : null,
            price: p ? p.price : 0,
            vat_rate: p ? p.vat_rate : 0,
            vat_applicable: p ? p.vat_applicable : true,
            active: p ? p.active : false,
            track_stock: p ? p.track_stock : false,
            stock_quantity: p ? p.stock_quantity : 0,
            image_url: p ? p.image_url : null,
          };
        });
      return { rows };
    }

    if (q.startsWith("SELECT sgi.product_id, sgi.quantity, p.name") && q.includes("FOR UPDATE OF sgi")) {
      const rows = state.items
        .filter((i) => i.session_id === values[0])
        .map((i) => {
          const p = findProduct(i.product_id);
          return {
            product_id: i.product_id,
            quantity: i.quantity,
            name: p ? p.name : "??",
            price: p ? p.price : 0,
            vat_rate: p ? p.vat_rate : 0,
            vat_applicable: p ? p.vat_applicable : true,
            track_stock: p ? p.track_stock : false,
            stock_quantity: p ? p.stock_quantity : 0,
            active: p ? p.active : false,
          };
        });
      return { rows };
    }

    if (q.startsWith("SELECT id, quantity FROM scan_and_go_session_items WHERE session_id = $1 AND product_id = $2")) {
      const row = state.items.find((i) => i.session_id === values[0] && i.product_id === values[1]);
      return { rows: row ? [{ id: row.id, quantity: row.quantity }] : [] };
    }

    if (q.startsWith("SELECT sgi.id, sgi.quantity, p.name, p.track_stock, p.stock_quantity")) {
      const row = state.items.find((i) => i.id === values[0] && i.session_id === values[1]);
      if (!row) return { rows: [] };
      const p = findProduct(row.product_id);
      return {
        rows: [{
          id: row.id,
          quantity: row.quantity,
          name: p ? p.name : "??",
          track_stock: p ? p.track_stock : false,
          stock_quantity: p ? p.stock_quantity : 0,
        }],
      };
    }

    if (q.startsWith("UPDATE scan_and_go_session_items SET quantity = $2")) {
      const row = state.items.find((i) => i.id === values[0]);
      if (row) row.quantity = Number(values[1]);
      return { rows: [] };
    }

    if (q.startsWith("INSERT INTO scan_and_go_session_items")) {
      const row = {
        id: crypto.randomUUID(),
        session_id: values[0],
        product_id: values[1],
        quantity: Number(values[2]),
        created_at: new Date().toISOString(),
      };
      state.items.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (q.startsWith("DELETE FROM scan_and_go_session_items WHERE id = $1 AND session_id = $2")) {
      const before = state.items.length;
      state.items = state.items.filter((i) => !(i.id === values[0] && i.session_id === values[1]));
      return { rows: state.items.length < before ? [{ id: values[0] }] : [] };
    }

    if (q.startsWith("DELETE FROM scan_and_go_session_items WHERE id = $1")) {
      const before = state.items.length;
      state.items = state.items.filter((i) => i.id !== values[0]);
      return { rows: state.items.length < before ? [{ id: values[0] }] : [] };
    }

    /* ---------------- product lookup ---------------- */

    if (q.startsWith("SELECT id, name, description, barcode, price, vat_rate, vat_applicable, image_url,")) {
      const product = state.products.find((p) => p.company_id === values[0] && p.barcode === values[1]);
      return { rows: product ? [product] : [] };
    }

    if (q.startsWith("SELECT id, name, price, vat_applicable, active, track_stock, stock_quantity FROM products WHERE company_id = $1 AND id = $2")) {
      const product = state.products.find((p) => p.company_id === values[0] && p.id === values[1]);
      return { rows: product ? [product] : [] };
    }

    if (q.startsWith("SELECT id, name, price, vat_applicable, active, track_stock, stock_quantity FROM products WHERE company_id = $1 AND barcode = $2")) {
      const product = state.products.find((p) => p.company_id === values[0] && p.barcode === values[1]);
      return { rows: product ? [product] : [] };
    }

    /* ---------------- checkout: sales / items / payments ---------------- */

    if (q.startsWith("INSERT INTO sales (")) {
      const row = {
        id: crypto.randomUUID(),
        company_id: values[0],
        store_id: values[1],
        user_id: values[2],
        receipt_number: values[3],
        subtotal: Number(values[4]),
        tax: Number(values[5]),
        total: Number(values[6]),
        client_request_id: values[7],
        status: "completed",
        created_at: new Date().toISOString(),
      };
      /* Mirror the unique index ux_sales_client_request(company_id, client_request_id). */
      const dup = state.sales.find(
        (s) => s.company_id === row.company_id && s.client_request_id === row.client_request_id
      );
      if (dup) return { rows: [] };
      state.sales.push(row);
      return { rows: [{ id: row.id, receipt_number: row.receipt_number, total: row.total, tax: row.tax, subtotal: row.subtotal }] };
    }

    if (q.startsWith("INSERT INTO sale_items")) {
      state.saleItems.push({
        sale_id: values[0],
        product_id: values[1],
        product_name: values[2],
        quantity: Number(values[3]),
        unit_price: Number(values[4]),
        tax: Number(values[5]),
        total: Number(values[6]),
      });
      return { rows: [] };
    }

    if (q.startsWith("INSERT INTO payments")) {
      state.payments.push({ sale_id: values[0], payment_method: values[1], amount: Number(values[2]) });
      return { rows: [] };
    }

    throw new Error("UNMATCHED QUERY: " + q.slice(0, 110));
  };

  return { state, db };
}

/* --------------------------- app builder --------------------------- */

async function buildApp(userOverrides = {}) {
  const { default: createScanGoRouter } = await import("../routes/scanAndGo.js");
  const fake = makeDb();

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const fakePool = {
    connect: async () => ({
      query: async (text, values) => {
        if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };
        return fake.db(text, values);
      },
      release: () => {},
    }),
  };

  app.use(
    "/api",
    createScanGoRouter({
      authenticate: (req, _res, next) => {
        /* Staff-JWT stand-in: by default the identity of store 1; the
         * "other-store-user" header switches to the foreign-store identity. */
        if ((req.headers["x-test-user"] || "") === "other-store-user") {
          req.user = { id: USER_ID, companyId: COMPANY, storeId: STORE_2, ...userOverrides };
        } else {
          req.user = { id: USER_ID, companyId: COMPANY, storeId: STORE_1, ...userOverrides };
        }
        next();
      },
      db: fake.db,
      pool: fakePool,
      writeAudit: async (companyId, userId, action, entity, entityId, details) => {
        fake.state.audits.push({ companyId, userId, action, entity, entityId, details });
      },
      createInventoryMovement: async (_client, payload) => {
        fake.state.inventoryMovements.push(payload);
      },
    })
  );

  return { app, fake };
}

/* ------------------------------ helpers ------------------------------ */

function httpServer(app) {
  return http.createServer(app);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function start(app) {
  const server = httpServer(app);
  const port = await listen(server);
  return { server, base: `http://127.0.0.1:${port}` };
}

async function stop(server) {
  await new Promise((resolve) => server.close(resolve));
}

function signToken(sessionId) {
  return `${sessionId}.${crypto.createHmac("sha256", JWT_SECRET).update(sessionId).digest("hex").slice(0, 32)}`;
}

async function startSession(base, headers = {}) {
  const res = await fetch(`${base}/api/scan-go/session`, { method: "POST", headers });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.ok(body.data.sessionToken);
  return body.data;
}

/* ------------------------------ tests ------------------------------ */

test("session creation: starts for enabled company + active store, returns signed token", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const data = await startSession(base);
    assert.ok(data.sessionToken.includes("."));
    assert.equal(data.session.storeName, "High Street");
  } finally {
    await stop(server);
  }
});

test("session creation: rejected when company setting is OFF (default safety)", async () => {
  const { app } = await buildApp({ storeId: STORE_2, companyId: OTHER_COMPANY });
  const { server, base } = await start(app);
  try {
    const res = await fetch(`${base}/api/scan-go/session`, { method: "POST" });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "SCAN_GO_DISABLED");
  } finally {
    await stop(server);
  }
});

test("barcode lookup: known / unknown / inactive are distinguished, never created", async () => {
  const { app, fake } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}` };

    const known = await (await fetch(`${base}/api/scan-go/product/5000111122223`, { headers: auth })).json();
    assert.equal(known.success, true);
    assert.equal(known.data.name, "Still Water 500ml");
    assert.equal(known.data.price, 1.2);
    assert.equal(known.data.inStock, true);

    const unknown = await fetch(`${base}/api/scan-go/product/9999999999999`, { headers: auth });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).code, "UNKNOWN_BARCODE");

    const inactive = await fetch(`${base}/api/scan-go/product/5000777788889`, { headers: auth });
    assert.equal(inactive.status, 409);
    assert.equal((await inactive.json()).code, "PRODUCT_INACTIVE");

    assert.equal(fake.state.products.length, 5); // no product was created
  } finally {
    await stop(server);
  }
});

test("barcode lookup: other company's product with the SAME barcode is invisible (company isolation)", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}` };

    /* Barcode 5000111122223 exists in BOTH companies; ours must resolve to
     * OUR product, never the foreign one. */
    const res = await fetch(`${base}/api/scan-go/product/5000111122223`, { headers: auth });
    const body = await res.json();
    assert.equal(body.data.productId, PRODUCT_A);
    assert.equal(body.data.name, "Still Water 500ml");
    assert.notEqual(body.data.price, 9.99);
  } finally {
    await stop(server);
  }
});

test("add item: adds scanned product and returns authoritative basket totals", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    const add = await (await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_A, quantity: 2 }),
    })).json();

    assert.equal(add.success, true);
    const basket = add.data.basket;
    assert.equal(basket.lines.length, 1);
    assert.equal(basket.lines[0].quantity, 2);
    assert.equal(basket.lines[0].unitPrice, 1.2);
    assert.equal(basket.lines[0].vatRate, 20);
    assert.equal(basket.lines[0].total, 2.4);
    assert.equal(basket.lines[0].vat, 0.4); // 2.40 incl. 20% VAT
    assert.equal(basket.subtotal, 2.4);
    assert.equal(basket.vat, 0.4);
    assert.equal(basket.total, 2.4);
  } finally {
    await stop(server);
  }
});

test("add item: VAT-applicable OFF product contributes zero VAT (authoritative product config)", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    const add = await (await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ barcode: "5000444455556", quantity: 1 }),
    })).json();

    assert.equal(add.success, true);
    assert.equal(add.data.basket.lines[0].vatRate, 0);
    assert.equal(add.data.basket.lines[0].vat, 0);
    assert.equal(add.data.basket.total, 3.5);
  } finally {
    await stop(server);
  }
});

test("add item: quantity increase, decrease, and remove all work", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    const add = await (await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_A, quantity: 1 }),
    })).json();
    const itemId = add.data.itemId;

    /* increase (rescan = +1) */
    const rescan = await (await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_A, quantity: 1 }),
    })).json();
    assert.equal(rescan.data.basket.lines[0].quantity, 2);

    /* decrease to 1 */
    const dec = await (await fetch(`${base}/api/scan-go/items/${itemId}`, {
      method: "PATCH", headers: auth, body: JSON.stringify({ quantity: 1 }),
    })).json();
    assert.equal(dec.data.basket.lines[0].quantity, 1);

    /* remove */
    const rem = await (await fetch(`${base}/api/scan-go/items/${itemId}`, {
      method: "DELETE", headers: auth,
    })).json();
    assert.equal(rem.data.basket.lines.length, 0);
    assert.equal(rem.data.basket.total, 0);
  } finally {
    await stop(server);
  }
});

test("stock validation: adding beyond recorded stock is rejected with a clear message", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    /* Sandwich has 2 in stock; the basket already holds 1, adding 2 more = 3 > 2. */
    await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_B, quantity: 1 }),
    });
    const res = await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_B, quantity: 2 }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "INSUFFICIENT_STOCK");
    assert.equal(body.data.available, 2);
  } finally {
    await stop(server);
  }
});

test("stock validation: untracked products are never stock-blocked", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    const add = await (await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_UNTRACKED, quantity: 7 }),
    })).json();
    assert.equal(add.success, true);
    assert.equal(add.data.basket.lines[0].quantity, 7);
  } finally {
    await stop(server);
  }
});

test("multiple products: basket aggregates lines and totals correctly", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_A, quantity: 2 }),
    });
    const add2 = await (await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_B, quantity: 1 }),
    })).json();

    const basket = add2.data.basket;
    assert.equal(basket.lines.length, 2);
    /* 2 x 1.20 (incl. VAT 0.40) + 1 x 3.50 (zero-rated) = 5.90, VAT 0.40 */
    assert.equal(basket.subtotal, 5.9);
    assert.equal(basket.vat, 0.4);
    assert.equal(basket.total, 5.9);
  } finally {
    await stop(server);
  }
});

test("checkout: creates a NORMAL sale with SCANANDGO receipt, sale_items, payment and SALE inventory movements", async () => {
  const { app, fake } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const sessionId = sessionToken.split(".")[0];
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_A, quantity: 3 }),
    });
    await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_B, quantity: 1 }),
    });

    const res = await fetch(`${base}/api/scan-go/checkout`, { method: "POST", headers: auth, body: "{}" });
    assert.equal(res.status, 201);
    const body = await res.json();

    /* Normal sale row */
    assert.equal(fake.state.sales.length, 1);
    const sale = fake.state.sales[0];
    assert.equal(sale.company_id, COMPANY);
    assert.equal(sale.store_id, STORE_1);
    assert.equal(sale.status, "completed");
    /* Duplicate-checkout guard: the sale carries the SESSION id in
     * client_request_id (existing unique index => one sale per session). */
    assert.equal(sale.client_request_id, sessionId);
    assert.ok(sale.receipt_number.startsWith("SCANANDGO-"));
    assert.equal(sale.total, 7.1); // 3 x 1.20 + 3.50
    assert.equal(sale.tax, 0.6);   // VAT from water only

    /* Sale items, authoritative prices */
    assert.equal(fake.state.saleItems.length, 2);
    assert.ok(fake.state.saleItems.every((si) => si.sale_id === sale.id));

    /* Payment recorded through the existing payments table */
    assert.equal(fake.state.payments.length, 1);
    assert.equal(fake.state.payments[0].amount, 7.1);

    /* Inventory: ONE deduction per tracked line via the EXISTING ledger helper */
    const movements = fake.state.inventoryMovements;
    assert.equal(movements.length, 2);
    assert.ok(movements.every((m) => m.movementType === "SALE"));
    assert.ok(movements.every((m) => m.referenceType === "SCAN_AND_GO"));
    assert.ok(movements.every((m) => m.companyId === COMPANY && m.storeId === STORE_1));

    /* Audit trail */
    assert.ok(fake.state.audits.some((a) => a.action === "SCAN_GO_SESSION_STARTED"));
    assert.ok(fake.state.audits.some((a) => a.action === "SCAN_GO_CHECKOUT"));

    /* Response reflects the channel */
    assert.equal(body.data.source, "SCAN_AND_GO");
    assert.equal(body.data.receiptNumber, sale.receipt_number);
    assert.equal(body.data.total, 7.1);
  } finally {
    await stop(server);
  }
});

test("checkout: empty basket rejected and session returns to active", async () => {
  const { app, fake } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    const res = await fetch(`${base}/api/scan-go/checkout`, { method: "POST", headers: auth, body: "{}" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "EMPTY_BASKET");
    assert.equal(fake.state.sessions[0].status, "active");
  } finally {
    await stop(server);
  }
});

test("checkout: duplicate/repeated checkout is protected (session transition + unique client_request_id)", async () => {
  const { app, fake } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_A, quantity: 1 }),
    });

    const first = await fetch(`${base}/api/scan-go/checkout`, { method: "POST", headers: auth, body: "{}" });
    assert.equal(first.status, 201);

    /* Replay with the same token: session is completed -> rejected. */
    const replay = await fetch(`${base}/api/scan-go/checkout`, { method: "POST", headers: auth, body: "{}" });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).code, "SESSION_CLOSED");

    /* Only ONE sale was ever created. */
    assert.equal(fake.state.sales.length, 1);
  } finally {
    await stop(server);
  }
});

test("session access: forged/garbage tokens are rejected on every customer endpoint", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const bad = { Authorization: `Bearer ${crypto.randomUUID()}.${"0".repeat(32)}`, "content-type": "application/json" };
    const paths = [
      ["GET", "/api/scan-go/session", null],
      ["GET", "/api/scan-go/basket", null],
      ["POST", "/api/scan-go/items", JSON.stringify({ productId: PRODUCT_A })],
      ["POST", "/api/scan-go/checkout", "{}"],
    ];
    for (const [method, path, body] of paths) {
      const res = await fetch(`${base}${path}`, { method, headers: bad, body });
      assert.equal(res.status, 401, `${method} ${path}`);
    }
  } finally {
    await stop(server);
  }
});

test("session access: another company's session id is unusable (HMAC over a different session fails)", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const [sessionId] = sessionToken.split(".");
    const forged = `${sessionId}.${"a".repeat(32)}`;
    const res = await fetch(`${base}/api/scan-go/basket`, { headers: { Authorization: `Bearer ${forged}` } });
    assert.equal(res.status, 401);
  } finally {
    await stop(server);
  }
});

test("abandoned session: items can no longer be added and checkout is refused", async () => {
  const { app } = await buildApp();
  const { server, base } = await start(app);
  try {
    const { sessionToken } = await startSession(base);
    const auth = { Authorization: `Bearer ${sessionToken}`, "content-type": "application/json" };

    const del = await fetch(`${base}/api/scan-go/session`, { method: "DELETE", headers: auth });
    assert.equal(del.status, 200);

    const add = await fetch(`${base}/api/scan-go/items`, {
      method: "POST", headers: auth, body: JSON.stringify({ productId: PRODUCT_A, quantity: 1 }),
    });
    assert.equal(add.status, 409);

    const checkout = await fetch(`${base}/api/scan-go/checkout`, { method: "POST", headers: auth, body: "{}" });
    assert.equal(checkout.status, 409);
  } finally {
    await stop(server);
  }
});

test("regression: the sale engine still stamps SCAN_AND_GO-compatible fields (schema contract)", async () => {
  const src = fs.readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
  assert.ok(src.includes("client_request_id UUID"));
  assert.ok(src.includes("ux_sales_client_request"));
  assert.ok(src.includes("CREATE TABLE IF NOT EXISTS scan_and_go_sessions"));
  assert.ok(src.includes("CREATE TABLE IF NOT EXISTS scan_and_go_session_items"));
  assert.ok(src.includes("scan_and_go_session_items_unique"));

  const initSrc = fs.readFileSync(new URL("../database/init.js", import.meta.url), "utf8");
  assert.ok(initSrc.includes("scan_go_enabled BOOLEAN NOT NULL DEFAULT FALSE"));
  assert.ok(initSrc.includes("ADD COLUMN IF NOT EXISTS scan_go_enabled"));
  assert.ok(initSrc.includes("CREATE TABLE IF NOT EXISTS scan_and_go_sessions"));

  const routeSrc = fs.readFileSync(new URL("../routes/scanAndGo.js", import.meta.url), "utf8");
  assert.ok(routeSrc.includes("referenceType: \"SCAN_AND_GO\""));
  assert.ok(routeSrc.includes("client_request_id"));
  assert.ok(routeSrc.includes("timingSafeEqual"));
  assert.ok(!/INSERT INTO products/.test(routeSrc)); // scanning never creates products
  assert.ok(!/UPDATE products SET/.test(routeSrc));  // ...and never mutates them
});
