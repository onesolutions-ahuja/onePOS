/*
 * Unit-style Node checks for src/services/purchaseImport.js (T9F).
 * Run: node scripts/purchaseImport.test.mjs
 */
import assert from 'node:assert/strict';
import { parsePurchaseImport } from '../src/services/purchaseImport.js';

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  passed += 1;
  console.log(`ok - ${name}`);
}

// 1. Valid import with canonical headers.
const valid = parsePurchaseImport([
  { EAN: '0501234567890', SKU: 'SKU-1', Product: 'Cola 330ml', Qty: 2, Cost: 1.5, Supplier: 'Acme', Reference: 'INV-1', Date: '2026-09-01' },
  { EAN: '5012345678901', SKU: 'SKU-2', Product: 'Crisps', Qty: '5', Cost: '0.80', Supplier: 'Acme', Reference: 'INV-1', Date: '2026-09-01' },
]);
check('valid rows count', valid.validRows.length, 2);
check('valid errors empty', valid.errors, []);
check('first valid row', valid.validRows[0], {
  referenceNumber: 'INV-1',
  purchaseDate: '2026-09-01',
  supplier: 'Acme',
  items: [{ ean: '0501234567890', sku: 'SKU-1', productName: 'Cola 330ml', quantity: 2, unitCost: 1.5 }],
});
check('grouped purchases', valid.purchases, [{
  referenceNumber: 'INV-1',
  purchaseDate: '2026-09-01',
  supplier: 'Acme',
  items: [
    { ean: '0501234567890', sku: 'SKU-1', productName: 'Cola 330ml', quantity: 2, unitCost: 1.5 },
    { ean: '5012345678901', sku: 'SKU-2', productName: 'Crisps', quantity: 5, unitCost: 0.8 },
  ],
}]);

// 2. Alternate headers + casing + whitespace, matrix input.
const alt = parsePurchaseImport([
  ['  BARCODE ', 'sku CODE', 'PRODUCT NAME', 'Quantity', 'Unit Price', 'VENDOR', 'Invoice Number', 'Purchase Date'],
  [' 00123 ', ' X1 ', ' Milk ', ' 3 ', ' 2.00 ', ' Dairy Co ', ' PO-9 ', ' 2026-01-02 '],
]);
check('alternate headers normalise', alt.errors, []);
check('alternate row', alt.validRows[0], {
  referenceNumber: 'PO-9',
  purchaseDate: '2026-01-02',
  supplier: 'Dairy Co',
  items: [{ ean: '00123', sku: 'X1', productName: 'Milk', quantity: 3, unitCost: 2 }],
});

// 3. Leading-zero EANs preserved (numeric-looking strings stay strings).
const zeros = parsePurchaseImport([
  { EAN: '0001230004567', Qty: 1, Cost: 0 },
]);
check('leading-zero EAN preserved', zeros.validRows[0].items[0].ean, '0001230004567');
check('zero unit cost allowed', zeros.validRows[0].items[0].unitCost, 0);
check('zero-cost errors empty', zeros.errors, []);

// 4. Invalid quantities/costs report row numbers + specific errors.
const bad = parsePurchaseImport([
  { EAN: '111', Qty: 0, Cost: 1 },
  { EAN: '222', Qty: -2, Cost: 1 },
  { EAN: '333', Qty: 'abc', Cost: 1 },
  { EAN: '444', Qty: 1, Cost: -0.5 },
  { EAN: '555', Qty: 1, Cost: 'xyz' },
  { Qty: 1, Cost: 1 },
  { EAN: '666', Qty: '', Cost: '' },
]);
check('invalid rows produce no valid rows', bad.validRows, []);
check('row numbers sequential from line 2', bad.errors.map((e) => e.row), [2, 3, 4, 5, 6, 7, 8]);
check('zero quantity error', bad.errors[0].errors, ['Quantity must be greater than 0.']);
check('negative quantity error', bad.errors[1].errors, ['Quantity must be greater than 0.']);
check('non-numeric quantity error', bad.errors[2].errors, ['Quantity must be a number.']);
check('negative cost error', bad.errors[3].errors, ['Unit Cost must be 0 or greater.']);
check('non-numeric cost error', bad.errors[4].errors, ['Unit Cost must be a number.']);
check('missing identity error', bad.errors[5].errors, ['Product identification is required (EAN, SKU or Product Name).']);
check('blank numeric error', bad.errors[6].errors, ['Quantity is required.', 'Unit Cost is required.']);

// 5. Multiple errors on one row are all reported.
const multi = parsePurchaseImport([{ EAN: '999', Qty: 0, Cost: -1 }]);
check('multiple errors same row', multi.errors, [{
  row: 2,
  errors: [
    'Quantity must be greater than 0.',
    'Unit Cost must be 0 or greater.',
  ],
}]);

// 6. Missing required columns (file-level error, row null).
const missingQty = parsePurchaseImport([{ EAN: '111', Cost: 1 }]);
check('missing quantity column', missingQty.errors, [
  { row: null, errors: ['Missing required column: Quantity (Qty / Quantity).'] },
]);
check('missing column yields no rows', missingQty.validRows, []);
const missingIdentity = parsePurchaseImport([{ Qty: 1, Cost: 1, Supplier: 'Acme' }]);
check('missing identity row error', missingIdentity.errors, [
  { row: 2, errors: ['Product identification is required (EAN, SKU or Product Name).'] },
]);
check('missing identity yields no rows', missingIdentity.validRows, []);

// 7. Blank rows skipped; SKU-only identity accepted.
const blanks = parsePurchaseImport([
  { SKU: 'S-1', Qty: 1, Cost: 2 },
  { SKU: ' ', Qty: ' ', Cost: ' ' },
  { EAN: null, SKU: null, 'Product Name': null, Qty: null, Cost: null },
  { SKU: 'S-2', Qty: 4, Cost: 1.25 },
]);
check('blank rows skipped', blanks.validRows.length, 2);
check('blank rows no errors', blanks.errors, []);
check('row after blank rows', blanks.validRows[1].items[0].sku, 'S-2');

// 8. Non-array input rejected cleanly.
check('non-array input', parsePurchaseImport(null), {
  validRows: [],
  errors: [{ row: null, errors: ['Import data must be an array of rows.'] }],
  purchases: [],
});

console.log(`\nAll ${passed} purchase-import checks passed.`);
