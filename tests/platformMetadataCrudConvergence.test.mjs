import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('core business object editors converge on the metadata form runtime', () => {
  const product = read('src/pages/products/ProductFormModal.jsx');
  const supplier = read('src/pages/suppliers/SupplierFormModal.jsx');
  const customers = read('src/pages/customers/CustomersAdmin.jsx');
  const stores = read('src/pages/stores/StoresAdmin.jsx');
  for (const source of [product, supplier, customers, stores]) {
    assert.match(source, /StandardObjectFormModal/);
    assert.doesNotMatch(source, /PlatformExtensionFields/);
  }
});

test('product operational fields are metadata fields rather than hard-coded form controls', () => {
  const metadata = read('services/platformMetadata.js');
  const product = read('src/pages/products/ProductFormModal.jsx');
  assert.match(metadata, /\["image_url", "Image", "text", "image_url", false\]/);
  assert.match(metadata, /\["available_on_uber", "Available on Uber", "boolean", "available_on_uber", false\]/);
  assert.match(metadata, /\["available_on_deliveroo", "Available on Deliveroo", "boolean", "available_on_deliveroo", false\]/);
  assert.doesNotMatch(product, /type="file"|Look up EAN|Product operations|Opening stock/);
});

test('supplier admin has no shadow local form/detail implementation', () => {
  const source = read('src/pages/suppliers/SuppliersAdmin.jsx');
  assert.doesNotMatch(source, /function SupplierFormModal\(/);
  assert.doesNotMatch(source, /function SupplierDetailModal\(/);
});

test('customer admin has no shadow local CRUD form implementation', () => {
  const source = read('src/pages/customers/CustomersAdmin.jsx');
  assert.doesNotMatch(source, /function CustomerAdminForm\(/);
});
