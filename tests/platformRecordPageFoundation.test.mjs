import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ROUTE = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
const EDITOR = fs.readFileSync(new URL("../src/pages/settings/Platform/LayoutEditor.jsx", import.meta.url), "utf8");
const PAGE = fs.readFileSync(new URL("../src/pages/settings/Platform/ObjectPage.jsx", import.meta.url), "utf8");

test("related-record endpoint is relationship-driven and tenant/store scoped", () => {
  assert.match(ROUTE, /records\/:recordId\/related\/:relationshipKey/);
  assert.match(ROUTE, /platform_relationships/);
  assert.match(ROUTE, /appendSystemReadScope\(child, req, clauses, params\)/);
  assert.match(ROUTE, /LIMIT \$\$\{dataParams\.length - 1\} OFFSET/);
});

test("layout editor configures related-list columns, sorting, limits, and standard actions", () => {
  assert.match(EDITOR, /type: "related_list"/);
  assert.match(EDITOR, /sort_field/);
  assert.match(EDITOR, /sort_direction/);
  assert.match(EDITOR, /type: "action"/);
  assert.match(EDITOR, /create_related/);
  assert.match(EDITOR, /run_workflow/);
  assert.match(EDITOR, /call_function/);
});

test("record page uses the scoped related endpoint and generic create flow", () => {
  assert.match(PAGE, /\/related\/\$\{encodeURIComponent\(relationshipKey\)\}/);
  assert.match(PAGE, /encodeURIComponent\(key\)\}\/records/);
  assert.match(PAGE, /createRelatedRecord/);
  assert.match(PAGE, /onSelectRecord\?\.\(record, related\.relationship\?\.child_object_key\)/);
});

test("record page actions execute through the authenticated metadata-resolved route", () => {
  assert.match(ROUTE, /records\/:recordId\/actions\/:actionKey\/execute/);
  assert.match(ROUTE, /platform_layouts/);
  assert.match(ROUTE, /workflow\.execute/);
  assert.match(ROUTE, /functions\.execute/);
  assert.match(ROUTE, /executeWorkflowActions/);
  assert.match(ROUTE, /getRegisteredFunction/);
  assert.match(ROUTE, /appendSystemReadScope\(object, req, recordClauses, recordParams\)/);
  assert.match(PAGE, /actions\/\$\{encodeURIComponent\(actionKey\)\}\/execute/);
});
