import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const rows = await pool.query(`
  SELECT created_at, action, success, request_payload, response_body
  FROM platform_api_logs
  WHERE platform = 'deliveroo' AND request_payload IS NOT NULL
  ORDER BY created_at DESC
  LIMIT 12
`);

for (const row of rows.rows) {
  const payload = row.request_payload;
  const top = Object.keys(payload || {});
  const body = payload && payload.body ? Object.keys(payload.body) : null;
  const order = payload && payload.body && payload.body.order ? payload.body.order : null;
  const items = order && Array.isArray(order.items) ? order.items : null;
  const firstItem = items && items[0] ? items[0] : null;

  console.log("=".repeat(70));
  console.log(row.created_at, row.action, "success=" + row.success);
  console.log("top-level keys:", JSON.stringify(top));
  if (typeof payload.event !== "undefined") console.log("payload.event:", JSON.stringify(payload.event));
  if (typeof payload.event_type !== "undefined") console.log("payload.event_type:", JSON.stringify(payload.event_type));
  if (body) console.log("body keys:", JSON.stringify(body));
  if (payload.body && payload.body.event_type) console.log("body.event_type:", JSON.stringify(payload.body.event_type));
  if (payload.body && payload.body.event) console.log("body.event:", JSON.stringify(payload.body.event));
  if (order) {
    console.log("order keys:", JSON.stringify(Object.keys(order)));
    console.log("order.id:", JSON.stringify(order.id));
    console.log("order.status:", JSON.stringify(order.status));
    console.log("order.item_count:", items ? items.length : null);
    console.log("order.money_fields:", JSON.stringify({
      subtotal: order.subtotal, total: order.total, price: order.price,
      delivery_fee: order.delivery_fee, fees: order.fees, taxes: order.taxes,
    }));
    console.log("order.brand_id:", JSON.stringify(order.brand_id), "site_id:", JSON.stringify(order.site_id), "restaurant_id:", JSON.stringify(order.restaurant_id));
    console.log("order.customer keys:", order.customer ? JSON.stringify(Object.keys(order.customer)) : null);
  }
  if (firstItem) {
    console.log("ITEM[0] keys:", JSON.stringify(Object.keys(firstItem)));
    console.log("ITEM[0]:", JSON.stringify(firstItem).slice(0, 1600));
  }
}

await pool.end();