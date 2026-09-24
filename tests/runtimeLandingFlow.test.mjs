import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLandingFlow } from '../services/runtimeAccess.js';

test('landing flow routes a till profile to POS', () => {
  const path = resolveLandingFlow({
    deviceProfile: 'till',
    user: { id: 'u1', roleId: 'r1', companyId: 'c1' },
    flow: { rules: [{ conditions: [{ field: 'profile', value: 'till' }], destination: '/app' }], defaultDestination: '/app/dashboard' },
  });
  assert.equal(path, '/app');
});

test('landing flow can route a specific role to a custom application path', () => {
  const path = resolveLandingFlow({
    user: { roleId: 'cashier-role' },
    flow: { rules: [{ conditions: [{ field: 'role_id', value: 'cashier-role' }], destination: '/app/custom/cashier-home' }], defaultDestination: '/app/dashboard' },
  });
  assert.equal(path, '/app/custom/cashier-home');
});

test('landing flow falls back safely when no rule matches', () => {
  assert.equal(resolveLandingFlow({ flow: { rules: [] }, fallback: '/app' }), '/app');
});

test('landing flow accepts a registered custom-page route shape', () => {
  const path = resolveLandingFlow({
    flow: { rules: [{ conditions: [{ field: 'profile', value: 'admin' }], destination: '/app/pages/manager_home' }] },
    user: { profile: 'admin' },
  });
  assert.equal(path, '/app/pages/manager_home');
});
