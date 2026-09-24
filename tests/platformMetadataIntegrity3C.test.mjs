import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const canonicalEditors = [
  "app/src/pages/products/ProductFormModal.jsx",
  "app/src/components/modals/CustomerFormModal.jsx",
  "app/src/pages/suppliers/SupplierFormModal.jsx",
  "app/src/pages/settings/UserFormModal.jsx",
];

test("3C: business-object editors are metadata wrappers with no direct business CRUD endpoints", () => {
  for (const file of canonicalEditors) {
    const source = read(file);
    assert.match(source, /StandardObjectFormModal/);
    assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    assert.doesNotMatch(source, /\/api\/(?:products|customers|suppliers|admin\/users)/);
  }
});

test("3C: shared metadata form cannot inject a page-owned save implementation", () => {
  const source = read("app/src/components/platform/StandardObjectFormModal.jsx");
  assert.doesNotMatch(source, /\bonSave\b/);
  assert.match(source, /\/api\/platform\/objects\/\$\{encodeURIComponent\(objectKey\)\}\/records/);
  assert.match(source, /method: editing \? "PUT" : "POST"/);
});

test("3C: customer and supplier lifecycle toggles use canonical record commands", () => {
  const customer = read("app/src/pages/customers/CustomersAdmin.jsx");
  const supplier = read("app/src/pages/suppliers/SuppliersAdmin.jsx");
  assert.match(customer, /\/api\/platform\/objects\/customer\/records/);
  assert.match(supplier, /\/api\/platform\/objects\/supplier\/records/);
  assert.doesNotMatch(customer, /\/api\/customers\/\$\{customer\.id\}\/status/);
  assert.doesNotMatch(supplier, /\/api\/suppliers\/\$\{supplier\.id\}\/status/);
});

test("3C: record page action buttons execute only through registered metadata button runtime", () => {
  const source = read("app/src/pages/settings/Platform/ObjectPage.jsx");
  assert.match(source, /recordButtons\.map/);
  assert.match(source, /\/buttons\/\$\{encodeURIComponent\(button\.button_key\)\}\/execute/);
  assert.doesNotMatch(source, /recordAdapter|moduleManagedObject|SYSTEM_OBJECT_OPERATION_REQUIRED/);
});

test("3C: workflow and approval remain registered platform metadata, not object-page business logic", () => {
  const page = read("app/src/pages/settings/Platform/ObjectPage.jsx");
  const route = read("server/routes/platform.js");
  assert.doesNotMatch(page, /switch\s*\(.*(?:product|customer|supplier|employee)/s);
  assert.match(route, /platform_rules/);
  assert.match(route, /approval/i);
});
