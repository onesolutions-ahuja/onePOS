import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const metadata = readFileSync(new URL("../services/platformMetadata.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../database/schema.sql", import.meta.url), "utf8");
const approvals = readFileSync(new URL("../services/platformApprovals.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");

test("approval metadata supports tenant processes, ordered role steps, requests and decisions", () => {
  for (const source of [metadata, schema]) {
    assert.match(source, /platform_approval_processes/);
    assert.match(source, /platform_approval_steps/);
    assert.match(source, /platform_approval_requests/);
    assert.match(source, /platform_approval_actions/);
  }
  assert.match(approvals, /role_id/);
  assert.match(approvals, /decision/);
  assert.match(approvals, /current_step/);
});

test("generic records submit matching approval processes and expose decisions", () => {
  assert.match(routes, /submitPlatformApproval/);
  assert.match(routes, /\/platform\/approval-processes/);
  assert.match(routes, /\/platform\/approval-requests\/:requestId\/decision/);
  assert.match(routes, /approvalStatus/);
});
