import test from "node:test";
import assert from "node:assert/strict";
import { enqueuePlatformJob, failPlatformJob } from "../services/platformJobs.js";

test("platform jobs are idempotent per tenant", async () => {
  const calls = [];
  const db = async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: "job-1" }] }; };
  const job = await enqueuePlatformJob({ db, companyId: "company-1", kind: "SEND_EMAIL", payload: { templateId: "t1" }, idempotencyKey: "rule-1:record-1" });
  assert.equal(job.id, "job-1");
  assert.match(calls[0].sql, /ON CONFLICT \(company_id,idempotency_key\)/);
});

test("platform job failures preserve retry state and bounded attempts", async () => {
  let params;
  const db = async (_sql, values) => { params = values; return { rows: [{ id: "job-1", status: "PENDING" }] }; };
  const result = await failPlatformJob({ db, id: "job-1", error: new Error("provider unavailable"), retryable: true });
  assert.equal(result.status, "PENDING");
  assert.equal(params[2], true);
  assert.equal(params[3], 5);
});
