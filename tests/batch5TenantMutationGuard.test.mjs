import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../server/routes/${name}`, import.meta.url), 'utf8');

test('hardware and payment-terminal test mutations retain tenant/store scope', () => {
  const src = read('settings.js');
  assert.match(src, /UPDATE payment_terminals SET last_test_result=\$1, last_tested_at=NOW\(\) WHERE id=\$2 AND company_id=\$3/);
  assert.match(src, /UPDATE hardware_configurations SET last_test_result=\$1, last_tested_at=NOW\(\) WHERE id=\$2 AND company_id=\$3 AND store_id=\$4/);
});

test('self-checkout pairing-key writes are company scoped at mutation time', () => {
  const src = read('admin.js');
  assert.match(src, /UPDATE stores SET self_checkout_key_hash = NULL, updated_at = NOW\(\) WHERE id = \$1 AND company_id = \$2/);
  assert.match(src, /UPDATE stores SET self_checkout_key_hash = \$1, updated_at = NOW\(\) WHERE id = \$2 AND company_id = \$3/);
});

test('generic platform update/delete derives tenant and store predicates from object metadata', () => {
  const src = read('platform.js');
  assert.match(src, /if \(object\.company_scoped\)[\s\S]*where \+= ` AND company_id=\$\$\{params\.length\}`/);
  assert.match(src, /if \(object\.store_scoped\)[\s\S]*where \+= ` AND store_id=\$\$\{params\.length\}`/);
});
