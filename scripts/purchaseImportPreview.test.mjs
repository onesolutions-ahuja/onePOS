/*
 * Unit-style Node checks for src/services/purchaseImportPreview.js (T9G).
 * Run: node scripts/purchaseImportPreview.test.mjs
 */
import assert from 'node:assert/strict';
import { parsePurchaseImport } from '../src/services/purchaseImport.js';
import { buildPurchaseImportPreview } from '../src/services/purchaseImportPreview.js';

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  passed += 1;
  console.log(`ok - ${name}`);
}

// 1. All-valid import: two rows, one purchase group.
const parsed = parsePurchaseImport([
  { EAN: '0501234567890', Qty: 2, Cost: 1.5, Supplier: 'Acme', Reference: 'INV-1', Date: '2026-09-01' },
  { EAN: '5012345678901', Qty: '5', Cost: '0.80', Supplier: 'Acme', Reference: 'INV-1', Date: '2026-09-01' },
]);
const preview = buildPurchaseImportPreview(parsed);
check('total input rows', preview.totalInputRows, 2);
check('valid rows', preview.validRows, 2);
check('invalid rows', preview.invalidRows, 0);
check('total purchases', preview.totalPurchases, 1);
check('total item lines', preview.totalItemLines, 2);
check('total quantity', preview.totalQuantity, 7);
check('total value', preview.totalValue, 7);
check('errors by row empty', preview.errorsByRow, {});
check('file errors empty', preview.fileErrors, []);
check('EAN strings preserved', preview.rows.map((r) => r.items[0].ean), ['0501234567890', '5012345678901']);
check('purchase grouping preserved', preview.purchases, [{
  referenceNumber: 'INV-1',
  purchaseDate: '2026-09-01',
  supplier: 'Acme',
  items: [
    { ean: '0501234567890', sku: null, productName: null, quantity: 2, unitCost: 1.5 },
    { ean: '5012345678901', sku: null, productName: null, quantity: 5, unitCost: 0.8 },
  ],
}]);

// 2. Mixed valid/invalid: invalid rows excluded from totals.
const mixed = parsePurchaseImport([
  { EAN: '111', Qty: 3, Cost: 2 },
  { EAN: '222', Qty: 0, Cost: 1 },
  { EAN: '333', Qty: 1, Cost: -1 },
  { Qty: 4, Cost: 1 },
]);
const mixedPreview = buildPurchaseImportPreview(mixed);
check('mixed input rows', mixedPreview.totalInputRows, 4);
check('mixed valid rows', mixedPreview.validRows, 1);
check('mixed invalid rows', mixedPreview.invalidRows, 3);
check('mixed totals exclude invalid', [mixedPreview.totalItemLines, mixedPreview.totalQuantity, mixedPreview.totalValue], [1, 3, 6]);
check('errors grouped by row', mixedPreview.errorsByRow, {
  3: ['Quantity must be greater than 0.'],
  4: ['Unit Cost must be 0 or greater.'],
  5: ['Product identification is required (EAN, SKU or Product Name).'],
});

// 3. Multiple purchases: separate references stay separate.
const multi = parsePurchaseImport([
  { EAN: '111', Qty: 1, Cost: 10, Reference: 'A', Supplier: 'S1' },
  { EAN: '222', Qty: 2, Cost: 5, Reference: 'B', Supplier: 'S1' },
  { EAN: '111', Qty: 1, Cost: 10, Reference: 'B', Supplier: 'S1' },
]);
const multiPreview = buildPurchaseImportPreview(multi);
check('multiple purchases', multiPreview.totalPurchases, 2);
check('multi totals', [multiPreview.totalItemLines, multiPreview.totalQuantity, multiPreview.totalValue], [3, 4, 30]);
check('purchase A items', multiPreview.purchases[0].items.length, 1);
check('purchase B items', multiPreview.purchases[1].items.length, 2);

// 4. Zero cost + duplicate products: counted, value unaffected.
const zero = parsePurchaseImport([
  { EAN: '0001230004567', Qty: 2, Cost: 0 },
  { EAN: '0001230004567', Qty: 3, Cost: 0 },
]);
const zeroPreview = buildPurchaseImportPreview(zero);
check('zero-cost totals', [zeroPreview.totalItemLines, zeroPreview.totalQuantity, zeroPreview.totalValue], [2, 5, 0]);
check('leading zeros exact', zeroPreview.rows[0].items[0].ean, '0001230004567');

// 5. Empty parser results handled safely.
for (const empty of [undefined, null, {}, { validRows: [], errors: [], purchases: [] }]) {
  const e = buildPurchaseImportPreview(empty);
  check('empty totals', [e.totalInputRows, e.validRows, e.invalidRows, e.totalPurchases, e.totalItemLines, e.totalQuantity, e.totalValue], [0, 0, 0, 0, 0, 0, 0]);
  check('empty maps', [e.errorsByRow, e.fileErrors, e.rows, e.purchases], [{}, [], [], []]);
}

// 6. File-level (row null) errors do not count as rows.
const fileErr = buildPurchaseImportPreview(parsePurchaseImport([{ EAN: '111' }]));
check('file error rows', [fileErr.totalInputRows, fileErr.validRows, fileErr.invalidRows], [0, 0, 0]);
check('file errors surfaced', fileErr.fileErrors, ['Missing required column: Quantity (Qty / Quantity).', 'Missing required column: Unit Cost (Cost / Unit Cost).']);

// 7. Immutability: preview never mutates the parser result.
const frozen = parsePurchaseImport([
  { EAN: '0501234567890', Qty: 2, Cost: 1.5, Reference: 'INV-9' },
]);
const before = JSON.stringify(frozen);
const pv = buildPurchaseImportPreview(frozen);
pv.rows[0].items[0].ean = 'MUTATED';
pv.rows[0].referenceNumber = 'MUTATED';
pv.purchases[0].items.push({ ean: 'X', sku: null, productName: null, quantity: 1, unitCost: 1 });
pv.errorsByRow['2'] = ['MUTATED'];
check('parser result untouched', JSON.stringify(frozen), before);

console.log(`\nAll ${passed} purchase-import-preview checks passed.`);
