/*
 * Unit-style Node checks for src/services/stockMovement.js (T9I).
 * Run: node scripts/stockMovement.test.mjs
 */
import assert from 'node:assert/strict';
import { calculateStockMovement, getMovementTotalsForDateRange } from '../src/services/stockMovement.js';

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  passed += 1;
  console.log(`ok - ${name}`);
}

// 1. Full flow with every movement type.
const full = calculateStockMovement({
  openingQuantity: 10,
  movements: [
    { type: 'PURCHASE', quantity: 5, createdAt: '2026-09-01' },
    { type: 'SALE', quantity: 3, createdAt: '2026-09-02' },
    { type: 'RETURN', quantity: 2, createdAt: '2026-09-03' },
    { type: 'ADJUSTMENT', quantity: -1, createdAt: '2026-09-04' },
  ],
});
check('full buckets', [full.opening, full.purchases, full.sales, full.returns, full.adjustments, full.closing], [10, 5, 3, 2, -1, 13]);
check('full errors', full.errors, []);
check('ordering + running balance', full.movements.map((m) => [m.type, m.effect, m.balance]), [
  ['PURCHASE', 5, 15], ['SALE', -3, 12], ['RETURN', 2, 14], ['ADJUSTMENT', -1, 13],
]);

// 2. OPENING movement is informational; openingQuantity is not double-counted.
const withOpening = calculateStockMovement({
  openingQuantity: 7,
  movements: [{ type: 'OPENING', quantity: 99, createdAt: '2026-01-01' }],
});
check('opening not double counted', [withOpening.opening, withOpening.closing], [7, 7]);
check('opening effect zero', withOpening.movements[0].effect, 0);

// 3. Decimals to 3dp stay exact (0.1 + 0.2 pattern).
const dec = calculateStockMovement({
  openingQuantity: 0,
  movements: [
    { type: 'PURCHASE', quantity: 0.1 },
    { type: 'PURCHASE', quantity: 0.2 },
    { type: 'SALE', quantity: 0.15 },
    { type: 'ADJUSTMENT', quantity: -0.025 },
  ],
});
check('decimal closing', dec.closing, 0.125);
check('decimal buckets', [dec.purchases, dec.sales, dec.adjustments], [0.3, 0.15, -0.025]);

// 4. Empty + missing inputs handled safely.
for (const input of [undefined, null, {}, { movements: [] }, { openingQuantity: 4 }]) {
  const r = calculateStockMovement(input);
  check('empty closing', r.closing, input && typeof input === 'object' && input.openingQuantity === 4 ? 4 : 0);
  check('empty movements', r.movements, []);
}
check('null input error', calculateStockMovement(null).errors.length, 1);

// 5. Malformed records ignored for totals but reported with index.
const malformed = calculateStockMovement({
  openingQuantity: 5,
  movements: [
    { type: 'PURCHASE', quantity: 2 },
    { type: 'BOGUS', quantity: 100 },
    { type: 'SALE', quantity: 'abc' },
    { type: 'PURCHASE', quantity: -4 },
    null,
    { type: 'RETURN', quantity: 1 },
  ],
});
check('malformed buckets', [malformed.purchases, malformed.sales, malformed.returns, malformed.closing], [2, 0, 1, 8]);
check('malformed indexes', malformed.errors.map((e) => e.index), [1, 2, 3, 4]);
check('invalid flags', malformed.movements.map((m) => m.valid), [true, false, false, false, false, true]);

// 6. Negative adjustments allowed; negative sale rejected.
const neg = calculateStockMovement({
  openingQuantity: 10,
  movements: [
    { type: 'ADJUSTMENT', quantity: -12 },
    { type: 'SALE', quantity: -2 },
  ],
});
check('negative adjustment', [neg.adjustments, neg.closing], [-12, -2]);
check('negative sale rejected', [neg.sales, neg.errors.length], [0, 1]);

// 7. Immutability: inputs never mutated.
const frozenIn = {
  openingQuantity: 3,
  movements: [{ type: 'PURCHASE', quantity: 2, createdAt: '2026-09-01' }],
};
const before = JSON.stringify(frozenIn);
const out = calculateStockMovement(frozenIn);
out.movements[0].balance = 999;
out.movements.push({ type: 'X' });
check('input untouched', JSON.stringify(frozenIn), before);

// 8. Date-range helper: inclusive bounds, open-ended, no mutation.
const ranged = [
  { type: 'PURCHASE', quantity: 10, createdAt: '2026-09-01T10:00:00Z' },
  { type: 'SALE', quantity: 4, createdAt: '2026-09-05T10:00:00Z' },
  { type: 'RETURN', quantity: 1, createdAt: '2026-09-10T10:00:00Z' },
  { type: 'ADJUSTMENT', quantity: -2, createdAt: '2026-09-15T10:00:00Z' },
  { type: 'PURCHASE', quantity: 99 },
];
const beforeRange = JSON.stringify(ranged);
const window = getMovementTotalsForDateRange(ranged, '2026-09-05T00:00:00Z', '2026-09-10T23:59:59Z');
check('range window', [window.purchases, window.sales, window.returns, window.adjustments, window.netChange, window.count], [0, 4, 1, 0, -3, 2]);
check('open-ended from', getMovementTotalsForDateRange(ranged, { from: '2026-09-10T00:00:00Z' }).count, 2);
check('no dates = dated only', getMovementTotalsForDateRange(ranged).count, 4);
check('range input untouched', JSON.stringify(ranged), beforeRange);
check('bad list', getMovementTotalsForDateRange(null).errors.length, 1);

console.log(`\nAll ${passed} stock-movement checks passed.`);
