/*
 * T10C — Age Verification Foundation: focused regression suite.
 *
 * Backend: the REAL routes/products.js and routes/sales.js routers over HTTP
 * against stateful fake dbs (products, sale rows, payments, audit logs).
 * Frontend: POS.jsx source contract assertions for the modal gating and
 * basket-driven requirement lifecycle.
 *
 *   node --test tests/ageVerification.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import express from "express";

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const STORE = "c0000000-0000-4000-8000-000000000003";
const USER = "u0000000-0000-4000-8000-000000000009";

/* ------------------------------------------------------------ fake db #1: products */

function makeProductsCtx() {
  const state = { products: new Map(), movements: [] };
  let seq = 0;
  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    if (/SELECT id FROM products WHERE id = \$1 AND company_id = \$2/i.test(s)) {
      const row = state.products.get(params[0]);
      return { rows: row && row.company_id === params[1] ? [{ id: row.id }] : [] };
    }
    if (/^UPDATE products SET/i.test(s)) {
      const row = state.products.get(params[16]); // id is $17
      if (!row || row.company_id !== params[17]) return { rows: [] };
      Object.assign(row, {
        name: params[1],
        price: Number(params[5]) || 0,
        vat_applicable: params[8] === null ? row.vat_applicable : params[8] === true,
        // COALESCE($10, age_restricted): null keeps stored value.
        age_restricted: params[9] === null ? row.age_restricted : params[9] === true,
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
        const row = {
          id: `p-${++seq}`,
          company_id: params[0],
          name: params[2],
          price: Number(params[6]) || 0,
          vat_applicable: params[9] !== false && params[9] !== null,
          // age_restricted is the LAST insert param (index 16) — T10C layout.
          age_restricted: params[16] === true,
          stock_quantity: 0,
          track_stock: params[11] === true,
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
        state.movements.push({ productId: params[1], movementType: params[3], quantityChange: Number(params[4]) });
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
          name: params[1],
          price: Number(params[5]) || 0,
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

/* ------------------------------------------------------------ fake db #2: sales */

function makeSalesCtx() {
  const state = { sales: [], payments: [], auditLogs: [], movements: [], advisory: [] };
  const client = {
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (/^BEGIN$|^COMMIT$|^ROLLBACK$/i.test(s)) return { rowCount: 0 };
      if (/pg_advisory_xact_lock/.test(s)) { state.advisory.push(params[0]); return { rows: [] }; }
      if (/to_char\(timezone\(\$1, NOW\(\)\), 'YYYYMMDD'\)/.test(s)) {
        return { rows: [{ date_key: "20260918" }] };
      }
      if (/MAX\(NULLIF\(split_part\(receipt_number/.test(s)) {
        return { rows: [{ next_number: state.sales.length + 1 }] };
      }
      if (/SELECT id, created_at, total, receipt_number FROM sales WHERE company_id = \$1 AND client_request_id = \$2/.test(s)) {
        const existing = state.sales.find((sale) => sale.company_id === params[0] && sale.client_request_id === params[1]);
        return { rows: existing ? [{ id: existing.id, created_at: existing.created_at, total: existing.total, receipt_number: existing.receipt_number }] : [] };
      }
      if (/FROM products WHERE id = \$1 AND company_id = \$2/.test(s)) {
        // Product lookups (stock + age_restricted check). Tenant-scoped.
        const row = state.products && state.products.get(params[0]);
        return { rows: row && row.company_id === params[1] && row.active !== false ? [{ ...row }] : [] };
      }
      if (/INSERT INTO sales \(/.test(s)) {
        const sale = {
          id: `sale-${state.sales.length + 1}`,
          company_id: params[0],
          store_id: params[1],
          user_id: params[2],
          customer_id: params[3],
          receipt_number: `T01-x-${String(state.sales.length + 1).padStart(4, "0")}`,
          total: Number(params[9]) || 0,
          client_request_id: params[10] ?? null,
          created_at: new Date().toISOString(),
        };
        state.sales.push(sale);
        return { rows: [{ id: sale.id, created_at: sale.created_at, total: sale.total, receipt_number: sale.receipt_number }] };
      }
      if (/INSERT INTO sale_items/.test(s)) { state.saleItems = (state.saleItems || 0) + 1; return { rowCount: 1 }; }
      if (/INSERT INTO payments/.test(s)) { state.payments.push({ saleId: params[0], method: params[1], amount: Number(params[2]) }); return { rowCount: 1 }; }
      if (/INSERT INTO inventory_movements/.test(s)) { state.movements.push(params[3]); return { rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    },
  };
  const db = async (sql, params = []) => {
    const s = String(sql).replace(/\s+/g, " ").trim();
    // Open till-session lookup.
    if (/FROM till_sessions/.test(s)) {
      return { rows: [{ id: "till-1", terminal_id: "term-1", terminal_number: "T01", timezone: "Europe/London" }] };
    }
    // Sale-row verification lookup used by router-internal checks.
    if (/SELECT id FROM users WHERE id = \$1/.test(s)) return { rows: [{ ok: 1 }] };
    return { rows: [], rowCount: 0 };
  };
  const pool = { async connect() { return { ...client, release() {} }; } };
  return { state, db, client, pool };
}

/* -------------------------------------------------------------- app builders */

async function buildProductsApp(ctx) {
  const mod = await import("../routes/products.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId: COMPANY, storeId: STORE, role: "admin" };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement: async () => ({}),
  }));
  return app;
}

async function buildSalesApp(ctx, { writeAudit } = {}) {
  const mod = await import("../routes/sales.js");
  const app = express();
  app.use(express.json());
  app.use("/api", (req, _res, next) => {
    req.user = { id: USER, companyId: COMPANY, storeId: STORE };
    next();
  });
  app.use("/api", mod.default({
    authenticate: (_req, _res, next) => next(),
    authorize: () => (_req, _res, next) => next(),
    db: ctx.db,
    pool: ctx.pool,
    createInventoryMovement: async (client, params) => ({ balance: 0, movement: { movement_type: params.movementType } }),
    associateCustomerWithStore: async () => ({}),
    ...(writeAudit ? { writeAudit } : {}),
  }));
  return app;
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const post = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const put = async (port, path, body) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* ------------------------------------------------------------------ tests */

describe("product age_restricted flag (create/edit)", () => {
  test("new product defaults to age_restricted = false when the field is omitted", async () => {
    const ctx = makeProductsCtx();
    const app = await buildProductsApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status, body } = await post(port, "/api/products", { name: "Ordinary Item", price: 10 });
      assert.equal(status, 201);
      assert.equal(body.data.age_restricted, false, "omitted ageRestricted must default to false");
    } finally { server.close(); }
  });

  test("age-restricted product can be created with ageRestricted = true", async () => {
    const ctx = makeProductsCtx();
    const app = await buildProductsApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status, body } = await post(port, "/api/products", { name: "Knife Set", price: 25, ageRestricted: true });
      assert.equal(status, 201);
      assert.equal(body.data.age_restricted, true);
    } finally { server.close(); }
  });

  test("age restriction can be toggled OFF then ON by edit; unrelated edit keeps it unchanged", async () => {
    const ctx = makeProductsCtx();
    const app = await buildProductsApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await post(port, "/api/products", { name: "Restricted", price: 8, ageRestricted: true });
      const id = created.body.data.id;

      const off = await put(port, `/api/products/${id}`, { name: "Restricted", price: 8, ageRestricted: false });
      assert.equal(off.status, 200);
      assert.equal(off.body.data.age_restricted, false, "explicit toggle OFF must stick");

      const on = await put(port, `/api/products/${id}`, { name: "Restricted", price: 8, ageRestricted: true });
      assert.equal(on.body.data.age_restricted, true, "explicit toggle ON must stick");

      const untouched = await put(port, `/api/products/${id}`, { name: "Restricted v2", price: 9 });
      assert.equal(untouched.body.data.age_restricted, true, "edit without the field must not flip the flag");
    } finally { server.close(); }
  });
});

describe("sale-time age verification enforcement", () => {
  const ordinaryItem = { productId: "p-1", quantity: 1, unitPrice: 10, tax: 0, discount: 0, total: 10 };
  const restrictedItem = { productId: "p-2", quantity: 1, unitPrice: 20, tax: 0, discount: 0, total: 20 };

  function seedSaleWorld(ctx, { withRestricted } = {}) {
    // The sales fake db needs product rows for the restriction check.
    ctx.state.products = new Map([
      ["p-1", { id: "p-1", company_id: COMPANY, name: "Ordinary", active: true, track_stock: false, age_restricted: false }],
      ["p-2", { id: "p-2", company_id: COMPANY, name: "Restricted", active: true, track_stock: false, age_restricted: true }],
    ]);
    return ctx.state.products;
  }

  test("ordinary basket checks out without any verification flag", async () => {
    const ctx = makeSalesCtx();
    seedSaleWorld(ctx, { withRestricted: false });
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status, body } = await post(port, "/api/sales", { items: [ordinaryItem], subtotal: 10, tax: 0, discount: 0, total: 10, paymentMethod: "cash" });
      assert.equal(status, 201, JSON.stringify(body));
      assert.equal(body.success, true);
    } finally { server.close(); }
  });

  test("basket with age-restricted product is rejected without verification (direct API bypass blocked)", async () => {
    const ctx = makeSalesCtx();
    seedSaleWorld(ctx, { withRestricted: true });
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status, body } = await post(port, "/api/sales", { items: [restrictedItem], subtotal: 20, tax: 0, discount: 0, total: 20, paymentMethod: "cash" });
      assert.equal(status, 403);
      assert.match(body.message, /Age verification required/);
      assert.equal(ctx.state.sales.length, 0, "no sale row may be written");
      assert.equal(ctx.state.payments.length, 0, "no payment row may be written");
    } finally { server.close(); }
  });

  test("successful verification allows checkout of restricted products", async () => {
    const ctx = makeSalesCtx();
    seedSaleWorld(ctx, { withRestricted: true });
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status, body } = await post(port, "/api/sales", { items: [restrictedItem], subtotal: 20, tax: 0, discount: 0, total: 20, paymentMethod: "cash", ageVerified: true });
      assert.equal(status, 201, JSON.stringify(body));
      assert.equal(body.sale.receipt_number, "T01-x-0001");
    } finally { server.close(); }
  });

  test("mixed basket requires verification; one flag satisfies every restricted line", async () => {
    const ctx = makeSalesCtx();
    seedSaleWorld(ctx, { withRestricted: true });
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const denied = await post(port, "/api/sales", { items: [ordinaryItem, restrictedItem], subtotal: 30, tax: 0, discount: 0, total: 30, paymentMethod: "cash" });
      assert.equal(denied.status, 403);

      const allowed = await post(port, "/api/sales", { items: [ordinaryItem, restrictedItem], subtotal: 30, tax: 0, discount: 0, total: 30, paymentMethod: "cash", ageVerified: true });
      assert.equal(allowed.status, 201);
    } finally { server.close(); }
  });

  test("verification event is audited; ordinary sales write no age-verification audit", async () => {
    const ctx = makeSalesCtx();
    seedSaleWorld(ctx, { withRestricted: true });
    const audits = [];
    const writeAudit = async (companyId, userId, action, entityType, entityId, details) => {
      audits.push({ companyId, userId, action, entityType, entityId, details });
    };
    const app = await buildSalesApp(ctx, { writeAudit });
    const { server, port } = await listen(app);
    try {
      await post(port, "/api/sales", { items: [restrictedItem], total: 20, paymentMethod: "cash", ageVerified: true });
      assert.equal(audits.length, 1, "exactly one age-verification audit event");
      assert.equal(audits[0].action, "SALE_AGE_VERIFIED");
      assert.equal(audits[0].entityType, "sale");
      assert.equal(audits[0].companyId, COMPANY);
      assert.equal(audits[0].userId, USER);
      assert.equal(audits[0].details.verified, true);
      assert.equal(audits[0].details.storeId, STORE);

      await post(port, "/api/sales", { items: [ordinaryItem], total: 10, paymentMethod: "cash" });
      assert.equal(audits.length, 1, "ordinary sale must not add an age-verification audit");
    } finally { server.close(); }
  });

  test("company isolation: restricted products of another company are simply not found", async () => {
    const ctx = makeSalesCtx();
    ctx.state.products = new Map([
      ["p-other", { id: "p-other", company_id: "b0000000-0000-4000-8000-000000000002", name: "Foreign Restricted", active: true, track_stock: false, age_restricted: true }],
    ]);
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { status } = await post(port, "/api/sales", { items: [{ ...restrictedItem, productId: "p-other" }], total: 20, paymentMethod: "cash", ageVerified: true });
      assert.equal(status, 500, "foreign product is rejected as not found (sale error path)");
      assert.equal(ctx.state.sales.length, 0);
    } finally { server.close(); }
  });

  test("idempotent retry of a verified sale does not re-run the restriction gate into a duplicate", async () => {
    const ctx = makeSalesCtx();
    seedSaleWorld(ctx, { withRestricted: true });
    const app = await buildSalesApp(ctx);
    const { server, port } = await listen(app);
    try {
      const first = await post(port, "/api/sales", { items: [restrictedItem], total: 20, paymentMethod: "cash", ageVerified: true, clientRequestId: "9e0f5b2c-1111-4222-8333-444455556666" });
      assert.equal(first.status, 201);
      const retry = await post(port, "/api/sales", { items: [restrictedItem], total: 20, paymentMethod: "cash", ageVerified: true, clientRequestId: "9e0f5b2c-1111-4222-8333-444455556666" });
      assert.equal(retry.status, 201);
      assert.equal(ctx.state.sales.length, 1, "idempotency must prevent a second sale row");
    } finally { server.close(); }
  });
});

describe("POS frontend contract (T10C gating)", () => {
  const SRC = fs.readFileSync(new URL("../src/pages/pos/POS.jsx", import.meta.url), "utf8");

  test("checkout opens the age modal before payment and payment modal only after verification", () => {
    assert.match(SRC, /basketHasAgeRestricted\s*=\s*basket\.some\(\s*\(item\)\s*=>\s*item\.ageRestricted === true\s*\)/, "basket drives the requirement");
    assert.match(SRC, /basketHasAgeRestricted\s*&&\s*!ageVerifiedThisSale/, "unverified restricted basket must not reach payment");
    assert.match(SRC, /setShowAgeModal\(true\)/, "verification modal is shown");
    assert.match(SRC, /AgeVerificationModal/, "modal component exists");
  });

  test("modal confirm satisfies the sale and cancel keeps the basket unpaid", () => {
    const modal = SRC.slice(SRC.indexOf("function AgeVerificationModal"));
    assert.match(modal, /onConfirm/, "confirm handler present");
    assert.match(modal, /onCancel/, "cancel handler present");
    assert.match(SRC, /setAgeVerifiedThisSale\(\s*true\s*\)/, "confirm marks the sale verified");
    assert.match(SRC, /if \(!basketHasAgeRestricted\)\s*\{?\s*setAgeVerifiedThisSale\(\s*false\s*\)/, "requirement resets when restricted products leave the basket");
  });

  test("sale payload carries the verification outcome for the backend gate", () => {
    assert.match(SRC, /ageVerified:\s*basketHasAgeRestricted\s*\?\s*ageVerifiedThisSale\s*:\s*undefined/, "payload includes the backend-checkable flag");
  });

  test("no ID scanning, facial recognition or personal data capture in v1", () => {
    const modal = SRC.slice(SRC.indexOf("function AgeVerificationModal"));
    assert.doesNotMatch(modal, /passport|licence|license|date of birth|dob|camera|webcam|getUserMedia/i);
  });
});
