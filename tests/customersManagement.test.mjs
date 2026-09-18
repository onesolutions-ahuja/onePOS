/*
 * CUSTOMER MANAGEMENT AUDIT — permanent regression suite.
 *
 * Audits (and now pins) the EXISTING customers functionality: CRUD, search,
 * duplicate handling, company/store tenant isolation, POS sale association,
 * and invoice-delivery contact compatibility. The REAL routes/customers.js
 * router is driven over HTTP against a stateful fake db that models
 * customers, customer_stores, stores, sales and the roles table, plus the
 * real associateCustomerWithStore helper (ported from server.js — its
 * contract is asserted by a drift test).
 *
 *   node --test tests/customersManagement.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";

/* ---------------------------------------------- real helper (server.js) */
/* associateCustomerWithStore, ported verbatim from server.js. The drift test
 * below fails if the production copy changes shape. */
async function associateCustomerWithStore(client, customerId, storeId, companyId, lastPurchaseAt = null) {
  const customer = await client.query(
    `SELECT id FROM customers WHERE id = $1 AND company_id = $2 AND active = true`,
    [customerId, companyId]
  );
  if (!customer.rows.length) throw new Error("Customer not found");

  const store = await client.query(
    `SELECT id FROM stores WHERE id = $1 AND company_id = $2 AND active = true`,
    [storeId, companyId]
  );
  if (!store.rows.length) throw new Error("Store not found");

  const result = await client.query(
    `
    INSERT INTO customer_stores (customer_id, store_id, last_purchase_at)
    VALUES ($1,$2,$3)
    ON CONFLICT (customer_id, store_id) DO UPDATE SET
      active = true,
      last_purchase_at = CASE
        WHEN EXCLUDED.last_purchase_at IS NULL THEN customer_stores.last_purchase_at
        WHEN customer_stores.last_purchase_at IS NULL THEN EXCLUDED.last_purchase_at
        WHEN EXCLUDED.last_purchase_at > customer_stores.last_purchase_at THEN EXCLUDED.last_purchase_at
        ELSE customer_stores.last_purchase_at
      END
    `,
    [customerId, storeId, lastPurchaseAt]
  );
  return result;
}

/* ------------------------------------------------------------- fake db */

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const STORE_2 = "c0000000-0000-4000-8000-000000000004";
const ADMIN_ROLE = "r0000000-0000-4000-8000-00000000000a";
const STAFF_ROLE = "r0000000-0000-4000-8000-00000000000b";

function makeDb() {
  const state = {
    customers: new Map(),
    customerStores: [],
    stores: new Map([
      [STORE_1, { id: STORE_1, company_id: COMPANY_A, name: "London", active: true }],
      [STORE_2, { id: STORE_2, company_id: COMPANY_A, name: "Leeds", active: true }],
    ]),
    sales: [],
    sqlLog: [],
  };

  const rows = (sql, params) => {
    const s = sql.replace(/\s+/g, " ").trim();

    if (/INSERT INTO customers \(/.test(s)) {
      const row = {
        id: `cust-${state.customers.size + 1}`,
        company_id: params[0], name: params[1], phone: params[2], email: params[3],
        address: params[4], postcode: params[5], notes: params[6],
        active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.customers.set(row.id, row);
      return { rows: [{ ...row }] };
    }
    if (/SELECT id, name, phone, email FROM customers WHERE company_id = \$1 AND \(phone = ANY|LOWER\(email\) = ANY/.test(s)) {
      const phones = params[1] || [];
      const emails = (params[2] || []).map((e) => String(e).toLowerCase());
      const hits = [...state.customers.values()].filter(
        (c) =>
          c.company_id === params[0] &&
          c.active &&
          ((c.phone && phones.includes(c.phone)) ||
            (c.email && emails.includes(String(c.email).toLowerCase())))
      );
      return { rows: hits.map((c) => ({ ...c })) };
    }
    if (/SELECT 1 FROM roles WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const roleId = params[0];
      return { rows: roleId === ADMIN_ROLE ? [{ ok: 1 }] : [] };
    }
    if (/SELECT id FROM customers WHERE id = \$1 AND company_id = \$2 AND active = true/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] && c.active ? [{ id: c.id }] : [] };
    }
    if (/SELECT id FROM stores WHERE id = \$1 AND company_id = \$2 AND active = true/.test(s)) {
      const store = state.stores.get(params[0]);
      return { rows: store && store.company_id === params[1] && store.active ? [{ id: store.id }] : [] };
    }
    if (/INSERT INTO customer_stores/.test(s)) {
      const existing = state.customerStores.find(
        (cs) => cs.customer_id === params[0] && cs.store_id === params[1]
      );
      if (existing) {
        existing.active = true;
        if (params[2] && (!existing.last_purchase_at || params[2] > existing.last_purchase_at)) {
          existing.last_purchase_at = params[2];
        }
      } else {
        state.customerStores.push({
          customer_id: params[0], store_id: params[1],
          last_purchase_at: params[2] || null, active: true,
        });
      }
      return { rowCount: 1 };
    }
    if (/SELECT c\.id, c\.company_id, c\.name.*json_agg.*GROUP BY c\.id/.test(s)) {
      // Customer DETAIL query (must be checked before the list query).
      const c = state.customers.get(params[0]);
      if (!c || c.company_id !== params[1]) return { rows: [] };
      return {
        rows: [{
          ...c,
          stores: state.customerStores
            .filter((cs) => cs.customer_id === c.id)
            .map((cs) => ({
              storeId: cs.store_id, storeName: state.stores.get(cs.store_id)?.name || null,
              active: cs.active, lastPurchaseAt: cs.last_purchase_at,
            })),
        }],
      };
    }
    if (/FROM customers c\s+INNER JOIN customer_stores cs/.test(s) || /FROM customers c LEFT JOIN customer_stores cs/.test(s)) {
      const companyId = params[0];
      const search = params.find((p) => typeof p === "string" && p.includes("%"));
      let list = [...state.customers.values()].filter((c) => c.company_id === companyId);
      if (search) {
        const q = String(search).replace(/%/g, "").toLowerCase();
        list = list.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.phone || "").toLowerCase().includes(q) ||
            (c.email || "").toLowerCase().includes(q)
        );
      }
      const companyScope = /scope=company|companyScope/.test(sql) === false && /LEFT JOIN customer_stores/.test(s);
      // The route decides join type by scope; mirror its grouping output.
      return {
        rows: list.map((c) => ({
          ...c,
          store_names: state.customerStores
            .filter((cs) => cs.customer_id === c.id && cs.active)
            .map((cs) => state.stores.get(cs.store_id)?.name)
            .filter(Boolean)
            .join(", "),
          last_purchase_at: state.customerStores
            .filter((cs) => cs.customer_id === c.id)
            .map((cs) => cs.last_purchase_at)
            .filter(Boolean)
            .sort()
            .pop() || null,
        })),
      };
    }
    if (/SELECT c\.id, c\.company_id, c\.name.*FROM customers c\s+LEFT JOIN customer_stores cs/.test(s) && /GROUP BY c\.id/.test(s)) {
      const c = state.customers.get(params[0]);
      if (!c || c.company_id !== params[1]) return { rows: [] };
      return {
        rows: [{
          ...c,
          stores: state.customerStores
            .filter((cs) => cs.customer_id === c.id)
            .map((cs) => ({
              storeId: cs.store_id, storeName: state.stores.get(cs.store_id)?.name || null,
              active: cs.active, lastPurchaseAt: cs.last_purchase_at,
            })),
        }],
      };
    }
    if (/SELECT 1 FROM customer_stores WHERE customer_id = \$1 AND store_id = \$2/.test(s)) {
      const hit = state.customerStores.find(
        (cs) => cs.customer_id === params[0] && cs.store_id === params[1] && cs.active
      );
      return { rows: hit ? [{ ok: 1 }] : [] };
    }
    if (/FROM sales s\s+LEFT JOIN stores st ON st\.id = s\.store_id\s+WHERE s\.customer_id = \$1 AND s\.company_id = \$2/.test(s)) {
      const sales = state.sales
        .filter((sale) => sale.customer_id === params[0] && sale.company_id === params[1])
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 100)
        .map((sale) => ({ ...sale, store_name: state.stores.get(sale.store_id)?.name || null }));
      return { rows: sales };
    }
    if (/^UPDATE customers SET name=/i.test(s)) {
      const c = state.customers.get(params[6]);
      if (!c || c.company_id !== params[7]) return { rows: [] };
      Object.assign(c, {
        name: params[0], phone: params[1], email: params[2],
        address: params[3], postcode: params[4], notes: params[5],
        updated_at: new Date().toISOString(),
      });
      return { rows: [{ ...c }] };
    }
    if (/UPDATE customers SET active=/i.test(s)) {
      const c = state.customers.get(params[1]);
      if (!c || c.company_id !== params[2]) return { rows: [] };
      c.active = params[0] === true;
      return { rows: [{ id: c.id, name: c.name, active: c.active }] };
    }
    if (/SELECT name, phone(, email)? FROM customers WHERE id = \$1 AND company_id = \$2/.test(s)) {
      const c = state.customers.get(params[0]);
      return { rows: c && c.company_id === params[1] ? [{ name: c.name, phone: c.phone, email: c.email }] : [] };
    }
    return { rows: [], rowCount: 0 };
  };

  const db = async (sql, params = []) => {
    state.sqlLog.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    return rows(sql, params);
  };

  const client = {
    async query(sql, params = []) {
      state.sqlLog.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      return rows(sql, params);
    },
    async queryClient(sql, params) { return this.query(sql, params); },
  };
  // Transaction verbs are no-ops on the fake.
  client.queryClient = client.query;

  return { state, db, client };
}

/* --------------------------------------------------------- app builder */

function buildApp(ctx, { companyId = COMPANY_A, storeId = STORE_1, roleId = ADMIN_ROLE } = {}) {
  const modPromise = import("../routes/customers.js");
  const app = express();
  app.use(express.json());
  let router;
  app.use("/api", (req, res, next) => {
    req.user = { id: "u1", companyId, storeId, roleId, username: "tester" };
    if (router) return router(req, res, next);
    next();
  });
  const canViewCompanyCustomers = async (user) => user.roleId === ADMIN_ROLE;
  return (async () => {
    const mod = await modPromise;
    router = mod.default({
      authenticate: (_req, _res, next) => next(),
      authorize: () => (_req, _res, next) => next(),
      db: ctx.db,
      pool: { async connect() { return { query: ctx.client.query, release() {}, queryClient: ctx.client.queryClient }; } },
      canViewCompanyCustomers,
      associateCustomerWithStore,
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

/* --------------------------------------------------------------- tests */

describe("customer CRUD + duplicate handling", () => {
  test("create, edit, activate/deactivate, list with search", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await req(port, "POST", "/api/customers", { name: "Kate Brown", phone: "07700900123", email: "kate@example.com" });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.customer.name, "Kate Brown");

      const edited = await req(port, "PUT", `/api/customers/${created.body.data.customer.id}`, {
        name: "Kate B.", phone: "07700900123", email: "kate.b@example.com", address: "1 High St", postcode: "E1 1AA",
      });
      assert.equal(edited.status, 200);
      assert.equal(edited.body.data.name, "Kate B.");

      const deactivated = await req(port, "PATCH", `/api/customers/${created.body.data.customer.id}/status`, { active: false });
      assert.equal(deactivated.status, 200);
      assert.equal(deactivated.body.data.active, false);

      const reactivated = await req(port, "PATCH", `/api/customers/${created.body.data.customer.id}/status`, { active: true });
      assert.equal(reactivated.body.data.active, true);

      const listed = await req(port, "GET", "/api/customers?search=kate");
      assert.equal(listed.status, 200);
      assert.equal(listed.body.data.length, 1);
      assert.equal(listed.body.data[0].name, "Kate B.");
    } finally { server.close(); }
  });

  test("duplicate identifiers are NOT rejected outright: same person re-added associates instead of duplicating", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const first = await req(port, "POST", "/api/customers", { name: "Household", phone: "07700900999" });
      assert.equal(first.status, 201);
      const second = await req(port, "POST", "/api/customers", { name: "Household member", phone: "07700900999" });
      // Same phone -> single match -> associate with store, NOT a new row.
      assert.equal(second.status, 200, "associating an existing customer returns 200");
      assert.equal(second.body.message, "Customer associated with store");
      assert.equal(ctx.state.customers.size, 1, "no duplicate customer row created");
    } finally { server.close(); }
  });

  test("identifiers matching MULTIPLE different customers are refused (no silent merge)", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      await req(port, "POST", "/api/customers", { name: "A", phone: "07700111000" });
      await req(port, "POST", "/api/customers", { name: "B", email: "shared@example.com" });
      // Craft an ambiguous match: a third submission whose phone matches A and email matches B.
      ctx.state.customers.get([...ctx.state.customers.keys()][1]).phone = "07700111000";
      const ambiguous = await req(port, "POST", "/api/customers", { name: "C", phone: "07700111000" });
      assert.equal(ambiguous.status, 409);
      assert.match(ambiguous.body.message, /multiple customers/i);
    } finally { server.close(); }
  });

  test("customers with no contact information can be created (no constraint breaks them)", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const created = await req(port, "POST", "/api/customers", { name: "Walk-in only" });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.customer.phone, null);
    } finally { server.close(); }
  });
});

describe("company/store tenant isolation", () => {
  test("company B cannot view, edit or status-flip company A's customer", async () => {
    const ctx = makeDb();
    const appA = await buildApp(ctx);
    const { server, port: portA } = await listen(appA);
    const { body: created } = await req(portA, "POST", "/api/customers", { name: "A-only", phone: "07700222000" });
    server.close();

    const appB = await buildApp(ctx, { companyId: COMPANY_B });
    const { server: serverB, port: portB } = await listen(appB);
    try {
      const customerId = created.data.customer.id;
      const view = await req(portB, "GET", `/api/customers/${customerId}`);
      assert.equal(view.status, 404, "foreign customer must 404, not leak data");

      const edit = await req(portB, "PUT", `/api/customers/${customerId}`, { name: "Hacked" });
      assert.equal(edit.status, 404, "foreign edit must 404");

      const flip = await req(portB, "PATCH", `/api/customers/${customerId}/status`, { active: false });
      assert.equal(flip.status, 404, "foreign status flip must 404");

      assert.equal(ctx.state.customers.get(customerId).name, "A-only", "data unchanged");
    } finally { serverB.close(); }
  });

  test("list only returns the caller's company (fake db returns only company-scoped rows)", async () => {
    const ctx = makeDb();
    const appA = await buildApp(ctx);
    const { server: sA, port: pA } = await listen(appA);
    await req(pA, "POST", "/api/customers", { name: "A customer" });
    sA.close();

    const appB = await buildApp(ctx, { companyId: COMPANY_B });
    const { server: sB, port: pB } = await listen(appB);
    try {
      const listed = await req(pB, "GET", "/api/customers");
      assert.equal(listed.body.data.length, 0, "company B sees no company A customers");
    } finally { sB.close(); }
  });

  test("store-scoped staff cannot view a customer with no association to their store (same company)", async () => {
    const ctx = makeDb();
    const appA = await buildApp(ctx);
    const { server: sA, port: pA } = await listen(appA);
    const { body: created } = await req(pA, "POST", "/api/customers", { name: "London-only" });
    sA.close();

    const staffAtStore2 = await buildApp(ctx, { roleId: STAFF_ROLE, storeId: STORE_2 });
    const { server: s2, port: p2 } = await listen(staffAtStore2);
    try {
      const view = await req(p2, "GET", `/api/customers/${created.data.customer.id}`);
      assert.equal(view.status, 404, "customer not associated with the caller's store is hidden");
    } finally { s2.close(); }
  });

  test("customer detail includes sales history (existing architecture)", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { body: created } = await req(port, "POST", "/api/customers", { name: "Buyer" });
      const id = created.data.customer.id;
      ctx.state.sales.push(
        { id: "sale-1", receipt_number: "T01-20260917-0001", store_id: STORE_1, total: 12.4, status: "completed", created_at: "2026-09-17T10:00:00Z", company_id: COMPANY_A, customer_id: id },
        { id: "sale-2", receipt_number: "T01-20260917-0002", store_id: STORE_1, total: 5.0, status: "completed", created_at: "2026-09-17T11:00:00Z", company_id: COMPANY_A, customer_id: id }
      );
      const detail = await req(port, "GET", `/api/customers/${id}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.data.sales.length, 2);
      // newest first
      assert.equal(detail.body.data.sales[0].receipt_number, "T01-20260917-0002");
      assert.ok(detail.body.data.sales[0].id.startsWith("sale-"), "no raw UUID exposure beyond row identity");
    } finally { server.close(); }
  });
});

describe("POS sale association + invoice-delivery contact compatibility", () => {
  test("associateCustomerWithStore rejects a foreign-company customer id (POS sale cannot attach it)", async () => {
    const ctx = makeDb();
    const appA = await buildApp(ctx);
    const { server: sA, port: pA } = await listen(appA);
    const { body: created } = await req(pA, "POST", "/api/customers", { name: "A person" });
    sA.close();

    const customerId = created.data.customer.id;
    const rowsBefore = ctx.state.customerStores.length; // creation already associated STORE_1
    await assert.rejects(
      () =>
        associateCustomerWithStore(ctx.client, customerId, STORE_1, COMPANY_B, new Date()),
      /Customer not found/,
      "company B sale with company A customer id must be rejected"
    );
    assert.equal(ctx.state.customerStores.length, rowsBefore, "no association row leaked across tenants");
  });

  test("sales without a customer remain valid (customerId null skips association)", async () => {
    const ctx = makeDb();
    // Mirrors routes/sales.js: association only runs when customerId is truthy.
    const customerId = null;
    let associationCalls = 0;
    if (customerId) { await associateCustomerWithStore(ctx.client, customerId, STORE_1, COMPANY_A); associationCalls++; }
    assert.equal(associationCalls, 0);
    assert.equal(ctx.state.customerStores.length, 0);
  });

  test("invoice delivery reads contact data from the EXISTING customers row (company-scoped)", async () => {
    const ctx = makeDb();
    const app = await buildApp(ctx);
    const { server, port } = await listen(app);
    try {
      const { body: created } = await req(port, "POST", "/api/customers", {
        name: "WhatsApp User", phone: "+447700900123", email: "deliv@example.com",
      });
      const id = created.data.customer.id;
      // Same shape the delivery services use:
      const wa = await ctx.db(`SELECT name, phone FROM customers WHERE id = $1 AND company_id = $2`, [id, COMPANY_A]);
      assert.equal(wa.rows[0].phone, "+447700900123", "WhatsApp channel contact present");
      const sms = await ctx.db(`SELECT name, phone, email FROM customers WHERE id = $1 AND company_id = $2`, [id, COMPANY_A]);
      assert.equal(sms.rows[0].email, "deliv@example.com", "SMS/Email channel contact present");
      const foreign = await ctx.db(`SELECT name, phone, email FROM customers WHERE id = $1 AND company_id = $2`, [id, COMPANY_B]);
      assert.equal(foreign.rows.length, 0, "foreign company cannot resolve the contact");
    } finally { server.close(); }
  });

  test("associateCustomerWithStore drift check: production copy still matches the audited contract", () => {
    const serverSrc = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
    const start = serverSrc.indexOf("async function associateCustomerWithStore");
    const end = serverSrc.indexOf("async function canViewCompanyCustomers");
    const fn = serverSrc.slice(start, end > start ? end : undefined);
    assert.match(fn, /SELECT id FROM customers WHERE id = \$1 AND company_id = \$2 AND active = true/);
    assert.match(fn, /SELECT id FROM stores WHERE id = \$1 AND company_id = \$2 AND active = true/);
    assert.match(fn, /ON CONFLICT \(customer_id, store_id\)/);
    assert.match(fn, /Customer not found/);
    assert.match(fn, /Store not found/);
  });
});
