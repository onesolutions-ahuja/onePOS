/*
 * Unit-style Node checks for src/services/salesReturn.js (T9H).
 * Run: node scripts/salesReturn.test.mjs
 */
import assert from 'node:assert/strict';
import { validateSalesReturn } from '../src/services/salesReturn.js';

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  passed += 1;
  console.log(`ok - ${name}`);
}

const ORIGINALS = [
  { saleItemId: 'li-1', productId: 'p-1', quantity: 2, unitPrice: 10, tax: 1, discount: 0 },
  { saleItemId: 'li-2', productId: 'p-2', quantity: 3, unitPrice: 4.5, tax: 0.5, discount: 1 },
];

// 1. Full return of one line.
const full = validateSalesReturn({ saleId: 's-1', items: [{ saleItemId: 'li-1', quantity: 2, unitPrice: 10, tax: 1, discount: 0 }] }, ORIGINALS);
check('full valid', [full.valid, full.errors], [true, []]);
check('full totals', [full.subtotal, full.tax, full.discount, full.total], [20, 1, 0, 21]);

// 2. Partial return uses request price/tax/discount.
const partial = validateSalesReturn({ saleId: 's-1', items: [{ saleItemId: 'li-2', quantity: 1, unitPrice: 4.5, tax: 0.2, discount: 0.5 }] }, ORIGINALS);
check('partial totals', [partial.subtotal, partial.tax, partial.discount, partial.total], [4.5, 0.2, 0.5, 4.2]);

// 3. Multiple items in one request sum correctly.
const multi = validateSalesReturn({ saleId: 's-1', items: [
  { saleItemId: 'li-1', quantity: 1, unitPrice: 10, tax: 0.5, discount: 0 },
  { saleItemId: 'li-2', quantity: 2, unitPrice: 4.5, tax: 0.3, discount: 1 },
] }, ORIGINALS);
check('multi valid', multi.valid, true);
check('multi totals', [multi.subtotal, multi.tax, multi.discount, multi.total], [19, 0.8, 1, 18.8]);
check('multi lines', multi.items.map((i) => i.lineTotal), [10.5, 8.3]);

// 4. Excessive quantity rejected with affected saleItemId.
const over = validateSalesReturn({ saleId: 's-1', items: [{ saleItemId: 'li-1', quantity: 3, unitPrice: 10 }] }, ORIGINALS);
check('over valid', over.valid, false);
check('over errors', over.errors, [{ saleItemId: 'li-1', message: 'quantity 3 exceeds remaining returnable quantity 2.' }]);
check('over zeroed totals', [over.subtotal, over.tax, over.discount, over.total, over.items], [0, 0, 0, 0, []]);

// 5. Already-fully-returned line rejected.
const done = validateSalesReturn({ saleId: 's-1', items: [{ saleItemId: 'li-1', quantity: 1 }] }, [
  { saleItemId: 'li-1', productId: 'p-1', quantity: 2, unitPrice: 10, returnedQuantity: 2 },
]);
check('fully returned', done.errors, [{ saleItemId: 'li-1', message: 'Item has already been fully returned.' }]);

// 6. Partially-returned line enforces remaining quantity.
const part = [
  { saleItemId: 'li-2', productId: 'p-2', quantity: 3, unitPrice: 4.5, returnedQuantity: 2 },
];
check('remaining ok', validateSalesReturn({ saleId: 's-1', items: [{ saleItemId: 'li-2', quantity: 1 }] }, part).valid, true);
check('remaining over', validateSalesReturn({ saleId: 's-1', items: [{ saleItemId: 'li-2', quantity: 1.5 }] }, part).errors, [
  { saleItemId: 'li-2', message: 'quantity 1.5 exceeds remaining returnable quantity 1.' },
]);

// 7. Duplicates + unknown ids rejected.
const dup = validateSalesReturn({ saleId: 's-1', items: [
  { saleItemId: 'li-1', quantity: 1 },
  { saleItemId: 'li-1', quantity: 1 },
] }, ORIGINALS);
check('duplicate', dup.errors, [{ saleItemId: 'li-1', message: 'Duplicate saleItemId in return request.' }]);
check('unknown', validateSalesReturn({ saleId: 's-1', items: [{ saleItemId: 'nope', quantity: 1 }] }, ORIGINALS).errors, [{ saleItemId: 'nope', message: 'Unknown saleItemId for this sale.' }]);
check('product mismatch', validateSalesReturn({ saleId: 's-1', items: [{ saleItemId: 'li-1', productId: 'p-X', quantity: 1 }] }, ORIGINALS).errors, [{ saleItemId: 'li-1', message: 'productId does not match the original sale item.' }]);

// 8. Zero/negative/invalid values handled safely.
for (const [name, item] of [
  ['zero qty', { saleItemId: 'li-1', quantity: 0 }],
  ['negative qty', { saleItemId: 'li-1', quantity: -1 }],
  ['nan qty', { saleItemId: 'li-1', quantity: 'abc' }],
  ['negative price', { saleItemId: 'li-1', quantity: 1, unitPrice: -1 }],
  ['negative tax', { saleItemId: 'li-1', quantity: 1, unitPrice: 10, tax: -0.1 }],
  ['negative discount', { saleItemId: 'li-1', quantity: 1, unitPrice: 10, discount: -1 }],
  ['excess discount', { saleItemId: 'li-1', quantity: 1, unitPrice: 10, discount: 999 }],
]) {
  const r = validateSalesReturn({ saleId: 's-1', items: [item] }, ORIGINALS);
  check(`invalid ${name}`, [r.valid, r.errors.length, r.total], [false, 1, 0]);
}

// 9. Rounding to 2dp: 3 x 0.1 + tax stays exact.
const round = validateSalesReturn({ saleId: 's-1', items: [{ saleItemId: 'li-9', quantity: 3, unitPrice: 0.1, tax: 0.02, discount: 0.01 }] }, [
  { saleItemId: 'li-9', productId: 'p-9', quantity: 3, unitPrice: 0.1 },
]);
check('rounding', [round.subtotal, round.tax, round.discount, round.total], [0.3, 0.02, 0.01, 0.31]);

// 10. Missing sale / empty items / bad shapes.
check('missing saleId', validateSalesReturn({ items: [{ saleItemId: 'li-1', quantity: 1 }] }, ORIGINALS).errors, [{ saleItemId: null, message: 'saleId is required.' }]);
check('empty items', validateSalesReturn({ saleId: 's-1', items: [] }, ORIGINALS).errors, [{ saleItemId: null, message: 'Return must include at least one item.' }]);
check('non-object request', validateSalesReturn(null, ORIGINALS).errors, [{ saleItemId: null, message: 'Return request must be an object.' }]);

// 11. Immutability: inputs never mutated.
const req = { saleId: 's-1', items: [{ saleItemId: 'li-1', quantity: 1, unitPrice: 10, tax: 0.5 }] };
const orig = JSON.parse(JSON.stringify(ORIGINALS));
const out = validateSalesReturn(req, ORIGINALS);
out.items[0].quantity = 999;
out.items.push({ saleItemId: 'x' });
check('request untouched', req, { saleId: 's-1', items: [{ saleItemId: 'li-1', quantity: 1, unitPrice: 10, tax: 0.5 }] });
check('originals untouched', ORIGINALS, orig);

console.log(`\nAll ${passed} sales-return checks passed.`);
