import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executeRegisteredAction } from "../services/platformActions.js";

const platformRoutes = readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");

function dbFor({ entitlement = true, provider = true, permission = true } = {}) {
  return async (sql) => {
    if (/FROM companies/i.test(sql)) return { rows: [{ active: true, entitlements: { "communications.email": entitlement, "communications.sms": entitlement, "communications.whatsapp": entitlement } }] };
    if (/FROM integrations/i.test(sql)) return { rows: provider ? [{ active: true, configuration: { endpoint: "https://provider.test/send", api_key: "secret", from: "onepos" } }] : [] };
    if (/FROM role_permissions/i.test(sql)) return { rows: permission ? [{ ok: 1 }] : [] };
    return { rows: [] };
  };
}

test("registered communication action returns unavailable when entitlement is revoked", async () => {
  const result = await executeRegisteredAction({ db: dbFor({ entitlement: false }), companyId: "company-a", action: { type: "SEND_EMAIL", to: "a@example.com", body: "hello" } });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.code, "ENTITLEMENT_REQUIRED");
});

test("registered communication action denies missing permission", async () => {
  const result = await executeRegisteredAction({ db: dbFor({ permission: false }), companyId: "company-a", req: { user: { roleId: "role-a" } }, action: { type: "SEND_EMAIL", to: "a@example.com", body: "hello" } });
  assert.equal(result.code, "PERMISSION_DENIED");
});

test("in-app notification is delivered through the shared action handler", async () => {
  const inserts = [];
  const db = async (sql, params) => {
    inserts.push({ sql, params });
    return { rows: [{ active: true, entitlements: {} }] };
  };
  const result = await executeRegisteredAction({ db, companyId: "company-a", userId: "user-a", action: { type: "SEND_IN_APP_NOTIFICATION", title: "Ready", message: "Done" } });
  assert.equal(result.status, "SUCCESS");
  assert.match(inserts[0].sql, /platform_notifications/);
});

test("email action invokes configured provider without exposing credentials", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = options;
    return { ok: true, status: 202, json: async () => ({ id: "provider-1" }) };
  };
  try {
    const result = await executeRegisteredAction({ db: dbFor(), companyId: "company-a", action: { type: "SEND_EMAIL", to: "a@example.com", body: "hello" } });
    assert.equal(result.status, "SUCCESS");
    assert.equal(request.body.includes("secret"), false);
    assert.ok(request.headers.Authorization);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("record actions are layout-scoped and permission checked before execution", () => {
  assert.match(platformRoutes, /records\/:recordId\/actions\/:actionKey\/execute/);
  assert.match(platformRoutes, /Configured record action not found/);
  assert.match(platformRoutes, /workflow\.execute/);
  assert.match(platformRoutes, /functions\.execute/);
  assert.match(platformRoutes, /You do not have permission to execute this action/);
});
