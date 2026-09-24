import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CSV_FIELDS, DB_FIELDS, validGtin, parseMasterCsv, mapRecord, importGlobalMaster } from '../services/globalProductMasterImport.js';
const records = ['036000291452', '4006381333931', '96385074'].map((ean, index) => ({
  ean, name: `Sample product ${index + 1}`, brand: 'Example', pack_size: '1 unit',
  category: 'Sample', image_url: 'https://example.com/product.png', source: 'test',
}));
const text = [CSV_FIELDS, ...records.map((record) => CSV_FIELDS.map((field) => record[field]))]
  .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(','))
  .join('\r\n');
function fakeClient(initial = [], failAt = 0) {
  let rows = structuredClone(initial); let snapshot; let inserts = 0;
  const calls = [];
  return { calls, get rows() { return rows; }, async query(sql, params = []) {
    calls.push(sql);
    if (sql === 'BEGIN') snapshot = structuredClone(rows);
    else if (sql === 'ROLLBACK') rows = snapshot;
    else if (sql.startsWith('SELECT count')) return { rows: [{ total: rows.length }] };
    else if (sql.startsWith('SELECT ean')) return { rows: rows.filter((r) => sql.includes('lpad') ? params[1].includes(r.ean.padStart(14, '0')) : params[0].includes(r.ean)) };
    else if (sql.startsWith('INSERT')) {
      if (++inserts === failAt) throw new Error('Injected failure');
      const row = Object.fromEntries(DB_FIELDS.map((k, i) => [k, params[i]]));
      rows.push(row); return { rows: [{ ean: row.ean }] };
    }
    return { rows: [] };
  } };
}
test('sample CSV has valid unique string GTINs and complete metadata', () => {
  assert.deepEqual(parseMasterCsv(text), records);
  assert.equal(new Set(records.map((r) => r.ean)).size, records.length);
  assert.ok(records.every((r) => validGtin(r.ean) && r.image_url && r.source));
});
test('GTIN validation includes checksum, lengths and zero rejection', () => {
  for (const value of ['4006381333931', '96385074', '036000291452', '05000116125234']) assert.ok(validGtin(value));
  for (const value of ['', '00000000000000', '4006381333932', '5e13', 5000116125234]) assert.equal(validGtin(value), false);
});
test('CSV handles quoted metadata exactly including commas quotes and newlines', () => {
  const r = { ...records[0], name: 'A, "quoted"\nname', image_url: 'https://example.com/a?x=1&y=2' };
  const csv = [CSV_FIELDS, CSV_FIELDS.map((k) => r[k])].map((row) => row.map((v) => '"' + v.replaceAll('"', '""') + '"').join(',')).join('\r\n');
  assert.deepEqual(parseMasterCsv(csv, 1), [r]);
});
test('invalid count, duplicate EAN, malformed quotes and unexpected columns fail before BEGIN', async () => {
  assert.throws(() => parseMasterCsv(text, records.length + 1));
  assert.throws(() => parseMasterCsv(text.replace('"ean"', '"price"')));
  assert.throws(() => parseMasterCsv(text + '"unclosed'));
  const client = fakeClient();
  await assert.rejects(importGlobalMaster(client, [records[0], records[0]], { expectedCount: 2 }), /Duplicate/);
  assert.equal(client.calls.length, 0);
});
test('transaction imports all fields, preserves zeros, and repeat import skips without duplicates', async () => {
  const client = fakeClient();
  const report = await importGlobalMaster(client, records);
  assert.equal(report.inserted, records.length); assert.equal(report.finalCount, records.length);
  assert.deepEqual(client.rows, records.map(mapRecord));
  assert.equal(client.calls.at(-1), 'COMMIT');
  const again = await importGlobalMaster(client, records);
  assert.equal(again.inserted, 0); assert.equal(again.skippedExisting, records.length);
  assert.equal(client.rows.length, records.length);
  assert.ok(client.calls.filter((s) => s.startsWith('INSERT')).every((s) => s.includes('ON CONFLICT (ean) DO NOTHING')));
});
test('authoritative EAN conflicts abort with field names and no writes', async () => {
  const initial = { ...mapRecord(records[0]), brand: 'Authoritative' };
  const client = fakeClient([initial]);
  await assert.rejects(importGlobalMaster(client, records), (e) => e.conflicts[0].fields.includes('brand'));
  assert.deepEqual(client.rows, [initial]);
  assert.equal(client.calls.some((s) => s.startsWith('INSERT')), false);
  assert.equal(client.calls.at(-1), 'ROLLBACK');
});
test('equivalent shorter GTIN is reported as conflict rather than duplicated', async () => {
  const client = fakeClient([{ ...mapRecord(records[0]), ean: records[0].ean.slice(1) }]);
  await assert.rejects(importGlobalMaster(client, records), (e) => e.conflicts[0].fields.includes('ean'));
});
test('mid-import failure rolls back the entire dataset', async () => {
  const client = fakeClient([], 2);
  await assert.rejects(importGlobalMaster(client, records), /Injected failure/);
  assert.equal(client.rows.length, 0);
  assert.equal(client.calls.at(-1), 'ROLLBACK');
});
test('migration only adds approved nullable metadata columns idempotently', () => {
  const sql = readFileSync(new URL('../database/ean_product_master_metadata.sql', import.meta.url), 'utf8');
  assert.equal((sql.match(/ADD COLUMN IF NOT EXISTS/g) || []).length, 2);
  assert.match(sql, /image_url TEXT NULL/); assert.match(sql, /source TEXT NULL/);
});
