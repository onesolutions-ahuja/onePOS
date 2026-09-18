/*
 * Uber Eats Primary Webhook tests (permanent).
 *
 * Drives the REAL HTTP endpoint (POST /api/online/uber/webhook) against a
 * stateful fake db (same pattern as the other route-level suites in this
 * repo): real HMAC signatures, real SQL-shaped fakes for integrations /
 * online_orders / online_order_items / stores / inventory movements.
 *
 * Secrets are generated in-memory; nothing secret is printed.
 *
 *   node --test tests/uberWebhook.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";

const COMPANY = "b0a67538-0000-4000-8000-00000000uber";
const OTHER_COMPANY = "c0a67538-0000-4000-8000-00000000uber";
const STORE_1 = "s1000000-0000-4000-8000-00000000uber";
const STORE_2 = "s2000000-0000-4000-8000-00000000uber";
const UBER_STORE = "8d9de573-1a84-4efe-ab25-b323315ac0af";
const UBER_ORG = "2f5ab050-3d73-4525-ada1-020d2ff679cc";

const SECRET = "test-only-client-secret-" + crypto.randomBytes(8).toString("hex");

/* ------------------------- stateful fake db ------------------------- */

function makeDb() {
  const state = {
    integrations: [
      {
        company_id: COMPANY,
        active: true,
        configuration: {
          environment: "sandbox",
          client_id: "test-client-id",
          client_secret: `enc:v1:fake:${SECRET}`,
          store_location_id: UBER_STORE,
          order_acceptance: "manual",
        },
      },
      {
        company_id: OTHER_COMPANY,
        active: true,
        configuration: { environment: "sandbox", client_secret: `enc:v1:fake:${SECRET}-other` },
      },
    ],
    stores: [
      { id: STORE_1, company_id: COMPANY, code: UBER_STORE, created_at: "2026-01-01" },
      { id: STORE_2, company_id: OTHER_COMPANY, code: "other-store", created_at: "2026-01-01" },
    ],
    orders: [],
    orderItems: [],
    orderEvents: [],
    inventoryMovements: [],
    platformLogs: [],
  };

  const decrypt = (value) =>
    typeof value === "string" && value.startsWith("enc:v1:fake:") ? value.slice("enc:v1:fake:".length) : null;

  // Patch the platformConfig decryptSecret used by routes/online.js by
  // pre-encrypting nothing: the route calls decryptSecret(configuration.*),
  // so the fake uses the enc:v1:fake: prefix understood by this stub.
  const db = async (text, values = []) => {
    state.platformLogs.push({ text: text.slice(0, 60) });

    const q = text.replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT company_id, active, configuration FROM integrations WHERE provider = 'uber'")) {
      return { rows: state.integrations.map((r) => ({ ...r, configuration: { ...r.configuration } })) };
    }

    if (q.startsWith("SELECT id FROM stores WHERE company_id = $1 AND code = $2")) {
      return { rows: state.stores.filter((s) => s.company_id === values[0] && s.code === values[1]).map((s) => ({ id: s.id })) };
    }

    if (q.startsWith("SELECT id FROM stores WHERE company_id = $1 ORDER BY created_at")) {
      const rows = state.stores
        .filter((s) => s.company_id === values[0])
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((s) => ({ id: s.id }));
      return { rows };
    }

    if (q.startsWith("UPDATE integrations SET configuration = configuration ||")) {
      const row = state.integrations.find((r) => r.company_id === values[0]);
      if (row) row.configuration = { ...row.configuration, ...JSON.parse(values[1]) };
      return { rows: [] };
    }

    if (q.startsWith("INSERT INTO online_orders (")) {
      const parsed = parseInsert(text, values);
      const exists = state.orders.find(
        (o) => o.company_id === parsed.company_id && o.platform === parsed.platform && o.external_order_id === parsed.external_order_id
      );
      if (exists) return { rows: [] };
      const order = {
        ...parsed,
        id: crypto.randomUUID(),
        status: "RECEIVED",
        created_at: new Date().toISOString(),
        accepted_at: null,
        preparing_at: null,
        ready_at: null,
        completed_at: null,
        cancelled_at: null,
        inventory_reserved: false,
      };
      state.orders.push(order);
      return { rows: [order] };
    }

    if (q.startsWith("INSERT INTO online_order_items")) {
      const parsed = parseInsert(text, values);
      state.orderItems.push(parsed);
      return { rows: [] };
    }

    if (q.startsWith("INSERT INTO online_order_events")) {
      const parsed = parseInsert(text, values);
      state.orderEvents.push(parsed);
      return { rows: [] };
    }

    if (q.startsWith("INSERT INTO inventory_movements")) {
      const parsed = parseInsert(text, values);
      state.inventoryMovements.push(parsed);
      return { rows: [] };
    }

    if (q.startsWith("SELECT id, status FROM online_orders WHERE company_id = $1 AND platform = 'uber'")) {
      return {
        rows: state.orders
          .filter((o) => o.company_id === values[0] && o.external_order_id === values[1])
          .map((o) => ({ id: o.id, status: o.status })),
      };
    }

    if (q.startsWith("SELECT p.id, p.name, p.price") || q.startsWith("SELECT id, name, price, vat_rate, track_stock FROM products")) {
      return { rows: [] }; // no product mappings in this fake (items stay UNMAPPED)
    }

    if (q.startsWith("INSERT INTO platform_api_logs") || q.startsWith("UPDATE platform_api_logs")) {
      return { rows: [] };
    }

    throw new Error("UNMATCHED QUERY: " + q.slice(0, 90));
  };

  return { state, db, decrypt };
}

/*
 * Parses an INSERT ... VALUES (...) column list into an object. Values may be
 * placeholders ($n) or SQL literals ('uber', FALSE, NOW()), so each column is
 * resolved from its own value token - a naive values[i] mapping misaligns
 * whenever a literal appears between placeholders (as in the online_orders
 * INSERT, which hard-codes platform 'uber').
 */
function parseInsert(text, values) {
  const m = text.match(/INSERT INTO (\w+)\s*\(([^)]*)\)\s*VALUES\s*((?:(?!\s*(?:RETURNING|ON CONFLICT)).)*)/s);
  assert.ok(m, "INSERT statement shape not recognised: " + text.slice(0, 80));
  const columns = m[2].split(",").map((c) => c.trim());
  const valueTokens = splitValueTuples(m[3])[0] || [];
  const object = {};
  columns.forEach((col, i) => {
    const token = valueTokens[i];
    let v;
    if (token === undefined) {
      v = undefined;
    } else if (/^\$\d+$/.test(token.trim())) {
      v = values[Number(token.trim().slice(1)) - 1];
    } else {
      const literal = token.trim().replace(/^'(.*)'$/s, "$1");
      v = token.trim().toUpperCase() === "FALSE" ? false : token.trim().toUpperCase() === "TRUE" ? true : literal;
    }
    if (typeof v === "string" && v.startsWith("{") && (col === "platform_data" || col === "platform_response")) {
      try { v = JSON.parse(v); } catch { /* keep raw */ }
    }
    object[col] = v;
  });
  return object;
}

/* Splits a VALUES clause into per-row arrays of raw tokens (commas at depth 0). */
function splitValueTuples(clause) {
  const tuples = [];
  let depth = 0;
  let current = "";
  let inString = false;
  for (const ch of clause) {
    if (ch === "'" && depth === 0) inString = !inString;
    if (!inString && ch === "(") { depth += 1; if (depth === 1) continue; }
    if (!inString && ch === ")") { depth -= 1; if (depth === 0) { tuples.push(splitTokens(current)); current = ""; continue; } }
    if (depth >= 1) current += ch;
  }
  return tuples;
}

function splitTokens(text) {
  const tokens = [];
  let current = "";
  let inString = false;
  for (const ch of text) {
    if (ch === "'") inString = !inString;
    if (ch === "," && !inString) { tokens.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

/* ------------------------- app under test ------------------------- */

async function buildApp() {
  const { default: createOnlineRouter } = await import("../routes/online.js");
  const { default: express_ } = await import("express");
  const configModule = await import("../services/onlineOrders/platformConfig.js");

  const fake = makeDb();

  /* Use REAL encrypted values: the secrets are encrypted with the real
   * encryptSecret (key derived from JWT_SECRET / ONLINE_PLATFORMS_SECRET)
   * so routes/online.js decrypts them exactly as in production. The fake
   * `enc:v1:fake:` prefix is only an in-memory marker for re-encryption. */
  const { encryptSecret } = configModule;
  fake.state.integrations = fake.state.integrations.map((row) => ({
    ...row,
    configuration: {
      ...row.configuration,
      client_secret: encryptSecret(row.configuration.client_secret.slice("enc:v1:fake:".length)),
    },
  }));

  const app = express_();

  /*
   * RAW-BODY + JSON-PARSE ORDER MATTERS (mirrors server.js): the raw parser
   * for the webhook path is mounted BEFORE the global JSON parser, so the
   * route sees the raw Buffer for signature verification.
   */
  app.use("/api/online/uber/webhook", express_.raw({ type: "*/*", limit: "1mb" }));
  app.use(express_.json({ limit: "10mb" }));

  /* Fake pool: createUberOrder/connect -> a client that delegates to the
   * same fake db handler, so order intake runs through the real code path. */
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
    createOnlineRouter({
      authenticate: (req, _res, next) => next(),
      authorize: () => (_req, _res, next) => next(),
      db: fake.db,
      pool: fakePool,
      writeAudit: async () => {},
      createInventoryMovement: async () => {},
    })
  );

  return { app, fake };
}

function sign(payloadBody, secret) {
  return crypto.createHmac("sha256", secret).update(payloadBody).digest("hex");
}

/* ------------------------------ tests ------------------------------ */

/* Silence only the best-effort audit-log noise in test output (the fake
 * company ids are not uuids for the real logging pool). */
const originalConsoleError = console.error;
console.error = (...args) => {
  if (String(args[0] || "").includes("platform_api_logs write failed")) return;
  if (String(args[0] || "").includes("Logging pool error")) return;
  originalConsoleError(...args);
};

test("uber webhook: health probe reachable", async () => {
  const { app } = await buildApp();
  const server = httpServer(app);
  const port = await listen(server);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/online/uber/webhook/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.service, "uber-webhook");
    assert.equal(body.status, "reachable");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("uber webhook: valid signature + store.provisioned maps store and stores mapping in config", async () => {
  const { app, fake } = await buildApp();
  const payload = Buffer.from(
    JSON.stringify({ event_type: "store.provisioned", store_id: UBER_STORE, user_id: UBER_ORG })
  );

  const res = await fetchRequest(app, "/api/online/uber/webhook", payload, {
    "x-uber-signature": sign(payload, SECRET),
  });

  assert.equal(res.status, 200);
  assert.equal(await res.text(), ""); // empty body ack
  const uberRow = fake.state.integrations.find((r) => r.company_id === COMPANY);
  assert.equal(uberRow.configuration.store_id, UBER_STORE);
  assert.equal(uberRow.configuration.uber_org_id, UBER_ORG);
  assert.equal(uberRow.configuration.uber_store_status, "provisioned");
});

test("uber webhook: invalid signature rejected 401 when a secret is configured", async () => {
  const { app } = await buildApp();
  const payload = Buffer.from(JSON.stringify({ event_type: "store.provisioned", store_id: UBER_STORE }));

  const res = await fetchRequest(app, "/api/online/uber/webhook", payload, {
    "x-uber-signature": sign(payload, "attacker-secret"),
  });

  assert.equal(res.status, 401);
});

test("uber webhook: no signature header rejected 401 when a secret is configured", async () => {
  const { app } = await buildApp();
  const payload = Buffer.from(JSON.stringify({ event_type: "orders.notification", payload: { order_id: "X" } }));

  const res = await fetchRequest(app, "/api/online/uber/webhook", payload, {});
  assert.equal(res.status, 401);
});

test("uber webhook: store.deprovisioned recorded without destructive change", async () => {
  const { app, fake } = await buildApp();
  const payload = Buffer.from(JSON.stringify({ event_type: "store.deprovisioned", store_id: UBER_STORE }));

  const res = await fetchRequest(app, "/api/online/uber/webhook", payload, {
    "x-uber-signature": sign(payload, SECRET),
  });

  assert.equal(res.status, 200);
  const uberRow = fake.state.integrations.find((r) => r.company_id === COMPANY);
  assert.equal(uberRow.configuration.uber_store_status, "deprovisioned");
  // Orders are untouched by a store event.
  assert.equal(fake.state.orders.length, 0);
});

test("uber webhook: orders.notification creates a RECEIVED order (UNMAPPED items kept)", async () => {
  const { app, fake } = await buildApp();
  const payload = Buffer.from(
    JSON.stringify({
      event_type: "orders.notification",
      payload: {
        order_id: "UBER-ORD-1",
        store_id: UBER_STORE,
        display_id: "101",
        fulfillment_type: "PICKUP",
        eater: { first_name: "Jane", phone: "+447700900000", verification_code: "1234" },
        items: [{ pos_item_id: "SKU-9", title: "Latte", quantity: 2 }],
      },
    })
  );

  const res = await fetchRequest(app, "/api/online/uber/webhook", payload, {
    "x-uber-signature": sign(payload, SECRET),
  });

  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
  assert.equal(fake.state.orders.length, 1);
  const order = fake.state.orders[0];
  assert.equal(order.platform, "uber");
  assert.equal(order.status, "RECEIVED");
  assert.equal(order.company_id, COMPANY);
  assert.equal(order.store_id, STORE_1); // mapped via store code == uber store id
  assert.equal(order.external_order_id, "UBER-ORD-1");
  assert.equal(order.customer_name, "Jane");
  assert.equal(order.otp_code, "1234");
  assert.equal(order.fulfilment_type, "COLLECTION");
  assert.equal(fake.state.orderItems.length, 1);
  assert.equal(fake.state.orderItems[0].mapping_status, "UNMAPPED");
  assert.equal(fake.state.orderItems[0].quantity, 2);
});

test("uber webhook: duplicate delivery never creates a second order", async () => {
  const { app, fake } = await buildApp();
  const payload = Buffer.from(
    JSON.stringify({ event_type: "orders.notification", payload: { order_id: "UBER-ORD-DUP", items: [] } })
  );
  const headers = { "x-uber-signature": sign(payload, SECRET) };

  await fetchRequest(app, "/api/online/uber/webhook", payload, headers);
  await fetchRequest(app, "/api/online/uber/webhook", payload, headers);

  const matching = fake.state.orders.filter((o) => o.external_order_id === "UBER-ORD-DUP");
  assert.equal(matching.length, 1);
});

test("uber webhook: notification without inline order creates a skeleton RECEIVED order (no fabricated transitions)", async () => {
  const { app, fake } = await buildApp();
  const payload = Buffer.from(
    JSON.stringify({ event_type: "orders.notification", payload: { order_id: "UBER-ORD-LATE" } })
  );

  const res = await fetchRequest(app, "/api/online/uber/webhook", payload, {
    "x-uber-signature": sign(payload, SECRET),
  });

  assert.equal(res.status, 200);
  // Uber's orders.notification normally carries the full order; a bare id
  // still produces a RECEIVED skeleton with ZERO items and no status
  // transitions - nothing beyond the notification is invented.
  assert.equal(fake.state.orders.length, 1);
  assert.equal(fake.state.orders[0].status, "RECEIVED");
  assert.equal(fake.state.orderItems.length, 0);
});

test("uber webhook: company isolation - other company's integration untouched", async () => {
  const { app, fake } = await buildApp();
  const payload = Buffer.from(
    JSON.stringify({ event_type: "store.provisioned", store_id: UBER_STORE, user_id: UBER_ORG })
  );

  await fetchRequest(app, "/api/online/uber/webhook", payload, {
    "x-uber-signature": sign(payload, SECRET),
  });

  const otherRow = fake.state.integrations.find((r) => r.company_id === OTHER_COMPANY);
  assert.equal(otherRow.configuration.store_id, undefined);
  assert.equal(otherRow.configuration.uber_store_status, undefined);
  // No order may ever be created for the other company.
  assert.equal(fake.state.orders.filter((o) => o.company_id === OTHER_COMPANY).length, 0);
});

test("uber webhook: processing error still acknowledged 200 (never wedges delivery)", async () => {
  const { app } = await buildApp();
  const payload = Buffer.from("{not-json");

  const res = await fetchRequest(app, "/api/online/uber/webhook", payload, {
    "x-uber-signature": sign(payload, SECRET),
  });

  // Malformed JSON with a valid signature over the raw bytes: the endpoint
  // treats an unparsable body as audit-only and still acknowledges.
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
});

test("manual accept stamps accepted_at and preparing_at (TAT groundwork)", async () => {
  const { state } = makeDb();
  // Directly verify the SQL contract: the accept route stamps both columns.
  const src = fs.readFileSync(new URL("../routes/online.js", import.meta.url), "utf8");
  assert.ok(/accept[\s\S]{0,900}SET accepted_at = NOW\(\) WHERE id = \$1 AND accepted_at IS NULL/.test(src));
  assert.ok(src.includes('timestampColumn: "preparing_at"'));
  assert.ok(src.includes('timestampColumn: "completed_at"'));
  assert.ok(state !== null);
});

/* ------------------------- helpers ------------------------- */

async function fetchRequest(app, path, body, headers) {
  const server = httpServer(app);
  const port = await listen(server);
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

import http from "node:http";

function httpServer(app) {
  return http.createServer(app);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}
