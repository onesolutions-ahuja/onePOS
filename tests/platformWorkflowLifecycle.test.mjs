import test from "node:test";
import assert from "node:assert/strict";
import { executePlatformAutomations } from "../services/platformAutomation.js";
import { decidePlatformApproval, submitPlatformApproval } from "../services/platformApprovals.js";

test("automation executes ordered actions with tenant scope and blocks recursion", async () => {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT * FROM platform_rules")) return { rows: [{ id: "rule-1", action: { match: "all", actions: [{ type: "set_field", field: "status", value: "ready" }, { type: "show_message", message: "Updated" }] }, conditions: [{ field: "name", operator: "equals", value: "Vehicle" }] }] };
    if (sql.startsWith("UPDATE")) return { rows: [{ status: "ready" }] };
    return { rows: [] };
  };
  const req = { user: { companyId: "company-a", storeId: "store-a" } };
  const result = await executePlatformAutomations({
    db,
    object: { id: "object-1", source_table: "vehicles", company_scoped: true, store_scoped: true },
    fields: [{ api_name: "name", field_type: "text", active: true }, { api_name: "status", field_type: "text", active: true, writable: true, source_column: "status" }],
    record: { id: "record-1", name: "Vehicle", status: "new" },
    recordId: "record-1",
    trigger: "after_create",
    req,
  });
  assert.deepEqual(result.messages, ["Updated"]);
  assert.equal(result.executions.length, 2);
  const update = calls.find((call) => call.sql.startsWith("UPDATE"));
  assert.deepEqual(update.params.slice(1), ["record-1", "company-a", "store-a"]);
  req._platformAutomationDepth = 1;
  const recursive = await executePlatformAutomations({ db, object: { id: "object-1" }, fields: [], record: {}, recordId: "record-1", trigger: "after_update", req });
  assert.deepEqual(recursive.executions, []);
});

test("approval submission is tenant scoped and does not duplicate pending requests", async () => {
  let inserts = 0;
  const db = async (sql, params) => {
    if (sql.startsWith("SELECT * FROM platform_approval_processes")) return { rows: [{ id: "process-1", conditions: { match: "all", conditions: [{ field: "status", operator: "equals", value: "pending" }] } }] };
    if (sql.startsWith("SELECT * FROM platform_approval_steps")) return { rows: [{ step_order: 1, role_id: "role-1" }] };
    if (sql.startsWith("SELECT id,status FROM platform_approval_requests")) return { rows: inserts ? [{ id: "request-1", status: "pending" }] : [] };
    if (sql.startsWith("INSERT INTO platform_approval_requests")) { inserts += 1; return { rows: [{ id: "request-1", status: "pending" }] }; }
    return { rows: [] };
  };
  const request = { user: { companyId: "company-a", id: "user-1" } };
  const args = { db, object: { id: "object-1" }, fields: [{ api_name: "status", field_type: "text", active: true }], recordId: "record-1", record: { status: "pending" }, req: request };
  assert.equal((await submitPlatformApproval(args)).id, "request-1");
  assert.equal((await submitPlatformApproval(args)).id, "request-1");
  assert.equal(inserts, 1);
});

test("approval decisions enforce role and move through ordered steps", async () => {
  let currentStep = 1;
  const actions = [];
  const db = async (sql, params) => {
    if (sql.startsWith("SELECT r.*")) return { rows: [{ id: "request-1", role_id: currentStep === 1 ? "role-1" : "role-2", step_order: currentStep, process_id: "process-1", status: "pending" }] };
    if (sql.startsWith("SELECT id FROM platform_approval_actions")) return { rows: [] };
    if (sql.startsWith("INSERT INTO platform_approval_actions")) { actions.push(params); return { rows: [] }; }
    if (sql.startsWith("SELECT step_order")) return { rows: currentStep === 1 ? [{ step_order: 2 }] : [] };
    if (sql.includes("current_step=$1")) { currentStep = params[0]; return { rows: [{ status: "pending", current_step: currentStep }] }; }
    if (sql.includes("status='approved'")) return { rows: [{ status: "approved", current_step: 2 }] };
    return { rows: [] };
  };
  const denied = await decidePlatformApproval({ db, requestId: "request-1", decision: "approve", req: { user: { companyId: "company-a", roleId: "role-x", id: "user-x" } } });
  assert.equal(denied.status, 403);
  const first = await decidePlatformApproval({ db, requestId: "request-1", decision: "approve", comment: "Checked", req: { user: { companyId: "company-a", roleId: "role-1", id: "user-1" } } });
  assert.equal(first.data.current_step, 2);
  const final = await decidePlatformApproval({ db, requestId: "request-1", decision: "approve", req: { user: { companyId: "company-a", roleId: "role-2", id: "user-2" } } });
  assert.equal(final.data.status, "approved");
  assert.equal(actions.length, 2);
});
