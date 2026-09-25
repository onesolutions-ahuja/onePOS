import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const integrationOnly = process.argv.includes('--integration');
const configured = fs.existsSync('.env.test') && Boolean(dotenv.parse(fs.readFileSync('.env.test')).DATABASE_URL);
if (integrationOnly && !configured) {
  console.error('Integration tests require a disposable PostgreSQL DATABASE_URL in .env.test. The application .env is never used.');
  process.exit(1);
}
const files = fs.readdirSync('tests').filter(f => f.endsWith('.test.mjs'));
const selected = files.filter(f => !integrationOnly || f.includes('.integration.') || f === 'platformBootstrap.test.mjs');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...selected.map(f => `tests/${f}`)], {stdio:'inherit'});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
