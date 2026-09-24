import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_ACTION_REGISTRY,
  getWorkflowActionDefinition,
  getRegisteredFunction,
  validateWorkflowAction,
  createWorkflowRun,
  createWorkflowStepRun,
  executeWorkflowAction,
} from "../services/platformWorkflow.js";
import { drainDuePlatformJobs } from "../services/platformJobs.js";

test("workflow action registry exposes the canonical advanced actions", () => {
  const keys = WORKFLOW_ACTION_REGISTRY.map((definition) => definition.key);
  assert.ok(keys.includes("CREATE_RECORD"));
  assert.ok(keys.includes("UPDATE_RECORD"));
  assert.ok(keys.includes("DELETE_RECORD"));
  assert.ok(keys.includes("ASSIGN_RECORD"));
  assert.ok(keys.includes("CALL_FUNCTION"));
  assert.ok(keys.includes("RUN_SUBFLOW"));
  assert.ok(keys.includes("WAIT"));
  assert.ok(keys.includes("STOP"));
  assert.ok(getWorkflowActionDefinition("CREATE_RECORD"));
});

test("unknown workflow actions are rejected", () => {
  assert.throws(() => validateWorkflowAction({ type: "NOT_REAL" }), /Unsupported workflow action/);
  assert.throws(() => validateWorkflowAction({ type: "SET_FIELD" }), /Set Field requires a field/);
});

test("registered functions allow safe execution and prevents arbitrary code", async () => {
  const func = getRegisteredFunction("safe_echo");
  assert.ok(func);
  const result = await executeWorkflowAction({
    action: { type: "CALL_FUNCTION", functionKey: "safe_echo", inputs: { value: "hello" } },
  });

  assert.deepEqual(result, { ok: true, value: "hello" });
  assert.equal(getRegisteredFunction("eval"), null);
});

test("workflow run and step run creation is durable and correlates job state", async () => {
  const inserts = [];
  const db = async (sql, params) => {
    inserts.push({ sql, params });
    return { rows: [{ id: "run-1", company_id: "company-1", workflow_id: "workflow-1" }] };
  };

  const run = await createWorkflowRun({
    db,
    companyId: "company-1",
    workflowId: "workflow-1",
    workflowName: "Order Ready",
    objectId: "object-1",
    recordId: "record-1",
    triggerKey: "after_update",
    metadata: { source: "test" },
  });

  assert.equal(run.id, "run-1");

  const step = await createWorkflowStepRun({
    db,
    runId: run.id,
    stepIdentifier: "step-1",
    stepOrder: 1,
    actionType: "SEND_SMS",
    status: "WAITING",
    metadata: { provider: "twilio" },
    jobId: "job-1",
  });
  assert.equal(step.id, "run-1");
  assert.equal(inserts.length >= 2, true);
});

test("wait and stop actions return durable execution states", async () => {
  let jobEnqueued = false;
  const db = async () => {
    jobEnqueued = true;
    return { rows: [{ id: "job-1" }] };
  };

  const waitResult = await executeWorkflowAction({
    db,
    action: { type: "WAIT", durationSeconds: 60 },
    companyId: "company-1",
    req: { user: { companyId: "company-1" } },
  });
  assert.equal(waitResult.status, "waiting");
  assert.equal(waitResult.jobId, "job-1");

  const stopResult = await executeWorkflowAction({ action: { type: "STOP", reason: "Manual stop" } });
  assert.equal(stopResult.status, "stopped");
  assert.equal(stopResult.reason, "Manual stop");
  assert.equal(jobEnqueued, true);
});

test("communication actions fail safely when their provider is not configured", async () => {
  const db = async (sql) => {
    if (/FROM integrations/i.test(sql)) {
      return { rows: [] };
    }
    return { rows: [{ id: "job-1" }] };
  };

  const emailResult = await executeWorkflowAction({
    db,
    action: { type: "SEND_EMAIL", recipient: "ops@example.com" },
    companyId: "company-1",
    req: { user: { companyId: "company-1" } },
  });
  assert.equal(emailResult.status, "failed");
  assert.equal(emailResult.error, "EMAIL provider not configured");

  const smsResult = await executeWorkflowAction({
    db,
    action: { type: "SEND_SMS", recipient: "+1234567890" },
    companyId: "company-1",
    req: { user: { companyId: "company-1" } },
  });
  assert.equal(smsResult.status, "failed");
  assert.equal(smsResult.error, "SMS provider not configured");

  const whatsappResult = await executeWorkflowAction({
    db,
    action: { type: "SEND_WHATSAPP", recipient: "+1234567890" },
    companyId: "company-1",
    req: { user: { companyId: "company-1" } },
  });
  assert.equal(whatsappResult.status, "failed");
  assert.equal(whatsappResult.error, "WHATSAPP provider not configured");
});

test("configured communication providers are accepted and subflows execute with depth protection", async () => {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM integrations/i.test(sql)) {
      return { rows: [{ provider: "sms", active: true, configuration: { account_sid: "123", auth_token: "secret" } }] };
    }
    if (/FROM platform_rules/i.test(sql)) {
      return { rows: [{ id: "sub-1", name: "Subflow", active: true, actions: [{ type: "SET_FIELD", field: "status", value: "done" }] }] };
    }
    if (/INSERT INTO platform_workflow_runs/i.test(sql)) {
      return { rows: [{ id: "child-run-1" }] };
    }
    if (/INSERT INTO platform_workflow_step_runs/i.test(sql)) {
      return { rows: [{ id: "step-1" }] };
    }
    if (/UPDATE platform_workflow_runs/i.test(sql)) {
      return { rows: [{ id: "child-run-1" }] };
    }
    if (/UPDATE platform_workflow_step_runs/i.test(sql)) {
      return { rows: [{ id: "step-1" }] };
    }
    return { rows: [{ id: "job-1" }] };
  };

  const queued = await executeWorkflowAction({
    db,
    action: { type: "SEND_SMS", recipient: "+1234567890" },
    companyId: "company-1",
    req: { user: { companyId: "company-1" } },
  });
  assert.equal(queued.status, "queued");
  assert.equal(queued.jobId, "job-1");

  const child = await executeWorkflowAction({
    db,
    action: { type: "RUN_SUBFLOW", workflowId: "sub-1", inputs: { value: "from-parent" } },
    companyId: "company-1",
    req: { user: { companyId: "company-1" } },
    record: { id: "record-1" },
    workflowDepth: 0,
    workflowStack: [],
  });
  assert.equal(child.status, "completed");
  assert.equal(child.workflowId, "sub-1");
  assert.equal(child.runId, "child-run-1");

  await assert.rejects(() => executeWorkflowAction({
    db,
    action: { type: "RUN_SUBFLOW", workflowId: "loop-1" },
    companyId: "company-1",
    req: { user: { companyId: "company-1" } },
    workflowDepth: 8,
    workflowStack: ["loop-1"],
  }), /Maximum workflow depth exceeded|Workflow recursion detected/);
  assert.ok(calls.length > 0);
});


test("workflow actions enforce the caller role permission", async () => {
    const deniedDb = async (sql) => /FROM role_permissions/i.test(sql) ? { rows: [] } : { rows: [] };
    await assert.rejects(
      executeWorkflowAction({
        db: deniedDb,
        req: { user: { id: "user-1", roleId: "role-1", companyId: "company-1" } },
        action: { type: "STOP", reason: "blocked" },
      }),
      /permission to execute/
    );

    const allowedDb = async (sql) => /FROM role_permissions/i.test(sql) ? { rows: [{ ok: 1 }] } : { rows: [] };
    const result = await executeWorkflowAction({
      db: allowedDb,
      req: { user: { id: "user-1", roleId: "role-1", companyId: "company-1" } },
      action: { type: "STOP", reason: "allowed" },
    });
    assert.equal(result.status, "stopped");
  });


test("durable job drain completes successes and retries failures", async () => {
    const updates = [];
    const db = async (sql, params) => {
      if (/WITH due/i.test(sql)) return { rows: [{ id: "job-1", kind: "TEST" }, { id: "job-2", kind: "TEST" }] };
      updates.push({ sql, params });
      return { rows: [{ id: params?.[0], status: /SET status='COMPLETED'/i.test(sql) ? "COMPLETED" : "PENDING" }] };
    };
    const result = await drainDuePlatformJobs({
      db,
      handler: async (job) => { if (job.id === "job-2") { const error = new Error("retry"); error.retryable = true; throw error; } },
    });
    assert.deepEqual(result.map((item) => item.status), ["COMPLETED", "PENDING"]);
    assert.equal(updates.length, 2);
  });

test("CALL_FUNCTION resolves canonical dotted record-path input bindings", async () => {
  const result = await executeWorkflowAction({
    action: { type: "CALL_FUNCTION", functionKey: "safe_echo", inputs: { value: { path: "sale.customer.email" } } },
    object: { object_key: "sale" },
    record: { customer: { email: "customer@example.com" } },
  });
  assert.deepEqual(result, { ok: true, value: "customer@example.com" });
});
