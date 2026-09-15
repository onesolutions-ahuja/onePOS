import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const orderNew = await pool.query(
  `SELECT created_at, action, request_headers, request_payload
   FROM platform_api_logs
   WHERE platform = 'deliveroo' AND action = 'WEBHOOK_ORDER_NEW'
   ORDER BY created_at DESC LIMIT 1`
);
const statusUpdate = await pool.query(
  `SELECT created_at, action, request_payload
   FROM platform_api_logs
   WHERE platform = 'deliveroo' AND action = 'WEBHOOK_ORDER_STATUS_UPDATE'
   ORDER BY created_at DESC LIMIT 1`
);

console.log("=== ORDER_NEW row ===");
console.log(JSON.stringify(orderNew.rows[0], null, 2).slice(0, 6000));
console.log("=== STATUS_UPDATE row (keys only) ===");
const su = statusUpdate.rows[0];
console.log(JSON.stringify(su, null, 2).slice(0, 3000));

await pool.end();