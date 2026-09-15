import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const r = await pool.query(`
  SELECT action, created_at, request_payload
  FROM platform_api_logs
  WHERE platform = 'deliveroo'
    AND action IN ('WEBHOOK_ORDER_NEW','WEBHOOK_ORDER_STATUS_UPDATE')
  ORDER BY created_at DESC
  LIMIT 2
`);

for (const row of r.rows) {
  console.log("=== action:", row.action, "at", row.created_at.toISOString());
  console.log(JSON.stringify(row.request_payload, null, 2));
}

await pool.end();