import test from "node:test";
import assert from "node:assert/strict";
import { getCompanyEntitlements, hasEntitlement, isPackageLicensed, mergeEntitlements, normaliseEntitlements, requireEntitlement } from "../services/licensing.js";

test("licensing normalises extensible entitlement keys", () => {
  assert.deepEqual(normaliseEntitlements({ loyalty: true, jarvis: false, "bad key": true, inventory: "yes" }), {
    loyalty: true,
    jarvis: false,
  });
  assert.equal(hasEntitlement(mergeEntitlements({ loyalty: true }), "loyalty"), true);
  assert.equal(hasEntitlement(mergeEntitlements({}), "jarvis"), false);
});

test("expired or inactive licences grant no entitlements", async () => {
  const db = async () => ({ rows: [{ active: false, starts_at: null, expires_at: null, entitlements: { loyalty: true } }] });
  assert.deepEqual(await getCompanyEntitlements(db, "company-a"), {});
});

test("active licence entitlements are company-scoped and extensible", async () => {
  const db = async () => ({ rows: [{ active: true, starts_at: null, expires_at: null, entitlements: { hospitality: true } }] });
  const entitlements = await getCompanyEntitlements(db, "company-a");
  assert.equal(entitlements.hospitality, true);
  assert.equal(entitlements.pos, true);
});

test("entitlement middleware allows licensed companies and denies unlicensed companies", async () => {
  const makeResponse = () => ({
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  });
  const licensed = requireEntitlement(async () => ({ rows: [{ active: true, starts_at: null, expires_at: null, entitlements: { loyalty: true } }] }), "loyalty");
  const allowedResponse = makeResponse();
  let allowed = false;
  await licensed({ user: { companyId: "a" } }, allowedResponse, () => { allowed = true; });
  assert.equal(allowed, true);

  const denied = requireEntitlement(async () => ({ rows: [{ active: true, starts_at: null, expires_at: null, entitlements: { loyalty: false } }] }), "loyalty");
  const deniedResponse = makeResponse();
  await denied({ user: { companyId: "b" } }, deniedResponse, () => {});
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.body.code, "FEATURE_NOT_LICENSED");
});

test("package licensing uses the package manifest entitlement without duplicating entitlement rules", () => {
  assert.equal(isPackageLicensed({ loyalty: true }, { manifest: { entitlementKey: "loyalty" } }), true);
  assert.equal(isPackageLicensed({ loyalty: false }, { manifest: { entitlementKey: "loyalty" } }), false);
  assert.equal(isPackageLicensed({}, { manifest: {} }), true);
});
