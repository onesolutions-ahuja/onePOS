import test from "node:test";
import assert from "node:assert/strict";
import { executeWorkflowActions, WorkflowExecutionError } from "../services/platformWorkflow.js";

function fakeDb() {
  const calls = [];
  const steps = new Map();
  const compensations = new Set();
  let sequence = 0;
  return {
    calls,
    db: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/SELECT \* FROM platform_workflow_step_runs/.test(sql)) {
        const step = steps.get(`${params[0]}:${params[1]}`);
        return { rows: step ? [step] : [] };
      }
      if (/INSERT INTO platform_workflow_step_runs/.test(sql)) {
        const row = { id: `step-${++sequence}`, run_id: params[0], step_identifier: params[1], status: params[4], metadata: JSON.parse(params[5]) };
        steps.set(`${params[0]}:${params[1]}`, row);
        return { rows: [row] };
      }
      if (/SELECT id,status FROM platform_workflow_compensation_runs/.test(sql)) {
        return { rows: compensations.has(`${params[0]}:${params[1]}`) ? [{ id: "comp-1", status: "COMPLETED" }] : [] };
      }
      if (/INSERT INTO platform_workflow_compensation_runs/.test(sql)) {
        compensations.add(`${params[0]}:${params[1]}`);
        return { rows: [{ id: `comp-${++sequence}` }] };
      }
      if (/UPDATE platform_workflow_step_runs/.test(sql)) {
        const row = [...steps.values()].find((candidate) => candidate.id === params[3]);
        if (row) {
          row.status = params[0];
          row.metadata = { ...(row.metadata || {}), ...JSON.parse(params[2]) };
        }
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    },
  };
}

test("ordered execution stops on the first failure and preserves the root error", async () => {
  const { db } = fakeDb();
  await assert.rejects(
    () => executeWorkflowActions({
      db,
      runId: "run-1",
      companyId: "company-1",
      actions: [
        { id: "one", type: "SHOW_MESSAGE", message: "one" },
        { id: "two", type: "CALL_FUNCTION", functionKey: "missing" },
        { id: "three", type: "SHOW_MESSAGE", message: "must not run" },
      ],
    }),
    (error) => error instanceof WorkflowExecutionError && /not registered/.test(error.message)
  );
});

test("explicit compensation is attempted once and failures remain separate from the root error", async () => {
  const { db, calls } = fakeDb();
  const actions = [
    { id: "one", type: "SHOW_MESSAGE", message: "one", compensation: { type: "CALL_FUNCTION", functionKey: "missing" } },
    { id: "two", type: "CALL_FUNCTION", functionKey: "missing" },
  ];
  let first;
  await assert.rejects(() => executeWorkflowActions({ db, runId: "run-2", companyId: "company-1", actions }), (error) => {
    first = error;
    return error.compensationFailures.length === 1 && /not registered/.test(error.message);
  });
  await assert.rejects(() => executeWorkflowActions({ db, runId: "run-2", companyId: "company-1", actions }), (error) => {
    assert.equal(error instanceof WorkflowExecutionError, true);
    assert.deepEqual(error.compensationFailures || [], []);
    return true;
  });
  assert.equal(calls.filter((call) => /INSERT INTO platform_workflow_compensation_runs/.test(call.sql)).length, 1);
  assert.ok(first.details.message);
});

test("external communication is retained as irreversible and job keys are stable", async () => {
  const { db } = fakeDb();
  const calls = [];
  const jobDb = async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM integrations/.test(sql)) return { rows: [{ provider: "sms", active: true, configuration: { api_key: "configured" } }] };
    if (/INSERT INTO platform_action_jobs/.test(sql)) return { rows: [{ id: "job-1" }] };
    return { rows: [] };
  };
  const result = await executeWorkflowActions({
    db: jobDb,
    runId: null,
    companyId: "company-1",
    actions: [{ id: "message-1", type: "SEND_SMS", recipient: "+10000000000" }],
  });
  assert.equal(result[0].result.status, "queued");
  assert.match(calls.find((call) => /INSERT INTO platform_action_jobs/.test(call.sql)).params[4], /message-1/);
  void db;
});
