/* Batch 3.1 schema verification (temporary, deleted after testing) */
import pg from "pg";
import fs from "fs";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const col = await pool.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name='sales' AND column_name='online_order_id'"
);
console.log("sales.online_order_id column exists:", col.rows.length > 0);

const idx = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename='sales' AND indexname='ux_sales_online_order'");
console.log("ux_sales_online_order index exists:", idx.rows.length > 0);

const fk = await pool.query("SELECT conname FROM pg_constraint WHERE conname='fk_sales_online_order'");
console.log("fk_sales_online_order constraint exists:", fk.rows.length > 0);

const salesCount = await pool.query("SELECT COUNT(*)::int AS n FROM sales");
console.log("sales rows:", salesCount.rows[0].n);

await pool.end();
console.log("done");
