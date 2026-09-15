import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function summarize(value, depth = 0) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) {
    return `[array len=${value.length}]` + (value.length && depth < 2 ? ` first=${summarize(value[0], depth + 1)}` : "");
  }
  if (typeof value === "object") {
    if (depth > 2) return "{...}";
    return `{${Object.keys(value).map((k) => `${k}:${summarize(value[k], depth + 1)}`).join(", ")}}`;
  }
  if (typeof value === "string" && value.length > 60) return `"${value.slice(0, 60)}..."(len=${value.length})`;
  return JSON.stringify(value);
}

const r = await pool.query(
  `SELECT action, response_status, request_payload
   FROM platform_api_logs
   WHERE platform = 'deliveroo' AND response_status = 200
   ORDER BY created_at DESC LIMIT 3`
);
for (const row of r.rows) {
  console.log("=== action:", row.action, "status:", row.response_status);
  const p = row.request_payload;
  if (p && typeof p === "object") {
    console.log("top-level keys:", Object.keys(p).join(", "));
    for (const k of Object.keys(p)) {
      console.log(`  ${k}:`, summarize(p[k], 1).slice(0, 500));
    }
  } else {
    console.log("payload (non-object):", String(p).slice(0, 300));
  }
}
await pool.end();
