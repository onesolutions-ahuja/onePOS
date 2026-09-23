import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import createLayawaysRouter, { LAYAWAY_PAYMENT_METHODS } from "../routes/layaways.js";
import { PAYMENT_METHODS } from "../routes/sales.js";

const USER = { id: "u-1", companyId: "co-1", storeId: "st-1" };

function appFor({ rows = [], permissions = ["layaway.view"] } = {}) {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql: String(sql), params });
    return { rows };
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = USER; next(); });
  const authorize = (...needed) => (_req, res, next) =>
    needed.some((permission) => permissions.includes(permission))
      ? next() : res.status(403).json({ success: false, message: "Forbidden" });
  app.use("/api", createLayawaysRouter({
    authenticate: (_req, _res, next) => next(),
    authorize,
    db,
    pool: null,
    createInventoryMovement: async () => {},
  }));
  return { app, calls };
}

test("layaway list is authenticated and scoped to the operator store", async () => {
  const { app, calls } = appFor({ rows: [{ id: "l-1" }] });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/layaways`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [{ id: "l-1" }]);
  assert.deepEqual(calls[0].params, [USER.companyId, USER.storeId]);
  server.close();
});

test("layaway write permissions are enforced", async () => {
  const { app } = appFor({ permissions: ["layaway.view"] });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/layaways`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ productId: "p-1", quantity: 1 }] }),
  });
  assert.equal(response.status, 403);
  server.close();
});

test("layaway cancellation requires its permission and only targets the current store", async () => {
  const { app, calls } = appFor({ permissions: ["layaway.cancel"], rows: [{ id: "l-1", status: "CANCELLED" }] });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/layaways/l-1/cancel`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].params, ["l-1", USER.companyId, USER.storeId]);
  server.close();
});

test("layaway uses the shared tender allow-list and authoritative catalogue pricing", () => {
  assert.deepEqual(LAYAWAY_PAYMENT_METHODS, PAYMENT_METHODS);
  const source = fs.readFileSync(new URL("../routes/layaways.js", import.meta.url), "utf8");
  assert.match(source, /const unitPrice = money\(p\.price\)/);
  assert.match(source, /Number\(p\.vat_rate \|\| 0\)/);
  assert.match(source, /receiptNumber = `\$\{prefix\}-\$\{dateKey\}/);
  assert.doesNotMatch(source, /item\.unitPrice == null/);
  assert.doesNotMatch(source, /item\.taxRate == null/);
});
