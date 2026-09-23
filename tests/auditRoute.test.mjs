import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("GET /api/audit-logs is created and gated by audit.view", () => {
  const source = fs.readFileSync(new URL("../routes/audit.js", import.meta.url), "utf8");
  assert.match(source, /createAuditRouter/);
  assert.match(source, /authorize\("audit\.view"\)/);
  assert.match(source, /router\.get\([\s\S]*?\/audit-logs/);
});

test("audit route is wired into server.js", () => {
  const source = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(source, /createAuditRouter/);
  assert.match(source, /"\/api",\s*createAuditRouter/);
});

test("audit.view permission is seeded in the database init", () => {
  const source = fs.readFileSync(new URL("../database/init.js", import.meta.url), "utf8");
  assert.match(source, /audit\.view/);
});

test("AuditLogAdmin frontend page exists and is gated by audit.view in AdminLayout", () => {
  const adminSource = fs.readFileSync(new URL("../src/pages/admin/AdminLayout.jsx", import.meta.url), "utf8");
  assert.match(adminSource, /AuditLogAdmin/);
  assert.match(adminSource, /audit\.view/);
});
