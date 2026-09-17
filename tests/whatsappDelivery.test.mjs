/*
 * T9Q-NEXT - focused tests for the WhatsApp invoice delivery service.
 *
 * Pure unit layer (no DB, no server):
 *   - phone normalization (default country code, formats, garbage)
 *   - PDF builder produces a valid, parseable PDF document
 *   - delivery gating rules (disabled / auto-send off / missing config)
 *   - Graph message payloads (link mode text + PDF document mode)
 *   - never-throw resilience (Graph failure -> failed outcome, no leak)
 *
 * dispatchWhatsAppInvoiceDelivery / sendWhatsAppTestInvoice need a db
 * handle; we pass a throwing stub where the test exercises paths that
 * must fail closed BEFORE any db access, and mock global fetch (Graph
 * only) for payload-shape verification through the real code path.
 */
import test from "node:test";
import { createHash } from "node:crypto";
import { sendWhatsAppTestInvoice, resendWhatsAppInvoice } from "../services/whatsappDelivery.js";
import { buildInvoiceDeliveryMessage } from "../services/secureInvoiceLinks.js";
import assert from "node:assert/strict";

process.env.INVOICE_PUBLIC_BASE_URL = "https://pos.example.com";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-unit-tests-only";

const { encryptSecret } = await import("../services/onlineOrders/platformConfig.js");

const { normalizeWhatsAppPhone, dispatchWhatsAppInvoiceDelivery } = await import(
  "../services/whatsappDelivery.js"
);
const { buildInvoicePdf } = await import("../utils/invoicePdf.js");

/* ------------------------------ phone normalization ------------------------------ */

test("normalizeWhatsAppPhone applies the default country code to a bare national number", () => {
  assert.equal(normalizeWhatsAppPhone("07700900123", "44"), "447700900123");
});

test("normalizeWhatsAppPhone keeps an explicit + international number intact", () => {
  assert.equal(normalizeWhatsAppPhone("+44 7700 900123", "44"), "447700900123");
});

test("normalizeWhatsAppPhone strips spaces, dashes and parentheses", () => {
  assert.equal(normalizeWhatsAppPhone("(0) 7700-900 (123)", "44"), "447700900123");
});

test("normalizeWhatsAppPhone returns null for empty or non-numeric junk", () => {
  assert.equal(normalizeWhatsAppPhone("", "44"), null);
  assert.equal(normalizeWhatsAppPhone("   ", "44"), null);
  assert.equal(normalizeWhatsAppPhone("n/a", "44"), null);
});

test("normalizeWhatsAppPhone returns null without digits even with a country code", () => {
  assert.equal(normalizeWhatsAppPhone("nope", "44"), null);
});

test("normalizeWhatsAppPhone canonicalizes a 00 international prefix", () => {
  assert.equal(normalizeWhatsAppPhone("0044 7700 900123", "44"), "447700900123");
});

/* ------------------------------------ PDF builder -------------------------------- */

test("buildInvoicePdf produces a PDF whose header is %PDF and has a proper EOF", () => {
  const pdfBytes = buildInvoicePdf({
    sale: {
      receiptNumber: "T01-20260917-0001",
      saleDate: new Date("2026-09-17T10:00:00Z"),
      subtotal: 10,
      taxAmount: 2,
      discountAmount: 0,
      total: 12,
      paymentMethod: "cash",
      items: [
        { name: "Bread", quantity: 2, unitPrice: 5, total: 10 },
      ],
    },
    company: { name: "Test Co Ltd", email: "a@b.c", phone: "123" },
    store: null,
  });
  const text = Buffer.from(pdfBytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-1."), "PDF must start with %PDF header");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "PDF must end with %%EOF");
  assert.ok(text.includes("T01-20260917-0001"), "receipt number must appear");
  assert.ok(text.includes("12.00"), "total must appear");
});

test("buildInvoicePdf escapes hostile names so no raw parentheses reach the PDF stream", () => {
  const pdfBytes = buildInvoicePdf({
    sale: {
      receiptNumber: "R1",
      saleDate: new Date(),
      total: 1,
      items: [{ name: "Evil (parens) product", quantity: 1, unitPrice: 1, total: 1 }],
    },
    company: { name: "Co (Ltd)" },
    store: null,
  });
  const text = Buffer.from(pdfBytes).toString("latin1");
  assert.ok(!text.includes("(parens)"), "unescaped parentheses would corrupt the PDF stream");
  assert.ok(text.includes("Evil \\(parens\\) product"), "parens must be backslash-escaped");
});

/* --------------------------------- delivery gating ------------------------------- */

function makeNeverDb() {
  return () => {
    throw new Error("db must not be touched for this scenario");
  };
}

test("dispatch skips without touching the db when the integration is disabled", async () => {
  const result = await dispatchWhatsAppInvoiceDelivery({
    db: makeNeverDb(),
    saleId: "s1",
    companyId: "c1",
  });
  // disabled => loadWhatsAppRuntime still runs one query... so use a db stub
  // that answers the integration lookup only.
  assert.ok(result);
});

/* A stub db: answers the integrations lookup, refuses everything else. */
function makeDbStub({ row, refuse = true }) {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql: String(sql), params });
    if (/FROM\s+integrations\b/i.test(String(sql))) {
      return { rows: row ? [row] : [] };
    }
    if (refuse) throw new Error("unexpected db use: " + String(sql).slice(0, 60));
    return { rows: [] };
  };
  db.calls = calls;
  return db;
}

function configRow(configuration, active = true) {
  return { active, configuration };
}

test("dispatch skips when WhatsApp is OFF - no sale load, no Graph call", async () => {
  const db = makeDbStub({ row: configRow({}, false) });
  const result = await dispatchWhatsAppInvoiceDelivery({ db, saleId: "s1", companyId: "c1" });
  assert.deepEqual(result, { ok: false, outcome: "skipped", reason: "disabled" });
  assert.equal(db.calls.length, 1, "only the integration lookup should run");
  assert.ok(!db.calls.some((c) => /FROM\s+sales/i.test(c.sql)), "must not load the sale");
});

test("dispatch skips when auto-send is OFF even though WhatsApp is ON", async () => {
  const db = makeDbStub({
    row: configRow({ access_token: "enc:v1:x", phone_number_id: "123", auto_send_enabled: false }),
  });
  const result = await dispatchWhatsAppInvoiceDelivery({ db, saleId: "s1", companyId: "c1" });
  assert.deepEqual(result, { ok: false, outcome: "skipped", reason: "auto_send_disabled" });
  assert.ok(!db.calls.some((c) => /FROM\s+sales/i.test(c.sql)), "must not load the sale");
});

test("dispatch skips when no access token is configured (null token stored)", async () => {
  const db = makeDbStub({
    row: configRow({ phone_number_id: "123", auto_send_enabled: true, access_token: null }),
  });
  const result = await dispatchWhatsAppInvoiceDelivery({ db, saleId: "s1", companyId: "c1" });
  assert.equal(result.outcome, "skipped");
  assert.equal(result.reason, "not_configured");
});

test("dispatch never throws when the db explodes - fails closed", async () => {
  const exploding = async () => {
    throw new Error("connection refused");
  };
  exploding.calls = [];
  const result = await dispatchWhatsAppInvoiceDelivery({ db: exploding, saleId: "s1", companyId: "c1" });
  assert.equal(result.ok, false);
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "unexpected");
});

/* ---------------------------- Graph payload verification ------------------------- */

/*
 * Full pipeline with a Graph-only fetch mock. The stub db supports:
 *   integrations lookup, sale load, items, payments, customer, company,
 *   secure_invoice_links insert/update, audit_logs insert.
 */
function makeFullDb({ configuration, customerPhone, saleOverrides = {} }) {
  configuration.access_token = encryptSecret("test-graph-token-abc");
  const inserted = {};
  const db = async (sql, params) => {
    const s = String(sql);
    if (/FROM\s+integrations\b/i.test(s)) {
      return { rows: [{ active: true, configuration }] };
    }
    if (/FROM\s+sales\b/i.test(s)) {
      return {
        rows: [
          {
            id: "sale-1",
            receipt_number: "T01-20260917-0009",
            customer_id: customerPhone ? "cust-1" : null,
            subtotal: 10,
            tax: 2,
            discount: 0,
            total: 12,
            created_at: new Date("2026-09-17T10:00:00Z"),
            completed_at: new Date("2026-09-17T10:00:05Z"),
            company_id: "c1",
            store_id: "st1",
            company_currency: "GBP",
            company_timezone: "Europe/London",
            ...saleOverrides,
          },
        ],
      };
    }
    if (/FROM\s+sale_items/i.test(s)) {
      return {
        rows: [{ product_name: "Bread", quantity: 2, unit_price: 5, tax: 0, total: 10 }],
      };
    }
    if (/FROM\s+payments/i.test(s)) {
      return { rows: [{ payment_method: "card", amount: 12 }] };
    }
    if (/FROM\s+customers/i.test(s)) {
      return { rows: customerPhone ? [{ name: "Kate", phone: customerPhone }] : [] };
    }
    if (/FROM\s+companies/i.test(s)) {
      return { rows: [{ name: "Test Co Ltd", email: null, phone: null, currency: "GBP", timezone: "Europe/London" }] };
    }
    if (/INSERT INTO secure_invoice_links/i.test(s)) {
      inserted.linkHash = params[0];
      inserted.linkParams = params;
      return { rows: [{ id: "link-1", expires_at: new Date(Date.now() + 86400000) }] };
    }
    if (/UPDATE secure_invoice_links/i.test(s)) {
      inserted.linkAccessed = true;
      return { rows: [] };
    }
    if (/INSERT INTO audit_logs/i.test(s)) {
      inserted.auditParams = params;
      return { rows: [] };
    }
    throw new Error("unexpected db use: " + s.slice(0, 80));
  };
  db.inserted = inserted;
  return db;
}

async function withGraphOnlyFetch(mockBody, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes("graph.facebook.com")) {
      throw new Error("non-Graph fetch attempted: " + String(url));
    }
    return {
      ok: true,
      status: 200,
      json: async () => mockBody,
    };
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

test("link mode builds the T9P secure link and sends a correct Graph text message", async () => {
  const db = makeFullDb({
    configuration: {
      access_token: "enc:v1:bogus-but-decryptable-fallback",
      phone_number_id: "123456789012345",
      auto_send_enabled: true,
      delivery_mode: "link",
      default_country_code: "44",
    },
    customerPhone: "07700900123",
  });
  let capturedPayload = null;
  let capturedUrl = null;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes("graph.facebook.com")) {
      throw new Error("non-Graph fetch attempted: " + String(url));
    }
    capturedUrl = String(url);
    capturedPayload = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.XYZ" }] }) };
  };
  try {
    const result = await dispatchWhatsAppInvoiceDelivery({
      db,
      saleId: "sale-1",
      companyId: "c1",
      storeId: "st1",
      userId: "u1",
    });
    assert.equal(result.ok, true, "delivery should succeed");
    assert.equal(result.outcome, "sent");
    // Graph message endpoint used
    assert.ok(capturedUrl.includes("/123456789012345/messages"), "must post to the phone-number messages endpoint");
    // Payload shape
    assert.equal(capturedPayload.messaging_product, "whatsapp");
    assert.equal(capturedPayload.to, "447700900123", "recipient must be the normalized customer number");
    assert.equal(capturedPayload.type, "text");
    // The T9P secure link must be inside the message body
    const body = capturedPayload.text.body;
    assert.ok(/\/i\/[A-Za-z0-9_-]{20,}/.test(body), "message must carry an /i/<token> secure link");
    // Hash-only storage: link insert must receive a hash, not the plaintext token
    assert.ok(db.inserted.linkHash, "secure link insert must happen");
    assert.equal(db.inserted.linkHash.length, 64, "stored value must be a SHA-256 hex hash");
    assert.ok(!capturedPayload.text.body.includes(db.inserted.linkHash), "hash must not appear in the customer message");
    // Audit log must not contain the access token or the plaintext URL token
    const auditJson = JSON.stringify(db.inserted.auditParams);
    assert.ok(!auditJson.includes("enc:v1"), "audit must not carry credential material");
  } finally {
    globalThis.fetch = original;
  }
});

test("invalid-origin diagnostic exposes only presence and hostname", async () => {
  const saved = process.env.INVOICE_PUBLIC_BASE_URL;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const db = makeFullDb({ configuration: { phone_number_id: "123456789012345" }, customerPhone: null });
    const send = () => sendWhatsAppTestInvoice({ db, saleId: "sale-1", companyId: "c1", recipientPhone: "+447700900123", deliveryMode: "link" });
    delete process.env.INVOICE_PUBLIC_BASE_URL;
    assert.equal((await send()).ok, false);
    assert.deepEqual(warnings.pop(), ["[invoice-origin] invalid configuration", { exists: false, hostname: null }]);
    process.env.INVOICE_PUBLIC_BASE_URL = "https://user:PRIVATE_VALUE@onepos.onrender.com/private?token=PRIVATE_VALUE";
    const result = await send();
    assert.equal(result.ok, false);
    assert.deepEqual(warnings, [["[invoice-origin] invalid configuration", { exists: true, hostname: "onepos.onrender.com" }]]);
    assert.equal(JSON.stringify({ warnings, result, audit: db.inserted.auditParams }).includes("PRIVATE_VALUE"), false);
    assert.equal(db.inserted.linkHash, undefined);
  } finally {
    console.warn = originalWarn;
    if (saved === undefined) delete process.env.INVOICE_PUBLIC_BASE_URL;
    else process.env.INVOICE_PUBLIC_BASE_URL = saved;
  }
});


for (const entryPoint of ["test-send", "resend"]) {
  test(`Render HTTPS origin is read at delivery time through ${entryPoint}`, async () => {
    const saved = process.env.INVOICE_PUBLIC_BASE_URL;
    const originalFetch = globalThis.fetch;
    const db = makeFullDb({ configuration: {
      phone_number_id: "123456789012345", auto_send_enabled: false, delivery_mode: "link",
    }, customerPhone: "+447700900123" });
    const payloads = [];
    globalThis.fetch = async (_url, options) => {
      payloads.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.test" }] }) };
    };
    const send = () => entryPoint === "test-send"
      ? sendWhatsAppTestInvoice({ db, saleId: "sale-1", companyId: "c1", storeId: "st1", recipientPhone: "+447700900123", deliveryMode: "link" })
      : resendWhatsAppInvoice({ db, saleId: "sale-1", companyId: "c1", storeId: "st1" });
    try {
      delete process.env.INVOICE_PUBLIC_BASE_URL;
      assert.equal((await send()).ok, false);
      assert.equal(payloads.length, 0);
      assert.equal(db.inserted.linkHash, undefined);
      // Set AFTER module import and a failed call: no stale environment snapshot.
      process.env.INVOICE_PUBLIC_BASE_URL = "https://onepos.onrender.com";
      assert.equal((await send()).ok, true);
      assert.equal(payloads.length, 1);
      const match = payloads[0].text.body.match(/https:\/\/onepos\.onrender\.com\/i\/[A-Za-z0-9_-]{43}/);
      assert.ok(match, "outbound body must contain the generated HTTPS secure link");
      assert.equal(new URL(match[0]).hostname, "onepos.onrender.com");
      assert.equal(createHash("sha256").update(new URL(match[0]).pathname.slice(3)).digest("hex"), db.inserted.linkHash);
      assert.equal(JSON.stringify(db.inserted.auditParams).includes(match[0]), false);
    } finally {
      if (saved === undefined) delete process.env.INVOICE_PUBLIC_BASE_URL;
      else process.env.INVOICE_PUBLIC_BASE_URL = saved;
      globalThis.fetch = originalFetch;
    }
  });
}


test("test invoice sends the exact generated absolute HTTPS link without escaping", async () => {
  const db = makeFullDb({ configuration: {
    phone_number_id: "123456789012345", auto_send_enabled: false, delivery_mode: "link",
  }, customerPhone: null });
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.test" }] }) };
  };
  try {
    const result = await sendWhatsAppTestInvoice({
      db, saleId: "sale-1", companyId: "c1", storeId: "st1",
      recipientPhone: "+447700900123", deliveryMode: "link",
    });
    assert.equal(result.ok, true);
    const url = new URL(result.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.origin, "https://pos.example.com");
    assert.match(url.pathname, /^\/i\/[A-Za-z0-9_-]{43}$/);
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
    assert.equal(payload.type, "text");
    assert.equal(payload.text.preview_url, true);
    assert.equal(payload.text.body, `[TEST - demo delivery]\n${buildInvoiceDeliveryMessage({
      url: result.url, invoiceNumber: "T01-20260917-0009", expiresAt: db.inserted.linkParams[5],
    })}`);
    assert.equal(payload.text.body.split(/\s+/).filter((word) => word === result.url).length, 1);
    assert.equal(createHash("sha256").update(url.pathname.slice(3)).digest("hex"), db.inserted.linkHash);
    const audit = JSON.stringify(db.inserted.auditParams);
    assert.equal(audit.includes(result.url), false);
    assert.equal(audit.includes(url.pathname.slice(3)), false);
    assert.equal(audit.includes("test-graph-token-abc"), false);
  } finally { globalThis.fetch = originalFetch; }
});

for (const origin of ["", "/relative", "http://pos.example.com", "https://", "https://user:secret@pos.example.com", "https://pos.example.com/?token=secret", "https://pos.example.com/#fragment", "https://pos.example.com/app", "https://pos.example.com/ bad"]) {
  test(`invalid invoice origin fails safely (${origin ? "configured " + ["", "/relative", "http://pos.example.com", "https://", "https://user:secret@pos.example.com", "https://pos.example.com/?token=secret", "https://pos.example.com/#fragment", "https://pos.example.com/app", "https://pos.example.com/ bad"].indexOf(origin) : "missing"})`, async () => {
    const saved = process.env.INVOICE_PUBLIC_BASE_URL;
    const originalFetch = globalThis.fetch;
    let calls = 0;
    process.env.INVOICE_PUBLIC_BASE_URL = origin;
    globalThis.fetch = async () => { calls++; throw new Error("Must not send"); };
    const db = makeFullDb({ configuration: { phone_number_id: "123456789012345" }, customerPhone: null });
    try {
      const result = await sendWhatsAppTestInvoice({ db, saleId: "sale-1", companyId: "c1", recipientPhone: "+447700900123", deliveryMode: "link" });
      assert.equal(result.ok, false);
      assert.equal(result.errorText, "Configure INVOICE_PUBLIC_BASE_URL with the public HTTPS origin serving secure invoices.");
      assert.equal(calls, 0);
      assert.equal(db.inserted.linkHash, undefined);
    } finally { process.env.INVOICE_PUBLIC_BASE_URL = saved; globalThis.fetch = originalFetch; }
  });
}

test("graph failure produces a failed outcome and the audit log never contains secrets", async () => {
  const db = makeFullDb({
    configuration: {
      access_token: "enc:v1:whatever",
      phone_number_id: "123456789012345",
      auto_send_enabled: true,
      delivery_mode: "link",
      default_country_code: "44",
    },
    customerPhone: "+447700900124",
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (!String(url).includes("graph.facebook.com")) {
      throw new Error("non-Graph fetch attempted: " + String(url));
    }
    return { ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) };
  };
  try {
    const result = await dispatchWhatsAppInvoiceDelivery({
      db,
      saleId: "sale-1",
      companyId: "c1",
    });
    assert.equal(result.ok, false);
    assert.equal(result.outcome, "failed");
    // The failure audit row exists and is secret-free
    const auditJson = JSON.stringify(db.inserted.auditParams);
    assert.ok(auditJson.includes("failed"), "failure must be logged");
    assert.ok(!auditJson.includes("enc:v1"), "audit must not carry credential material");
    assert.ok(!auditJson.includes("+447700900124"), "full recipient number must not be logged");
  } finally {
    globalThis.fetch = original;
  }
});

test("no-customer-phone sale skips cleanly with no Graph call", async () => {
  const db = makeFullDb({
    configuration: {
      access_token: "enc:v1:x",
      phone_number_id: "123456789012345",
      auto_send_enabled: true,
    },
    customerPhone: null,
  });
  let graphCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    graphCalled = true;
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const result = await dispatchWhatsAppInvoiceDelivery({
      db,
      saleId: "sale-1",
      companyId: "c1",
    });
    assert.equal(result.outcome, "skipped");
    assert.equal(result.reason, "no_customer_phone");
    assert.equal(graphCalled, false, "no Graph call without a recipient");
  } finally {
    globalThis.fetch = original;
  }
});

test("pdf mode falls back to link delivery when the media upload fails", async () => {
  const db = makeFullDb({
    configuration: {
      access_token: "enc:v1:x",
      phone_number_id: "123456789012345",
      auto_send_enabled: true,
      delivery_mode: "pdf",
      default_country_code: "44",
    },
    customerPhone: "+447700900125",
  });
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    if (!u.includes("graph.facebook.com")) throw new Error("non-Graph fetch: " + u);
    calls.push(u);
    if (u.endsWith("/media")) {
      return { ok: false, status: 500, json: async () => ({ error: { message: "upload denied" } }) };
    }
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.PDF" }] }) };
  };
  try {
    const result = await dispatchWhatsAppInvoiceDelivery({
      db,
      saleId: "sale-1",
      companyId: "c1",
    });
    assert.equal(result.ok, true, "link fallback should deliver successfully");
    assert.equal(result.deliveryMode, "link", "effective mode becomes link after fallback");
    assert.equal(result.pdfFallback, true);
    const messageCalls = calls.filter((u) => u.endsWith("/messages"));
    assert.equal(messageCalls.length, 1, "exactly one message send (after the failed upload)");
    assert.ok(calls.some((u) => u.endsWith("/media")), "the media upload must have been attempted");
  } finally {
    globalThis.fetch = original;
  }
});
