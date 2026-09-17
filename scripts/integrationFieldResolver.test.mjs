/*
 * Unit-style Node checks for src/services/integrationFieldResolver.js (T9B).
 * Run: node scripts/integrationFieldResolver.test.mjs
 */
import assert from 'node:assert/strict';
import { resolveField } from '../src/services/integrationFieldResolver.js';

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  passed += 1;
  console.log(`ok - ${name}`);
}

const data = {
  sales: {
    sale_id: 'S-1001',
    total: 125.5,
    customer: {
      name: 'Jane Doe',
      address: { postcode: 'E16 1AA', line1: '10 High Street' },
    },
  },
  purchase: {
    supplier: { name: 'Acme Foods' },
    items: [
      { quantity: 2, product: { name: 'Cola 330ml', ean: '5012345678901' } },
      { quantity: 5, product: { name: 'Crisps', ean: '5012345678902' } },
      { quantity: 1, product: null },
    ],
  },
};

// Direct paths
check('direct: sales.sale_id', resolveField(data, 'sales.sale_id'), 'S-1001');
check('direct: sales.total', resolveField(data, 'sales.total'), 125.5);

// Nested relationship paths
check(
  'nested: sales.customer.name',
  resolveField(data, 'sales.customer.name'),
  'Jane Doe'
);
check(
  'nested: sales.customer.address.postcode',
  resolveField(data, 'sales.customer.address.postcode'),
  'E16 1AA'
);
check(
  'nested: purchase.supplier.name',
  resolveField(data, 'purchase.supplier.name'),
  'Acme Foods'
);

// Array paths
check(
  'array: purchase.items[].quantity',
  resolveField(data, 'purchase.items[].quantity'),
  [2, 5, 1]
);
check(
  'array: purchase.items[].product.name',
  resolveField(data, 'purchase.items[].product.name'),
  ['Cola 330ml', 'Crisps', null]
);
check(
  'array: purchase.items[].product.ean',
  resolveField(data, 'purchase.items[].product.ean'),
  ['5012345678901', '5012345678902', null]
);

// Missing / null relationships (must not throw)
check('missing root', resolveField(data, 'returns.total'), null);
check('missing nested', resolveField(data, 'sales.customer.phone'), null);
check(
  'missing deep nested',
  resolveField(data, 'sales.customer.address.floor'),
  null
);
check(
  'null relationship traversal',
  resolveField({ sales: { customer: null } }, 'sales.customer.name'),
  null
);
check(
  'missing array base',
  resolveField(data, 'purchase.batches[].quantity'),
  []
);
check(
  'array marker on non-array',
  resolveField(data, 'sales.customer.name[].first'),
  []
);
check('null root scalar', resolveField(null, 'sales.total'), null);
check('null root array', resolveField(null, 'purchase.items[].quantity'), []);
check('empty path', resolveField(data, ''), null);
check('non-string path', resolveField(data, null), null);

console.log(`\nAll ${passed} resolver checks passed.`);
