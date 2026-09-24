import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const audit = fs.readFileSync(new URL("../server/routes/audit.js", import.meta.url), "utf8");
const reports = fs.readFileSync(new URL("../server/routes/reports.js", import.meta.url), "utf8");
const auditUi = fs.readFileSync(new URL("../app/src/pages/audit/AuditLogAdmin.jsx", import.meta.url), "utf8");
const customUi = fs.readFileSync(new URL("../app/src/pages/reports/CustomReportsAdmin.jsx", import.meta.url), "utf8");

test("Batch 11 audit store placeholders advance after all assigned stores", () => {
  assert.match(audit, /userStoreIds\.forEach\(\(s\) => params\.push\(s\)\);[\s\S]*?idx = params\.length;/);
});

test("Batch 11 audit validates date filters and includes the selected to-day", () => {
  assert.match(audit, /Invalid from date/);
  assert.match(audit, /Invalid to date/);
  assert.match(audit, /setHours\(23, 59, 59, 999\)/);
});

test("Batch 11 platform-object report run does not enter legacy sales store scope first", () => {
  const run = reports.slice(reports.indexOf('router.post("/reports/custom/:id/run"'));
  assert.ok(run.indexOf('if (definition.dataSource === "platform_object")') < run.indexOf('const stores = await accessibleStores'));
});

test("Batch 11 keeps audit UI server-filtered and paginated", () => {
  assert.match(auditUi, /\/api\/audit-logs\?/);
  assert.match(auditUi, /params\.set\("limit"/);
  assert.match(auditUi, /params\.set\("offset"/);
});

test("Batch 11 custom reports remain metadata-driven and shareable", () => {
  assert.match(customUi, /platform_object/);
  assert.match(customUi, /updateCustomReportUsers/);
  assert.match(customUi, /previewCustomReport/);
});
