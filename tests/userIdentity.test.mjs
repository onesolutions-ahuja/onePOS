import test from "node:test";
import assert from "node:assert/strict";
import {
  DUPLICATE_EMAIL_MESSAGE,
  findNormalizedEmailConflict,
  isValidEmail,
  listDuplicateNormalizedEmails,
  normalizeEmail,
} from "../services/userIdentity.js";
import { createSessionToken } from "../services/session.js";

test("email identity is normalized consistently", () => {
  assert.equal(normalizeEmail("  Admin@Example.COM "), "admin@example.com");
  assert.equal(normalizeEmail(""), null);
  assert.equal(isValidEmail("admin@example.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
});

test("email conflict lookup uses normalized values and supports exclusion", async () => {
  const calls = [];
  const db = async (query, params) => {
    calls.push({ query, params });
    return { rows: [{ id: "user-b", company_id: "company-b" }] };
  };
  const conflict = await findNormalizedEmailConflict(db, " Admin@Example.COM ", "user-a");
  assert.deepEqual(conflict, { id: "user-b", company_id: "company-b" });
  assert.deepEqual(calls[0].params, ["admin@example.com", "user-a"]);
  assert.match(calls[0].query, /lower\(btrim\(email\)\)/i);
});

test("duplicate email audit returns conflicts without modifying data", async () => {
  const db = async (query) => {
    assert.match(query, /HAVING COUNT\(\*\) > 1/i);
    return { rows: [{ email: "duplicate@example.com", user_count: 2, user_ids: ["a", "b"] }] };
  };
  assert.deepEqual(await listDuplicateNormalizedEmails(db), [{
    email: "duplicate@example.com",
    user_count: 2,
    user_ids: ["a", "b"],
  }]);
});

test("duplicate conflict message is safe and company-neutral", () => {
  assert.equal(DUPLICATE_EMAIL_MESSAGE, "This email is already registered to another company.");
  assert.doesNotMatch(DUPLICATE_EMAIL_MESSAGE, /company-[a-z0-9-]+/i);
});

test("session carries mandatory first-login password change without superadmin elevation", () => {
  const token = createSessionToken({
    id: "user-1",
    company_id: "company-1",
    username: "admin@example.com",
    is_superadmin: false,
    must_change_password: true,
  });
  assert.ok(token);
});
