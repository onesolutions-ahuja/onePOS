import test from "node:test";
import assert from "node:assert/strict";
import { validateCustomReportDefinition, buildCustomSalesQuery, CUSTOM_REPORT_FIELDS } from "../routes/reports.js";

const dateRange = { from: "2026-01-01", to: "2026-01-31" };

const buildSql = (definition) => buildCustomSalesQuery(definition, dateRange, [], []).sql;
const groupClause = (sql) => sql.match(/GROUP BY (.+?)(?:\s+ORDER BY|\s+LIMIT)/);

test("custom sales definitions accept allowlisted fields and grouping", () => {
  const definition = validateCustomReportDefinition({
    dataSource: "sales",
    fields: ["date", "store", "net_sales", "transactions"],
    filters: [{ field: "date", operator: "this_week" }],
    groupBy: ["date", "store"],
    sort: [{ field: "date", direction: "desc" }],
  });

  assert.deepEqual(definition.fields, ["date", "store", "net_sales", "transactions"]);
  assert.deepEqual(definition.groupBy, ["date", "store"]);
  assert.equal(definition.sort[0].direction, "desc");
});

test("custom definitions reject unsupported sources and executable-looking fields", () => {
  assert.throws(
    () => validateCustomReportDefinition({ dataSource: "sales; DROP TABLE sales", fields: ["date"] }),
    /Unsupported report data source/
  );
  assert.throws(
    () => validateCustomReportDefinition({ fields: ["date", "s.total"] }),
    /Select at least one valid report field/
  );
});

test("custom definitions reject invalid operators and grouping", () => {
  assert.throws(
    () => validateCustomReportDefinition({
      fields: ["date", "net_sales"],
      filters: [{ field: "store", operator: "contains", value: "store" }],
    }),
    /Invalid report filter operator/
  );
  assert.throws(
    () => validateCustomReportDefinition({ fields: ["net_sales"], groupBy: ["net_sales"] }),
    /Invalid grouping field/
  );
});

test("GROUP BY includes store name when store is selected", () => {
  const sql = buildSql({ fields: ["store", "net_sales"], groupBy: ["store"], filters: [], sort: [] });
  assert.ok(sql.includes("GROUP BY"), "Query should have GROUP BY");
  assert.ok(sql.includes("st.name"), "GROUP BY should include st.name");
});

test("GROUP BY includes store name even when not explicitly grouped (selected as field only)", () => {
  const sql = buildSql({ fields: ["date", "store", "net_sales", "transactions"], groupBy: ["date"], filters: [], sort: [] });
  assert.ok(sql.includes("GROUP BY"), "Query should have GROUP BY");
  const groupByMatch = groupClause(sql);
  assert.ok(groupByMatch, "Should have GROUP BY clause");
  const groupByClause = groupByMatch[1];
  assert.ok(groupByClause.includes("(s.created_at AT TIME ZONE c.timezone)::date"), "GROUP BY should include date expression");
  assert.ok(groupByClause.includes("st.name"), "GROUP BY should include st.name because store field is selected");
});

test("GROUP BY includes product name when product is selected", () => {
  const sql = buildSql({ fields: ["product", "net_sales"], groupBy: ["product"], filters: [], sort: [] });
  assert.ok(sql.includes("GROUP BY"), "Query should have GROUP BY");
  const groupByMatch = groupClause(sql);
  assert.ok(groupByMatch, "Should have GROUP BY clause");
  assert.ok(groupByMatch[1].includes("p.name"), "GROUP BY should include p.name");
});

test("GROUP BY includes product name even when not explicitly grouped", () => {
  const sql = buildSql({ fields: ["date", "product", "net_sales"], groupBy: ["date"], filters: [], sort: [] });
  const groupByMatch = groupClause(sql);
  assert.ok(groupByMatch, "Should have GROUP BY clause");
  assert.ok(groupByMatch[1].includes("(s.created_at AT TIME ZONE c.timezone)::date"), "GROUP BY should include date");
  assert.ok(groupByMatch[1].includes("p.name"), "GROUP BY should include p.name because product field is selected");
});

test("GROUP BY includes user expression when user is selected", () => {
  const sql = buildSql({ fields: ["user", "net_sales"], groupBy: ["user"], filters: [], sort: [] });
  const groupByMatch = groupClause(sql);
  assert.ok(groupByMatch, "Should have GROUP BY clause");
  assert.ok(groupByMatch[1].includes("COALESCE(u.full_name, u.username, 'Unknown')"), "GROUP BY should include user expression");
});

test("GROUP BY includes user expression even when not explicitly grouped", () => {
  const sql = buildSql({ fields: ["date", "user", "net_sales"], groupBy: ["date"], filters: [], sort: [] });
  const groupByMatch = groupClause(sql);
  assert.ok(groupByMatch, "Should have GROUP BY clause");
  assert.ok(groupByMatch[1].includes("COALESCE(u.full_name, u.username, 'Unknown')"), "GROUP BY should include user expression");
});

test("aggregate-only report has no GROUP BY", () => {
  const sql = buildSql({ fields: ["net_sales", "transactions"], groupBy: [], filters: [], sort: [] });
  assert.ok(!sql.includes("GROUP BY"), "Aggregate-only report should not have GROUP BY");
});

test("store name and date grouping together", () => {
  const sql = buildSql({ fields: ["date", "store", "net_sales"], groupBy: ["date", "store"], filters: [], sort: [] });
  const groupByMatch = groupClause(sql);
  assert.ok(groupByMatch, "Should have GROUP BY clause");
  assert.ok(groupByMatch[1].includes("(s.created_at AT TIME ZONE c.timezone)::date"), "GROUP BY should include date");
  assert.ok(groupByMatch[1].includes("st.name"), "GROUP BY should include store name");
});

test("filters combined with grouping include all groupable fields", () => {
  const sql = buildSql({
    fields: ["date", "store", "product", "net_sales", "transactions"],
    groupBy: ["date"],
    filters: [{ field: "store", operator: "equals", value: "store-1" }],
    sort: [],
  });
  const groupByMatch = groupClause(sql);
  assert.ok(groupByMatch, "Should have GROUP BY clause");
  assert.ok(groupByMatch[1].includes("(s.created_at AT TIME ZONE c.timezone)::date"), "GROUP BY should include date");
  assert.ok(groupByMatch[1].includes("st.name"), "GROUP BY should include store name");
  assert.ok(groupByMatch[1].includes("p.name"), "GROUP BY should include product name");
  assert.ok(sql.includes("s.store_id = $"), "Query should include store filter");
});

test("GROUP BY does not duplicate expressions", () => {
  const sql = buildSql({ fields: ["date", "store", "net_sales"], groupBy: ["store"], filters: [], sort: [] });
  const groupByMatch = groupClause(sql);
  assert.ok(groupByMatch, "Should have GROUP BY clause");
  const clause = groupByMatch[1];
  const stNameCount = (clause.match(/st\.name/g) || []).length;
  assert.equal(stNameCount, 1, "st.name should appear exactly once in GROUP BY");
});

test("SKU field is included in GROUP BY when selected", () => {
  const sql = buildSql({ fields: ["date", "sku", "net_sales"], groupBy: ["date"], filters: [], sort: [] });
  const groupByMatch = groupClause(sql);
  assert.ok(groupByMatch, "Should have GROUP BY clause");
  assert.ok(groupByMatch[1].includes("p.sku"), "GROUP BY should include p.sku");
});
