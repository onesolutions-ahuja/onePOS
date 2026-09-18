import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { parseMasterCsv, importGlobalMaster } from '../services/globalProductMasterImport.js';

// Dry-run by default. --apply explicitly authorizes migration and import.
const csv = new URL('../data/product-master/onepos_global_product_master_tesco.csv', import.meta.url);
const reportPath = new URL('../data/product-master/tesco_import_report.json', import.meta.url);
let pool;
let client;
try {
  const text = await readFile(csv, 'utf8');
  const records = parseMasterCsv(text);
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ input: records.length, valid: true, databaseChanged: false }));
  } else {
    if (!process.env.DATABASE_URL) throw new Error('Database configuration unavailable');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
    client = await pool.connect();
    const migration = await readFile(new URL('../database/ean_product_master_metadata.sql', import.meta.url), 'utf8');
    const report = await importGlobalMaster(client, records, { migration });
    // Independent post-commit verification on the same connection.
    const after = await client.query('SELECT count(*)::int AS total, count(*) FILTER (WHERE image_url IS NOT NULL AND source IS NOT NULL)::int AS with_metadata FROM public.ean_product_master');
    report.postCommit = after.rows[0];
    report.csvSha256 = createHash('sha256').update(text).digest('hex');
    report.completedAt = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
    try { await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); }
    catch { console.error('Import committed but report file could not be written; retain the console report.'); process.exitCode = 1; }
  }
} catch (error) {
  // No connection strings, raw DB exception messages or query parameters.
  console.error(JSON.stringify({ importCompleted: false, code: error.code || 'IMPORT_FAILED', conflicts: error.conflicts || [] }));
  process.exitCode = 1;
} finally {
  client?.release();
  if (pool) await pool.end();
}
