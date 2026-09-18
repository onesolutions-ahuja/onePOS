/*
 * SMALL-TASK - session expiry + settings navigation tests.
 *
 * Session layer: the REAL services/session.js (same module server.js uses).
 * Settings navigation: static contract test over SettingsAdmin.jsx source,
 * asserting every section stays reachable after the grouped-tab redesign.
 *
 *   node --test tests/sessionAuth.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createSessionToken, createAuthenticate, signSessionPayload } from "../services/session.js";

/* ---------------------------------------------------------------- helpers */

function makeApp() {
  const app = express();
  app.use(express.json());
  app.get("/api/protected", createAuthenticate(), (req, res) => {
    res.json({ success: true, user: { id: req.user.id, companyId: req.user.companyId } });
  });
  return app;
}

const get = async (server, path, token) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, port: server.address().port };
}

const USER_ROW = {
  id: "u0000000-0000-4000-8000-000000000009",
  company_id: "a0000000-0000-4000-8000-000000000001",
  store_id: "c0000000-0000-4000-8000-000000000003",
  role_id: "r0000000-0000-4000-8000-000000000004",
  username: "kate",
};

/* ------------------------------------------------------- session: expiry */

describe("session layer (services/session.js - the code server.js runs)", () => {
  test("a valid token authenticates and exposes the session claims", async () => {
    const app = makeApp();
    const { server } = await listen(app);
    try {
      const token = createSessionToken(USER_ROW);
      const { status, body } = await get(server, "/api/protected", token);
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.user.id, USER_ROW.id);
      assert.equal(body.user.companyId, USER_ROW.company_id);
    } finally {
      server.close();
    }
  });

  test("an EXPIRED token is rejected with 401 and a session-expiry message", async () => {
    const app = makeApp();
    const { server } = await listen(app);
    try {
      // Expired 61 seconds ago - the same jwt.verify path the real
      // authenticate middleware runs; no silent extension exists.
      const expired = signSessionPayload(
        { id: USER_ROW.id, companyId: USER_ROW.company_id, username: USER_ROW.username },
        "10ms"
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const { status, body } = await get(server, "/api/protected", expired);
      assert.equal(status, 401);
      assert.match(body.message, /expired/i);
    } finally {
      server.close();
    }
  });

  test("a tampered/garbage token is rejected with 401", async () => {
    const app = makeApp();
    const { server } = await listen(app);
    try {
      const token = createSessionToken(USER_ROW);
      const tampered = token.slice(0, -4) + "zzzz";
      const { status, body } = await get(server, "/api/protected", tampered);
      assert.equal(status, 401);
      assert.match(body.message, /invalid or expired/i);
    } finally {
      server.close();
    }
  });

  test("a missing token is rejected with 401 'Authentication required'", async () => {
    const app = makeApp();
    const { server } = await listen(app);
    try {
      const { status, body } = await get(server, "/api/protected");
      assert.equal(status, 401);
      assert.match(body.message, /authentication required/i);
    } finally {
      server.close();
    }
  });

  test("token carries an expiry claim (exp) - sessions cannot live forever", async () => {
    // Decode without verify: the payload must carry a numeric exp claim.
    const token = createSessionToken(USER_ROW);
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    assert.equal(typeof payload.exp, "number");
    assert.ok(payload.exp > Date.now() / 1000, "exp must be in the future for a fresh token");
    const hours = (payload.exp - Date.now() / 1000) / 3600;
    assert.ok(hours > 11 && hours <= 12, `12h default expiry expected, got ${hours.toFixed(2)}h`);
  });
});

/* ---------------------------------------- settings navigation contract */

const fs = await import("node:fs");
const source = fs.readFileSync(
  new URL("../src/pages/settings/SettingsAdmin.jsx", import.meta.url),
  "utf8"
);

describe("Settings navigation contract (grouped tabs)", () => {
  const SECTIONS = [
    "General", "Company", "Store & Till", "Tax / VAT", "Payment Terminals",
    "Hardware", "Receipts", "Users & Permissions", "Integrations",
    "Online Platforms", "WhatsApp", "SMS Delivery", "Email Delivery",
  ];

  test("every existing settings section remains in the navigation", () => {
    for (const section of SECTIONS) {
      assert.ok(source.includes(`"${section}"`) || source.includes(`'${section}'`), `section missing: ${section}`);
    }
  });

  test("sections are grouped into compact groups, not one flat row of 13", () => {
    assert.match(source, /SETTING_GROUPS/);
    // Group labels count < section count proves grouping happened.
    const groupLabels = [...source.matchAll(/sections:\s*\[/g)].map((m) => m[0]);
    assert.ok(groupLabels.length > 0 && groupLabels.length < SECTIONS.length, "expected grouped tabs");
  });

  test("every section is rendered (render branches intact)", () => {
    // Explicit branches (tab === "X" && <Component/>) …
    const explicitSections = ["Store & Till", "Payment Terminals", "Hardware", "Integrations", "Online Platforms", "WhatsApp", "SMS Delivery", "Email Delivery", "Users & Permissions", "Receipts"];
    for (const section of explicitSections) {
      const pattern = new RegExp(`"${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" && <`);
      assert.match(source, pattern, `no render branch for: ${section}`);
    }
    // … and the array-based form branch covers General / Company / Tax-VAT.
    assert.match(source, /\["General", "Company", "Tax \/ VAT"\]\.includes\(tab\) && </);
  });

  test("initialTab still honours a deep link into any section", () => {
    assert.match(source, /tabs\.includes\(initialTab\)/);
  });
});
