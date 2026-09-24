import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, readFileSync } from 'node:fs';

const mustExist = [
  'website', 'website/index.html',
  'app', 'app/src', 'app/platform', 'app/shared', 'app/apps',
  'server', 'server/server.js', 'server/routes', 'server/services',
  'packages', 'database', 'docs/DIRECTORY_STRUCTURE.md',
];

test('repository has explicit website/app/server/package boundaries', () => {
  for (const path of mustExist) assert.equal(existsSync(path), true, `missing ${path}`);
});

test('legacy paths are compatibility links, not duplicate source trees', () => {
  for (const path of ['src', 'routes', 'services', 'utils', 'server.js', 'index.html']) {
    assert.equal(lstatSync(path).isSymbolicLink(), true, `${path} should be a compatibility symlink`);
  }
});

test('tenant architecture forbids per-client source copies', () => {
  const docs = readFileSync('docs/DIRECTORY_STRUCTURE.md', 'utf8');
  assert.match(docs, /Never create a source tree per tenant/i);
  assert.match(docs, /app\/apps\/hrms/i);
  assert.match(docs, /licence\/entitlement/i);
});
