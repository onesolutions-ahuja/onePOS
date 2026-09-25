import test from "node:test";
import assert from "node:assert/strict";
import { executeWorkflowAction } from "../services/platformWorkflow.js";

const companyA = "company-a";
const companyB = "company-b";
const objectA = {
  id: "object-a",
  object_key: "ledger_entries",
  source_table: "ledger_entries",
  company_id: companyA,
  company_scoped: true,
  store_scoped: true,
};
const objectB = { ...objectA, id: "object-b", company_id: companyB };

function database({ allowCompanyB = false } = {}) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("FROM platform_objects")) {
      const requestedCompany = params[1];
      const requestedObject = params[0];
      if (requestedCompany === companyA && (requestedObject === objectA.id || requestedObject === objectA.object_key)) return { rows: [objectA] };
      if (allowCompanyB && requestedCompany === companyB && requestedObject === objectB.id) return { rows: [objectB] };
      return { rows: [] };
    }
    if (sql.includes("FROM platform_fields")) {
      return { rows: [{ api_name: "amount", source_column: "amount", writable: true, active: true }] };
    }
    if (sql.includes("information_schema.columns")) return { rows: [{ "?column?": 1 }] };
    if (sql.startsWith("INSERT INTO") || sql.startsWith("UPDATE") || sql.startsWith("DELETE")) {
      return { rows: [{ id: "record-a", amount: 10 }] };
    }
    return { rows: [] };
  };
  return { db, calls };
}

function context(db, action) {
  return {
    db,
    action,
    object: objectA,
    req: { user: { companyId: companyA, storeId: "store-a" } },
    companyId: companyA,
  };
}

for (const type of ["CREATE_RECORD", "UPDATE_RECORD", "DELETE_RECORD"]) {
  test(`Company A ${type} rejects a Company B object before mutation`, async () => {
    const { db, calls } = database();
    const action = type === "CREATE_RECORD"
      ? { type, objectId: objectB.id, fieldValues: { amount: 10 } }
      : { type, objectId: objectB.id, recordId: "record-b", fieldValues: { amount: 10 } };
    await assert.rejects(() => executeWorkflowAction(context(db, action)), /not available|not permitted/);
    assert.equal(calls.filter((call) => /^(INSERT|UPDATE|DELETE)/.test(call.sql)).length, 0);
  });
}

test("forged object UUID and raw table references are rejected", async () => {
  const { db, calls } = database();
  await assert.rejects(
    () => executeWorkflowAction(context(db, { type: "UPDATE_RECORD", objectId: "forged-object", recordId: "record-a", fieldValues: { amount: 10 } })),
    /not available/
  );
  await assert.rejects(
    () => executeWorkflowAction(context(db, { type: "CREATE_RECORD", sourceTable: "ledger_entries", fieldValues: { amount: 10 } })),
    /target tables must be resolved/
  );
  assert.equal(calls.filter((call) => /^(INSERT|UPDATE|DELETE)/.test(call.sql)).length, 0);
});

test("same object key resolves only the active company's metadata", async () => {
  const { db, calls } = database({ allowCompanyB: true });
  const result = await executeWorkflowAction(context(db, {
    type: "CREATE_RECORD",
    objectKey: objectA.object_key,
    fieldValues: { amount: 10 },
  }));
  assert.equal(result.status, "completed");
  const objectLookup = calls.find((call) => call.sql.includes("FROM platform_objects"));
  assert.equal(objectLookup.params[1], companyA);
  assert.equal(calls.some((call) => call.sql.startsWith('INSERT INTO "ledger_entries"')), true);
});

test("same-tenant workflow actions remain operational", async () => {
  for (const action of [
    { type: "CREATE_RECORD", objectId: objectA.id, fieldValues: { amount: 10 } },
    { type: "UPDATE_RECORD", objectId: objectA.id, recordId: "record-a", fieldValues: { amount: 20 } },
    { type: "DELETE_RECORD", objectId: objectA.id, recordId: "record-a" },
  ]) {
    const { db } = database();
    const result = await executeWorkflowAction(context(db, action));
    assert.equal(result.status, "completed");
  }
});
