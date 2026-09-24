import test from "node:test";
import assert from "node:assert/strict";
import { domainAllowed, emailDomain, hashAccountToken } from "../services/accountPolicy.js";
import { getPlatformFunction } from "../services/platformFunctionRegistry.js";

test("domain-only policy requires exact configured email domain", () => {
  assert.equal(emailDomain(" User@OnePOS.com "), "onepos.com");
  assert.equal(domainAllowed("user@onepos.com", "onepos.com", true), true);
  assert.equal(domainAllowed("user@sub.onepos.com", "onepos.com", true), false);
  assert.equal(domainAllowed("user@example.com", "onepos.com", true), false);
  assert.equal(domainAllowed("user@example.com", "onepos.com", false), true);
});
test("account tokens are stored by deterministic hash rather than raw token", () => {
  assert.equal(hashAccountToken("abc"), hashAccountToken("abc"));
  assert.notEqual(hashAccountToken("abc"), "abc");
});
test("Batch 7 atomic capabilities are registered for workflow composition", () => {
  for (const key of ["user.domain.validate","account.registration.token.issue","account.password_reset.token.issue","policy.pending.list"]) assert.ok(getPlatformFunction(key), key);
});
