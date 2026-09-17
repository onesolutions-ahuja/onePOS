/*
 * T9P-SMALL - focused tests for the secure invoice delivery contract.
 *
 * Pure service layer against a faithful fake db (the sale-check WHERE clause
 * on id/company/store is honoured, so tenant isolation behaves like real
 * PostgreSQL). No database writes, no server, no temporary data. Run:
 *
 *   node --test tests/secureInvoiceDelivery.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInvoiceDeliveryLink,
  buildInvoiceDeliveryMessage,
  createSecureInvoiceLink,
  validateSecureInvoiceToken,
  hashSecureInvoiceToken,
} from "../services/secureInvoiceLinks.js";

const COMPANY_A = "a0000000-0000-4000-8000-000000000001";
const COMPANY_B = "b0000000-0000-4000-8000-000000000002";
const STORE_1 = "c0000000-0000-4000-8000-000000000003";
const STORE_2 = "d0000000-0000-4000-8000-000000000004";
const SALE_ID = "e0000000-0000-4000-8000-000000000005";
const CUSTOMER_ID = "f0000000-0000-4000-8000-000000000006";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

/*
 * Fake db faithful to the service SQL:
 *  - INSERT INTO secure_invoice_links -> captures params, returns one row
 *  - SELECT ... FROM secure_invoice_links -> optional link row
 *  - SELECT ... FROM sales -> honours WHERE (id=$1, company_id=$2[, store_id=$3])
 *  - anything else (sale_items, payments, ...) -> empty
 */
function makeFakeDb({ sale = null, linkRow = null } = {}) {
  const calls = [];
  let insert = null;
  const db = async (sql, params) => {
    const flat = sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: flat, params });
    if (/INSERT INTO secure_invoice_links/i.test(sql)) {
      insert = { sql: flat, params };
      return {
        rows: [{ id: "00000000-0000-4000-8000-0000000000ff", expires_at: params[5] }],
        rowCount: 1,
      };
    }
    if (/FROM secure_invoice_links/i.test(sql)) {
      return { rows: linkRow ? [linkRow] : [], rowCount: linkRow ? 1 : 0 };
    }
    if (/FROM sales/i.test(sql)) {
      const matches =
        sale &&
        params[0] === sale.id &&
        params[1] === sale.company_id &&
        (params.length < 3 || params[2] === sale.store_id);
      return { rows: matches ? [sale] : [], rowCount: matches ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { db, calls, getInsert: () => insert };
}

const SALE_ROW = {
  id: SALE_ID,
  company_id: COMPANY_A,
  store_id: STORE_1,
  customer_id: CUSTOMER_ID,
};

/* ------------------------------------------------------------ 1. creation */

test("valid sale creates a delivery URL on the /i/:token route", async () => {
  const fake = makeFakeDb({ sale: SALE_ROW });
  const result = await createInvoiceDeliveryLink({
    db: fake.db,
    saleId: SALE_ID,
    companyId: COMPANY_A,
    storeId: STORE_1,
    createdBy: "user-1",
  });
  assert.equal(result.ok, true);
  assert.ok(result.url.startsWith("/i/"), "must target the existing public route");
  const token = result.url.replace(/^\/i\//, "");
  assert.match(token, TOKEN_RE, "opaque 256-bit token");
  assert.ok(!result.url.includes("?"), "no query parameters may ride on the URL");
  assert.ok(result.expiresAt instanceof Date && !Number.isNaN(result.expiresAt.getTime()));
});

test("different sales produce different tokens/URLs", async () => {
  const other = { ...SALE_ROW, id: "e0000000-0000-4000-8000-000000000099" };
  const a = await createInvoiceDeliveryLink({ db: makeFakeDb({ sale: SALE_ROW }).db, saleId: SALE_ID, companyId: COMPANY_A });
  const b = await createInvoiceDeliveryLink({ db: makeFakeDb({ sale: other }).db, saleId: other.id, companyId: COMPANY_A });
  assert.equal(a.ok && b.ok, true);
  assert.notEqual(a.url, b.url);
  assert.notEqual(a.url.replace(/^\/i\//, ""), b.url.replace(/^\/i\//, ""));
});

/* -------------------------------------------- 2. URL resolves via /i/:token */

test("the URL's token resolves through the EXISTING hash-lookup contract", async () => {
  const fake = makeFakeDb({ sale: SALE_ROW });
  const created = await createInvoiceDeliveryLink({ db: fake.db, saleId: SALE_ID, companyId: COMPANY_A });
  const token = created.url.replace(/^\/i\//, "");

  const linkRow = {
    id: "00000000-0000-4000-8000-0000000000aa",
    token_hash: hashSecureInvoiceToken(token),
    company_id: COMPANY_A,
    store_id: STORE_1,
    sale_id: SALE_ID,
    created_at: new Date(),
    expires_at: new Date(Date.now() + 86_400_000),
    revoked_at: null,
    last_accessed_at: null,
    access_count: 0,
  };
  const vfake = makeFakeDb({ sale: SALE_ROW, linkRow });
  const validated = await validateSecureInvoiceToken({ db: vfake.db, token });
  assert.equal(validated.ok, true, "the delivered URL must work with the unchanged /i/:token lookup");
  assert.equal(validated.sale.id, SALE_ID);
  assert.equal(validated.link.sale_id, SALE_ID);
});

/* ------------------------------------------------ 3./4. tenant rejections */

test("cross-company sale is rejected and nothing is inserted", async () => {
  const fake = makeFakeDb({ sale: SALE_ROW });
  const result = await createInvoiceDeliveryLink({
    db: fake.db,
    saleId: SALE_ID,
    companyId: COMPANY_B, // different tenant
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(fake.getInsert(), null, "no link row may be written for a foreign sale");
});

test("cross-store request is rejected when the sale belongs to another store", async () => {
  const fake = makeFakeDb({ sale: SALE_ROW });
  const result = await createInvoiceDeliveryLink({
    db: fake.db,
    saleId: SALE_ID,
    companyId: COMPANY_A,
    storeId: STORE_2,
  });
  assert.equal(result.ok, false);
  const saleCheck = fake.calls.find((c) => /FROM sales/i.test(c.sql) && !/INSERT/i.test(c.sql));
  assert.ok(/AND s\.store_id = \$3/i.test(saleCheck.sql), "store scoping must be part of the sale check");
  assert.equal(fake.getInsert(), null);
});

test("invalid/unknown sale is rejected", async () => {
  const fake = makeFakeDb({ sale: null });
  const result = await createInvoiceDeliveryLink({ db: fake.db, saleId: SALE_ID, companyId: COMPANY_A });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.deepEqual(Object.keys(result).sort(), ["message", "ok", "status"]);
});

/* -------------------------------------------------------- 5./6. expiry */

test("expiry is returned correctly (relative and default)", async () => {
  const week = await createInvoiceDeliveryLink({
    db: makeFakeDb({ sale: SALE_ROW }).db,
    saleId: SALE_ID,
    companyId: COMPANY_A,
    expiryDays: 7,
  });
  assert.equal(week.ok, true);
  assert.ok(Math.abs(week.expiresAt.getTime() - (Date.now() + 7 * 86_400_000)) < 60_000, "expiryDays honoured");

  const def = await createInvoiceDeliveryLink({
    db: makeFakeDb({ sale: SALE_ROW }).db,
    saleId: SALE_ID,
    companyId: COMPANY_A,
  });
  assert.ok(Math.abs(def.expiresAt.getTime() - (Date.now() + 30 * 86_400_000)) < 60_000, "30-day default honoured");

  const at = new Date(Date.now() + 3 * 86_400_000);
  const abs = await createInvoiceDeliveryLink({
    db: makeFakeDb({ sale: SALE_ROW }).db,
    saleId: SALE_ID,
    companyId: COMPANY_A,
    expiresAt: at,
  });
  assert.equal(abs.expiresAt.getTime(), at.getTime(), "absolute expiry wins");
});

/* ------------------------- 7. hash-only persistence / one-time plaintext */

test("plaintext token is never persisted; only the SHA-256 hash is stored", async () => {
  const fake = makeFakeDb({ sale: SALE_ROW });
  const result = await createInvoiceDeliveryLink({ db: fake.db, saleId: SALE_ID, companyId: COMPANY_A });
  const token = result.url.replace(/^\/i\//, "");
  const insert = fake.getInsert();
  assert.ok(insert, "a link row is written");
  assert.ok(insert.params.includes(hashSecureInvoiceToken(token)), "hash stored");
  assert.ok(!insert.params.some((p) => p === token), "plaintext never persisted");
  assert.ok(!JSON.stringify(insert.params).includes(CUSTOMER_ID), "no customer data in the link row");
});

test("delivery result exposes ONLY url + expiresAt (no token/hash/IDs)", async () => {
  const result = await createInvoiceDeliveryLink({ db: makeFakeDb({ sale: SALE_ROW }).db, saleId: SALE_ID, companyId: COMPANY_A });
  assert.deepEqual(Object.keys(result).sort(), ["expiresAt", "ok", "url"]);

  // Contrast: the underlying one-time creation mechanism still returns the
  // plaintext token exactly once - the wrapper must strip it.
  const raw = await createSecureInvoiceLink({ db: makeFakeDb({ sale: SALE_ROW }).db, saleId: SALE_ID, companyId: COMPANY_A });
  assert.ok(raw.ok && typeof raw.token === "string");
  assert.notDeepEqual(Object.keys(raw).sort(), Object.keys(result).sort());
});

/* ------------------------------------------------------------ 8. baseUrl */

test("baseUrl prefix is honoured, normalised and cannot break the URL", async () => {
  const trailing = await createInvoiceDeliveryLink({
    db: makeFakeDb({ sale: SALE_ROW }).db,
    saleId: SALE_ID,
    companyId: COMPANY_A,
    baseUrl: "https://pos.example.com/",
  });
  assert.ok(trailing.url.startsWith("https://pos.example.com/i/"));
  assert.match(trailing.url.replace(/^https:\/\/pos\.example\.com\/i\//, ""), TOKEN_RE);

  const spaced = await createInvoiceDeliveryLink({
    db: makeFakeDb({ sale: SALE_ROW }).db,
    saleId: SALE_ID,
    companyId: COMPANY_A,
    baseUrl: "  https://till.example.com  ",
  });
  assert.ok(spaced.url.startsWith("https://till.example.com/i/"));

  const hostile = await createInvoiceDeliveryLink({
    db: makeFakeDb({ sale: SALE_ROW }).db,
    saleId: SALE_ID,
    companyId: COMPANY_A,
    baseUrl: "javascript:alert(1)",
  });
  assert.ok(hostile.url.startsWith("/i/"), "non-http(s) base URLs fall back to the relative path");
});

/* --------------------------------------------------------- 9. message */

test("delivery message contains URL/invoice/expiry and NO internal IDs", () => {
  const url = `/i/${"k".repeat(43)}`;
  const msg = buildInvoiceDeliveryMessage({
    url,
    invoiceNumber: "01-20260917-0007",
    expiresAt: new Date("2026-10-17T12:00:00Z"),
  });
  assert.equal(typeof msg, "string");
  assert.ok(msg.includes(url));
  assert.ok(msg.includes("01-20260917-0007"));
  assert.ok(msg.includes("valid until"));
  for (const secret of [SALE_ID, COMPANY_A, COMPANY_B, STORE_1, CUSTOMER_ID]) {
    assert.ok(!msg.includes(secret), `internal ID ${secret} must not appear`);
  }
  assert.ok(!/<[a-z][\s\S]*>/i.test(msg), "plain text only");
});

test("message omits the expiry line gracefully and handles missing URL", () => {
  const withoutExpiry = buildInvoiceDeliveryMessage({ url: "/i/x", invoiceNumber: "I-1" });
  assert.ok(!withoutExpiry.includes("valid until"));

  const badDate = buildInvoiceDeliveryMessage({ url: "/i/x", invoiceNumber: "I-1", expiresAt: "not-a-date" });
  assert.ok(!badDate.includes("valid until"), "unparseable expiry is omitted, not thrown");

  assert.equal(buildInvoiceDeliveryMessage({ invoiceNumber: "I-1" }), null);
  assert.equal(buildInvoiceDeliveryMessage({}), null);
});

test("the message carries the token ONLY as part of the delivery URL", () => {
  const token = "m".repeat(43);
  const url = `https://pos.example.com/i/${token}`;
  const msg = buildInvoiceDeliveryMessage({ url, invoiceNumber: "I-2" });
  assert.equal(msg.split(token).length - 1, 1, "token appears exactly once");
  assert.ok(msg.includes(url), "and always inside the URL");
});
