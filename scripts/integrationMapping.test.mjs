/*
 * Unit-style Node checks for src/services/integrationMapping.js (T9D).
 * Run: node scripts/integrationMapping.test.mjs
 */
import assert from 'node:assert/strict';
import {
  normalizeMappings,
  validateMapping,
} from '../src/services/integrationMapping.js';

let passed = 0;
function check(name, actual, expected) {
  assert.deepEqual(actual, expected);
  passed += 1;
  console.log(`ok - ${name}`);
}

// Valid shapes: flat, nested and array mappings normalize cleanly.
check('valid flat mapping', validateMapping({
  partnerField: 'invoice_number',
  sourcePath: 'sales.receipt_number',
}), {
  valid: true,
  errors: [],
  normalized: { partnerField: 'invoice_number', sourcePath: 'sales.receipt_number' },
});
check('valid nested mapping', validateMapping({
  partnerField: 'customer.name',
  sourcePath: 'sales.customer.name',
}), {
  valid: true,
  errors: [],
  normalized: { partnerField: 'customer.name', sourcePath: 'sales.customer.name' },
});
check('valid array mapping preserves []', validateMapping({
  partnerField: 'items[].sku',
  sourcePath: 'sales.items[].product.sku',
}), {
  valid: true,
  errors: [],
  normalized: { partnerField: 'items[].sku', sourcePath: 'sales.items[].product.sku' },
});

// Whitespace is trimmed on both sides.
const trimmed = normalizeMappings([
  { partnerField: '  total  ', sourcePath: '  sales.total\t' },
]);
check('whitespace trimmed', trimmed.mappings, [
  { partnerField: 'total', sourcePath: 'sales.total' },
]);
check('whitespace produces no errors', trimmed.errors, []);

// Exact duplicates (after trimming) collapse; order preserved.
const deduped = normalizeMappings([
  { partnerField: 'customer.name', sourcePath: 'sales.customer.name' },
  { partnerField: 'total', sourcePath: 'sales.total' },
  { partnerField: 'customer.name', sourcePath: 'sales.customer.name' },
  { partnerField: '  total ', sourcePath: ' sales.total ' },
  { partnerField: 'total', sourcePath: 'purchase.total' },
]);
check('duplicates removed, order preserved', deduped.mappings, [
  { partnerField: 'customer.name', sourcePath: 'sales.customer.name' },
  { partnerField: 'total', sourcePath: 'sales.total' },
  { partnerField: 'total', sourcePath: 'purchase.total' },
]);
check('duplicates produce no errors', deduped.errors, []);

// Missing / empty / non-string sides are invalid.
check('missing sourcePath invalid', validateMapping({ partnerField: 'total' }).valid, false);
check('missing partnerField invalid', validateMapping({ sourcePath: 'sales.total' }).valid, false);
check('empty partnerField invalid', validateMapping({ partnerField: '  ', sourcePath: 'sales.total' }).valid, false);
check('non-string sourcePath invalid', validateMapping({ partnerField: 'total', sourcePath: 42 }).valid, false);
check('non-object mapping invalid', validateMapping('total').valid, false);
check('null mapping invalid', validateMapping(null).valid, false);

// Malformed paths are rejected with UI-friendly messages.
for (const bad of [
  'sales..total',
  '.sales.total',
  'sales.total.',
  'sales customer.total',
  'sales.[]',
  '[]',
  'sales.9lives',
  'sales.total!',
]) {
  const result = validateMapping({ partnerField: 'x', sourcePath: bad });
  assert.equal(result.valid, false, `expected invalid: ${bad}`);
  assert.ok(result.errors.length > 0, `expected message: ${bad}`);
  passed += 1;
  console.log(`ok - malformed rejected: ${bad}`);
}

// normalizeMappings reports per-index errors and keeps valid entries.
const mixed = normalizeMappings([
  { partnerField: 'total', sourcePath: 'sales.total' },
  { partnerField: '', sourcePath: 'sales.total' },
  { partnerField: 'items[].sku', sourcePath: 'sales..sku' },
  { partnerField: 'name', sourcePath: 'sales.customer.name' },
]);
check('mixed keeps valid entries', mixed.mappings, [
  { partnerField: 'total', sourcePath: 'sales.total' },
  { partnerField: 'name', sourcePath: 'sales.customer.name' },
]);
check('mixed error indexes', mixed.errors.map((e) => e.index), [1, 2]);
assert.ok(mixed.errors.every((e) => e.errors.length > 0));
passed += 1;
console.log('ok - mixed errors carry messages');

// Empty / non-array inputs.
check('empty mappings', normalizeMappings([]), { mappings: [], errors: [] });
check('non-array mappings', normalizeMappings(null), {
  mappings: [],
  errors: [{ index: -1, errors: ['Mappings must be an array.'] }],
});

console.log(`\nAll ${passed} mapping-contract checks passed.`);
