import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAppPath, buildCustomPagePath } from '../src/utils/adminRoutes.js';

test('custom platform pages have a stable runtime route', () => {
  assert.equal(buildCustomPagePath('manager_home'), '/app/pages/manager_home');
  assert.deepEqual(parseAppPath('/app/pages/manager_home'), { view: 'custom_page', pageKey: 'manager_home' });
});
