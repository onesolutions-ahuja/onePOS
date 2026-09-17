/*
 * Unit-style Node checks for src/services/integrationPayloadBuilder.js (T9C).
 * Run: node scripts/integrationPayloadBuilder.test.mjs
 */
import assert from 'node:assert/strict';
import { buildPayload } from '../src/services/integrationPayloadBuilder.js';

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  passed += 1;
  console.log(`ok - ${name}`);
}

const saleSource = {
  sales: {
    receipt_number: 'R-1001',
    total: 125.5,
    customer: { name: 'Jane Doe', address: { postcode: 'E16 1AA' } },
    items: [
      { product: { sku: 'SKU-1', ean: '5012345678901' }, quantity: 2 },
      { product: { sku: 'SKU-2', ean: '5012345678902' }, quantity: 5 },
    ],
  },
};

// Spec example: flat + nested + array partner fields.
check(
  'spec example payload',
  buildPayload(saleSource, [
    { partnerField: 'invoice_number', sourcePath: 'sales.receipt_number' },
    { partnerField: 'customer_name', sourcePath: 'sales.customer.name' },
    { partnerField: 'postcode', sourcePath: 'sales.customer.address.postcode' },
    { partnerField: 'total', sourcePath: 'sales.total' },
    { partnerField: 'items[].sku', sourcePath: 'sales.items[].product.sku' },
    { partnerField: 'items[].quantity', sourcePath: 'sales.items[].quantity' },
  ]),
  {
    invoice_number: 'R-1001',
    customer_name: 'Jane Doe',
    postcode: 'E16 1AA',
    total: 125.5,
    items: [
      { sku: 'SKU-1', quantity: 2 },
      { sku: 'SKU-2', quantity: 5 },
    ],
  }
);

// Nested partner output.
check(
  'nested partner paths',
  buildPayload(saleSource, [
    { partnerField: 'invoice.number', sourcePath: 'sales.receipt_number' },
    { partnerField: 'customer.name', sourcePath: 'sales.customer.name' },
    { partnerField: 'customer.address.postcode', sourcePath: 'sales.customer.address.postcode' },
  ]),
  {
    invoice: { number: 'R-1001' },
    customer: { name: 'Jane Doe', address: { postcode: 'E16 1AA' } },
  }
);

// Purchase item arrays stay aligned by index.
const purchaseSource = {
  purchase: {
    supplier: { name: 'Acme Foods' },
    items: [
      { quantity: 2, product: { name: 'Cola 330ml', ean: '5012345678901' } },
      { quantity: 5, product: { name: 'Crisps', ean: '5012345678902' } },
      { quantity: 1, product: null },
    ],
  },
};
check(
  'aligned purchase arrays',
  buildPayload(purchaseSource, [
    { partnerField: 'supplier_name', sourcePath: 'purchase.supplier.name' },
    { partnerField: 'lines[].quantity', sourcePath: 'purchase.items[].quantity' },
    { partnerField: 'lines[].name', sourcePath: 'purchase.items[].product.name' },
    { partnerField: 'lines[].ean', sourcePath: 'purchase.items[].product.ean' },
  ]),
  {
    supplier_name: 'Acme Foods',
    lines: [
      { quantity: 2, name: 'Cola 330ml', ean: '5012345678901' },
      { quantity: 5, name: 'Crisps', ean: '5012345678902' },
      { quantity: 1, name: null, ean: null },
    ],
  }
);

// Missing fields, null relationships and invalid mappings.
check(
  'missing scalars become null',
  buildPayload(saleSource, [
    { partnerField: 'missing', sourcePath: 'sales.nope' },
    { partnerField: 'nested.missing', sourcePath: 'sales.customer.phone' },
  ]),
  { missing: null, nested: { missing: null } }
);
check(
  'null relationship never throws',
  buildPayload({ sales: { customer: null, items: null } }, [
    { partnerField: 'customer_name', sourcePath: 'sales.customer.name' },
    { partnerField: 'items[].sku', sourcePath: 'sales.items[].product.sku' },
  ]),
  { customer_name: null, items: [] }
);
check(
  'invalid mappings skipped safely',
  buildPayload(saleSource, [
    null,
    'nope',
    { partnerField: '', sourcePath: 'sales.total' },
    { partnerField: 'total', sourcePath: '' },
    { partnerField: 'total', sourcePath: null },
    { partnerField: 'total', sourcePath: 'sales.total' },
  ]),
  { total: 125.5 }
);
check('non-array mappings returns object', buildPayload(saleSource, null), {});
check(
  'input source not mutated',
  (() => {
    const before = JSON.stringify(saleSource);
    buildPayload(saleSource, [
      { partnerField: 'items[].sku', sourcePath: 'sales.items[].product.sku' },
    ]);
    return JSON.stringify(saleSource) === before;
  })(),
  true
);

console.log(`\nAll ${passed} payload-builder checks passed.`);
