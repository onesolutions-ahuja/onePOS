/*
 * Unit-style Node checks for src/services/integrationFieldCatalogue.js (T9E).
 * Run: node scripts/integrationFieldCatalogue.test.mjs
 */
import assert from 'node:assert/strict';
import { getIntegrationFieldCatalogue } from '../src/services/integrationFieldCatalogue.js';

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  passed += 1;
  console.log(`ok - ${name}`);
}

const catalogue = getIntegrationFieldCatalogue();
const byPath = new Map(catalogue.map((entry) => [entry.path, entry]));

const expectedSales = [
  'sales.sale_id',
  'sales.receipt_number',
  'sales.total',
  'sales.subtotal',
  'sales.tax',
  'sales.discount',
  'sales.payment_method',
  'sales.customer.name',
  'sales.customer.address.postcode',
  'sales.items[].product.name',
  'sales.items[].product.sku',
  'sales.items[].product.ean',
  'sales.items[].quantity',
  'sales.items[].unit_price',
  'sales.items[].total',
];
const expectedPurchase = [
  'purchase.purchase_id',
  'purchase.reference_number',
  'purchase.purchase_date',
  'purchase.supplier.name',
  'purchase.items[].product.name',
  'purchase.items[].product.sku',
  'purchase.items[].product.ean',
  'purchase.items[].quantity',
  'purchase.items[].unit_cost',
  'purchase.items[].total',
];

for (const path of expectedSales) {
  assert.ok(byPath.has(path), `missing sales field: ${path}`);
  passed += 1;
  console.log(`ok - sales field present: ${path}`);
}
for (const path of expectedPurchase) {
  assert.ok(byPath.has(path), `missing purchase field: ${path}`);
  passed += 1;
  console.log(`ok - purchase field present: ${path}`);
}

// All paths unique.
check('unique paths', new Set(catalogue.map((e) => e.path)).size, catalogue.length);

// Array flag matches [] notation exactly.
check(
  'array flag matches []',
  catalogue.every((e) => e.array === e.path.includes('[]')),
  true
);
check(
  'known array entries flagged',
  ['sales.items[].quantity', 'purchase.items[].product.ean'].every(
    (p) => byPath.get(p).array === true
  ),
  true
);
check(
  'known scalar entries not flagged',
  ['sales.total', 'purchase.supplier.name'].every(
    (p) => byPath.get(p).array === false
  ),
  true
);

// Entry shape: exact keys with valid label/type/selectable.
const validTypes = new Set(['string', 'number', 'date']);
assert.ok(
  catalogue.every(
    (e) =>
      Object.keys(e).sort().join(',') === 'array,label,path,selectable,type' &&
      typeof e.label === 'string' &&
      e.label.trim().length > 0 &&
      validTypes.has(e.type) &&
      e.selectable === true
  ),
  'entry shape invalid'
);
passed += 1;
console.log('ok - entry shape valid');

// Mutation protection: callers get fresh copies each time.
const first = getIntegrationFieldCatalogue();
first[0].path = 'MUTATED';
first.pop();
const second = getIntegrationFieldCatalogue();
check('shared catalogue immune to mutation', second.length, catalogue.length);
check('first entry intact', second[0].path, catalogue[0].path);
check('fresh array identity', first !== second, true);

console.log(`\nAll ${passed} catalogue checks passed.`);
