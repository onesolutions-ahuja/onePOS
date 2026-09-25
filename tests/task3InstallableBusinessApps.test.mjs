import test from 'node:test';
import assert from 'node:assert/strict';
import { internalAppCatalog } from '../services/internalAppCatalog.js';
import { packageDefinitions, resolvePackagePlan } from '../services/packageRegistry.js';

const defs = packageDefinitions();
const byKey = new Map(defs.map(x => [x.packageKey, x]));

test('Task 3 business apps are independently installable/licensable catalog entries', () => {
  for (const key of ['batch_expiry','customer_credit','hospitality','kds']) {
    assert.ok(internalAppCatalog.some(x => x.key === key), key);
    assert.equal(byKey.get(key)?.manifest?.licenceRequired, true);
    assert.ok(byKey.get(key)?.manifest?.entitlementKey);
  }
});

test('Batch & Expiry installs metadata contract rather than a page-specific CRUD model', () => {
  const m = byKey.get('batch_expiry').manifest;
  assert.deepEqual(m.dependencies, ['inventory','products']);
  const batch = m.objects.find(x => x.objectKey === 'inventory_batch');
  assert.ok(batch);
  assert.ok(batch.fields.some(x => x.apiName === 'product_id' && x.required));
  assert.ok(batch.fields.some(x => x.apiName === 'batch_number' && x.required));
  assert.ok(m.relationships.some(x => x.parentObjectKey === 'product' && x.relationshipKey === 'batches'));
});

test('Credit Control remains a separately licensed metadata package', () => {
  const m = byKey.get('customer_credit').manifest;
  assert.equal(m.entitlementKey, 'credit_control');
  assert.ok(m.objects.some(x => x.objectKey === 'customer_credit_account'));
  assert.ok(m.objects.some(x => x.objectKey === 'customer_credit_ledger'));
  assert.ok(m.rules.some(x => x.objectKey === 'customer_credit_account'));
});

test('Hospitality installs floors/tables/reservations and KDS remains a separate dependent licence', () => {
  const h = byKey.get('hospitality').manifest;
  const k = byKey.get('kds').manifest;
  assert.ok(h.objects.some(x => x.objectKey === 'hospitality_floor'));
  assert.ok(h.objects.some(x => x.objectKey === 'hospitality_table'));
  assert.ok(h.objects.some(x => x.objectKey === 'hospitality_reservation'));
  assert.deepEqual(k.dependencies, ['hospitality','retail_pos']);
  assert.ok(k.objects.some(x => x.objectKey === 'kds_ticket'));
});

test('KDS dependency plan installs its foundations before KDS', () => {
  const plan = resolvePackagePlan('kds', defs).map(x => x.packageKey);
  assert.ok(plan.indexOf('products') < plan.indexOf('retail_pos'));
  assert.ok(plan.indexOf('retail_pos') < plan.indexOf('hospitality'));
  assert.ok(plan.indexOf('hospitality') < plan.indexOf('kds'));
  assert.equal(plan.at(-1), 'kds');
});
