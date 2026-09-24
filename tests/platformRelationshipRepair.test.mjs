/*
 * Focused regression coverage for the Platform metadata bootstrap repairs:
 * self-referencing relationships, FK-ownership resolution, record-type
 * uniqueness and the record-association workflow actions.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RELATIONSHIP_LINK_OWNERS, platformSchema, resolveRelationshipLink } from "../services/platformMetadata.js";
import { executeWorkflowAction } from "../services/platformWorkflow.js";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const canonicalSchema = source("../database/schema.sql");

function linkQuery(fields) {
  return async (sql, params) => {
    if (!sql.startsWith("SELECT id, api_name, source_column FROM platform_fields")) throw new Error(`Unexpected SQL: ${sql}`);
    const [objectId, column] = params;
    return {
      rows: fields
        .filter((field) => field.object_id === objectId && (field.api_name === column || field.source_column === column))
        .sort((left, right) => Number(right.api_name === column) - Number(left.api_name === column)),
    };
  };
}

const field = (objectId, apiName, sourceColumn = apiName) => ({
  id: `${objectId}.${apiName}`,
  object_id: objectId,
  api_name: apiName,
  source_column: sourceColumn,
});

const relationshipTableBlock = (schema) => {
  const start = schema.indexOf("CREATE TABLE IF NOT EXISTS platform_relationships");
  assert.notEqual(start, -1, "platform_relationships table definition must exist");
  return schema.slice(start, schema.indexOf(");", start) + 2);
};

test("relationship schema allows self-references and migrates the constraint away", () => {
  for (const schema of [platformSchema, canonicalSchema]) {
    assert.doesNotMatch(relationshipTableBlock(schema), /parent_object_id\s*<>\s*child_object_id/);
    assert.match(schema, /DROP CONSTRAINT IF EXISTS platform_relationships_check/);
  }
});

test("record type uniqueness is enforced for global and tenant rows", () => {
  for (const schema of [platformSchema, canonicalSchema]) {
    assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_record_types_global\s*\n\s*ON platform_record_types\(object_id, record_type_key\) WHERE company_id IS NULL/);
    assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_record_types_tenant[\s\S]{0,80}WHERE company_id IS NOT NULL/);
    assert.match(schema, /FIRST_VALUE\(id\) OVER/);
  }
});

test("one_to_many relationships resolve the link field on the child object", async () => {
  const link = await resolveRelationshipLink({
    query: linkQuery([field("sale_line", "sale_id")]),
    relationshipType: "one_to_many",
    column: "sale_id",
    parent: { id: "sale", object_key: "sale" },
    child: { id: "sale_line", object_key: "sale_line" },
  });
  assert.equal(link.owner, RELATIONSHIP_LINK_OWNERS.CHILD);
  assert.equal(link.childFieldId, "sale_line.sale_id");
  assert.equal(link.mapped, true);
});

test("self-referencing one_to_many (sale -> original_transactions) resolves on the shared object", async () => {
  const sale = { id: "sale", object_key: "sale" };
  const link = await resolveRelationshipLink({
    query: linkQuery([field("sale", "original_transaction_id")]),
    relationshipType: "one_to_many",
    column: "original_transaction_id",
    parent: sale,
    child: sale,
  });
  assert.equal(link.owner, RELATIONSHIP_LINK_OWNERS.CHILD);
  assert.equal(link.childFieldId, "sale.original_transaction_id");
});

test("lookup relationships resolve the FK on the parent and never masquerade as a child field", async () => {
  const cases = [
    { parent: { id: "product", object_key: "product" }, child: { id: "category", object_key: "category" }, column: "category_id" },
    { parent: { id: "customer", object_key: "customer" }, child: { id: "price_list", object_key: "price_list" }, column: "price_list_id" },
    { parent: { id: "sale_line", object_key: "sale_line" }, child: { id: "product", object_key: "product" }, column: "product_id" },
  ];
  for (const current of cases) {
    const link = await resolveRelationshipLink({
      query: linkQuery([field(current.parent.id, current.column)]),
      relationshipType: "lookup",
      column: current.column,
      parent: current.parent,
      child: current.child,
    });

    assert.equal(link.owner, RELATIONSHIP_LINK_OWNERS.PARENT);
    assert.equal(link.mapped, true);
    assert.equal(link.childFieldId, null, `${current.parent.object_key} -> ${current.child.object_key} must not store a parent field as child_field_id`);
  }
});

test("unmapped link columns are reported instead of being guessed", async () => {
  const link = await resolveRelationshipLink({
    query: linkQuery([]),
    relationshipType: "lookup",
    column: "business_division_id",
    parent: { id: "store", object_key: "store" },
    child: { id: "business_division", object_key: "business_division" },
  });
  assert.equal(link.mapped, false);
  assert.equal(link.childFieldId, null);
  assert.equal(link.owner, null);
});

function relationshipDb(calls, { childFieldId = "field-1", updatedRows = 1 } = {}) {
  return async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT r.id, r.relationship_key")) {
      return {
        rows: [{
          id: "relationship-1",
          relationship_key: "lines",
          relationship_type: "one_to_many",
          child_field_id: childFieldId,
          parent_object_key: "sale",
          child_object_key: "sale_line",
          child_source_table: "sale_items",
          child_company_scoped: true,
          child_store_scoped: false,
        }],
      };
    }
    if (sql.startsWith("SELECT id, api_name, source_column FROM platform_fields")) {
      return { rows: [{ id: "field-1", api_name: "sale_id", source_column: "sale_id" }] };
    }
    if (sql.startsWith('UPDATE "sale_items"')) return { rows: Array.from({ length: updatedRows }, () => ({ id: params[1] })) };
    return { rows: [] };
  };
}

test("workflow record associations write the child foreign key instead of platform_relationships", async () => {
  const calls = [];
  const added = await executeWorkflowAction({
    db: relationshipDb(calls),
    action: { type: "ADD_RELATIONSHIP", relationshipKey: "lines", relatedRecordId: "line-1" },
    object: { id: "sale-object", object_key: "sale" },
    recordId: "sale-1",
    req: { user: { companyId: "company-a", storeId: "store-a" } },
  });
  assert.equal(added.status, "completed");
  assert.equal(added.linkField, "sale_id");
  const update = calls.find((call) => call.sql.startsWith('UPDATE "sale_items"'));
  assert.match(update.sql, /SET "sale_id"=\$1 WHERE id=\$2 AND company_id=\$3/);
  assert.deepEqual(update.params, ["sale-1", "line-1", "company-a"]);
  assert.equal(calls.some((call) => /(INSERT INTO|DELETE FROM) platform_relationships/i.test(call.sql)), false);
});

test("workflow record associations clear the link on removal and stay tenant scoped", async () => {
  const calls = [];
  const removed = await executeWorkflowAction({
    db: relationshipDb(calls),
    action: { type: "REMOVE_RELATIONSHIP", relationshipKey: "lines", relatedRecordId: "line-1" },
    object: { id: "sale-object", object_key: "sale" },
    req: { user: { companyId: "company-a" } },
  });
  assert.equal(removed.status, "completed");
  const update = calls.find((call) => call.sql.startsWith('UPDATE "sale_items"'));
  assert.match(update.sql, /SET "sale_id"=NULL WHERE id=\$1 AND company_id=\$2/);
  assert.deepEqual(update.params, ["line-1", "company-a"]);
  assert.equal(calls.some((call) => /DELETE FROM platform_relationships/i.test(call.sql)), false);
});

test("workflow record associations skip relationships that have no writable link field", async () => {
  const calls = [];
  const result = await executeWorkflowAction({
    db: relationshipDb(calls, { childFieldId: null }),
    action: { type: "ADD_RELATIONSHIP", relationshipKey: "category", relatedRecordId: "category-1" },
    object: { id: "product-object", object_key: "product" },
    recordId: "product-1",
    req: { user: { companyId: "company-a" } },
  });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /no writable child link field/);
  assert.equal(calls.some((call) => call.sql.startsWith('UPDATE "sale_items"')), false);
});
