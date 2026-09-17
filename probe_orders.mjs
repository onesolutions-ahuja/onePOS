import pg from "pg";
import fs from "fs";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query("SELECT id,platform,external_order_id,status,otp_code FROM online_orders ORDER BY created_at DESC LIMIT 10");
console.log(JSON.stringify(r.rows, null, 1));
const r2 = await pool.query("SELECT provider,active,configuration FROM integrations");
console.log("INTEGRATIONS", JSON.stringify(r2.rows, null, 1));
await pool.end();
