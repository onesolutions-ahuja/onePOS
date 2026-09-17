import fs from "fs";
import pg from "pg";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const l of raw.split(/\r?\n/)) { const i = l.indexOf("="); if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
const dbUrl = env.DATABASE_URL || "";
let host = "(none)";
try { host = new URL(dbUrl).host; } catch { host = "(parse failed)"; }
console.log("DB host:", host);

const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 1 });

async function bench(name, fn) {
  const t0 = Date.now();
  await fn();
  console.log(name.padEnd(46), (Date.now() - t0) + "ms");
}

await bench("connect (first)", async () => { await pool.query("SELECT 1"); });
await bench("SELECT 1 (reuse)", async () => { await pool.query("SELECT 1"); });
await bench("SELECT NOW()", async () => { await pool.query("SELECT NOW()"); });

const companyId = "b4a67538-0915-4dee-9ac4-0bf2ae3cf87f";
await bench("integrations lookup (company,provider)", async () => {
  await pool.query("SELECT active, configuration FROM integrations WHERE company_id = $1 AND provider = $2 LIMIT 1", [companyId, "deliveroo"]);
});
await bench("online_orders list + counts (limit 100)", async () => {
  await pool.query(
    `SELECT o.*,
      (SELECT COUNT(*) FROM online_order_items i WHERE i.order_id = o.id) AS item_count,
      (SELECT COUNT(*) FROM online_order_items i WHERE i.order_id = o.id AND i.mapping_status = 'UNMAPPED') AS unmapped_count
     FROM online_orders o WHERE o.company_id = $1 ORDER BY o.created_at DESC LIMIT 100`,
    [companyId]
  );
});
await bench("online_order_items (all for one order)", async () => {
  await pool.query("SELECT * FROM online_order_items WHERE order_id = $1", ["048c43f2-d71a-4c51-ac5a-8a31f939f262"]);
});
await bench("platform_api_logs insert", async () => {
  await pool.query(
    "INSERT INTO platform_api_logs (company_id, platform, environment, action, endpoint, http_method, request_payload, response_body, success, order_id, product_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [companyId, "deliveroo", "sandbox", "BENCH", "stub://bench", "STUB", {}, { success: true }, true, null, null]
  );
});
await bench("audit_logs insert", async () => {
  await pool.query(
    "INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)",
    [companyId, null, "bench", "online_order", null, JSON.stringify({})]
  );
});
await bench("online_order_events insert", async () => {
  await pool.query(
    "INSERT INTO online_order_events (order_id, event_type, from_status, to_status, message, platform_response, actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    ["048c43f2-d71a-4c51-ac5a-8a31f939f262", "BENCH", "RECEIVED", "RECEIVED", "benchmark", JSON.stringify({}), null]
  );
});
await bench("SELECT online_orders row FOR UPDATE NOWAIT", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT * FROM online_orders WHERE id = $1 AND company_id = $2 FOR UPDATE NOWAIT", ["048c43f2-d71a-4c51-ac5a-8a31f939f262", companyId]);
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});
await pool.end();
