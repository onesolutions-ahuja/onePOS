import test from "node:test";
import assert from "node:assert/strict";
import { createAuditWriter } from "../services/auditLog.js";

test("writeAudit accepts the legacy positional signature", async () => {
  let captured;
  const db = async (sql, params) => {
    captured = { sql, params };
    /* user-existence check returns a row so actor is kept */
    if (sql.startsWith("SELECT 1 FROM users")) return { rows: [{ id: params[0] }] };
    return { rows: [] };
  };
  const write = createAuditWriter({ db });
  await write("comp-1", "user-1", "product.updated", "product", "prod-1", { name: "X" });
  assert.match(captured.sql, /INSERT INTO audit_logs/);
  assert.equal(captured.params[0], "comp-1");
  assert.equal(captured.params[1], "user-1");
  assert.equal(captured.params[2], "product.updated");
  assert.equal(captured.params[3], "product");
  assert.equal(captured.params[4], "prod-1");
  assert.equal(captured.params[11], "success"); /* result column */
});

test("writeAudit.object accepts a rich object with store/terminal/session/ip", async () => {
  let captured;
  const db = async (sql, params) => {
    captured = { sql, params };
    return { rows: [{ id: "user-1" }] }; /* user exists */
  };
  const write = createAuditWriter({ db });
  await write.object({
    companyId: "comp-1",
    userId: "user-1",
    action: "price_override",
    entityType: "sale",
    entityId: "sale-1",
    storeId: "store-1",
    terminalId: "term-1",
    sessionId: "sess-1",
    ipAddress: "127.0.0.1",
    actorUsername: "cashier",
    result: "success",
    metadata: { oldPrice: 5, newPrice: 4 },
  });
  assert.equal(captured.params[1], "user-1"); /* verified user kept */
  assert.equal(captured.params[5], "store-1"); /* store_id */
  assert.equal(captured.params[6], "term-1");  /* terminal_id */
  assert.equal(captured.params[7], "sess-1");  /* session_id */
  assert.equal(captured.params[8], "127.0.0.1");/* ip_address */
  assert.equal(captured.params[9], "cashier"); /* actor_username */
  const details = JSON.parse(captured.params[10]);
  assert.equal(details.newPrice, 4);
  assert.equal(captured.params[11], "success"); /* result */
});

test("writeAudit nulls unknown user_id instead of failing the FK", async () => {
  let captured;
  const db = async (sql, params) => {
    captured = { sql, params };
    if (sql.includes("SELECT 1 FROM users")) return { rows: [] }; /* unknown user */
    return { rows: [] };
  };
  const write = createAuditWriter({ db });
  await write("comp-1", "deleted-user", "settings.updated", "company", "comp-1", {});
  assert.equal(captured.params[1], null); /* actor nulled */
});

test("writeAudit scrubs sensitive keys before persistence", async () => {
  let captured;
  const db = async (sql, params) => {
    captured = { sql, params };
    return { rows: [{ id: "user-1" }] };
  };
  const write = createAuditWriter({ db });
  await write("comp-1", "user-1", "auth.login", "user", "user-1", {
    password: "s3cret",
    card_number: "4111111111111111",
    cvc: "123",
    safeField: "ok",
    nested: { pin: "0000", label: "good" },
  });
  const details = JSON.parse(captured.params[10]);
  assert.equal(Object.keys(details).sort().join(","), "nested,safeField");
});

test("writeAudit swallows DB failures and reports via onError", async () => {
  const errors = [];
  const db = async () => { throw new Error("connection lost"); };
  const write = createAuditWriter({
    db,
    onError: (e) => errors.push(e),
  });
  await write("comp-1", "user-1", "product.deleted", "product", "prod-1", {});
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /connection lost/);
});
