import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), "utf8");
const page = read("../src/pages/settings/Platform/ObjectPage.jsx");
const product = read("../src/pages/products/ProductFormModal.jsx");
const customer = read("../src/components/modals/CustomerFormModal.jsx");
const supplier = read("../src/pages/suppliers/SupplierFormModal.jsx");
const store = read("../src/pages/stores/StoresAdmin.jsx");
const user = read("../src/pages/settings/UserFormModal.jsx");

test("all business-object editors use the Platform metadata form runtime", () => {
  for (const source of [product, customer, supplier, store, user]) assert.match(source, /StandardObjectFormModal/);
  assert.match(product, /objectKey="product"/);
  assert.match(customer, /objectKey="customer"/);
  assert.match(supplier, /objectKey="supplier"/);
  assert.match(store, /objectKey="store"/);
  assert.match(user, /objectKey="employee"/);
});

test("ObjectPage has no module-managed/read-only CRUD exception", () => {
  assert.doesNotMatch(page, /SYSTEM_OBJECT_OPERATION_REQUIRED|moduleManagedObject|recordAdapter|owningModule/);
  assert.match(page, /\/api\/platform\/objects\/\$\{encodeURIComponent\(resolvedObjectKey\)\}\/records/);
});

test("system object forms do not own password or business CRUD fields", () => {
  assert.doesNotMatch(user, /type="password"|saveStoreAccess|PlatformExtensionFields|\/api\/admin\/users/);
  assert.doesNotMatch(product, /<input|<select|\/api\/products/);
  assert.doesNotMatch(customer, /<input|<select|\/api\/customers/);
  assert.doesNotMatch(supplier, /<input|<select|\/api\/suppliers/);
});
