import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const r = await pool.query(
  `SELECT id, created_at, action, request_payload
   FROM platform_api_logs
   WHERE platform = 'deliveroo' AND action = 'WEBHOOK_ORDER_NEW'
   ORDER BY created_at DESC LIMIT 1`
);

if (!r.rows.length) {
  console.log("no rows");
} else {
  const p = r.rows[0].request_payload;
  console.log("action:", r.rows[0].action, "at", r.rows[0].created_at);
  console.log("top keys:", Object.keys(p || {}));
  const body = p && p.body ? p.body : null;
  console.log("body keys:", body ? Object.keys(body) : null);
  const o = body && body.order ? body.order : null;
  console.log("order keys:", o ? Object.keys(o) : null);
  if (o) {
    const items = o.items || [];
    console.log("item count:", items.length);
    if (items[0]) {
      console.log("ITEM0 =", JSON.stringify(items[0], null, 2));
    }
    console.log("status:", o.status, "| brand_id:", o.brand_id, "| id:", o.id);
    console.log("sample money fields:", JSON.stringify({
      subtotal: o.subtotal,
      total: o.total,
      delivery_fee: o.delivery_fee,
    }));
    console.log("customer-ish:", JSON.stringify({
      customer: o.customer,
      delivery: o.delivery,
      fulfilment_type: o.fulfilment_type,
    }));
  }
}

await pool.end();
