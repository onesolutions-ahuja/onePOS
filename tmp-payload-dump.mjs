/* TEMPORARY read-only dump of the real stored Deliveroo webhook payload shape. */
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const res = await pool.query(
  `SELECT created_at, action, request_payload
   FROM platform_api_logs
   WHERE platform = 'deliveroo' AND action IN ('WEBHOOK_ORDER_NEW','WEBHOOK_ORDER_STATUS_UPDATE')
   ORDER BY created_at DESC LIMIT 2`
);

for (const row of res.rows) {
  console.log("=== ", row.created_at.toISOString(), row.action);
  console.log(JSON.stringify(row.request_payload, null, 1).slice(0, 6000));
}

await pool.end();