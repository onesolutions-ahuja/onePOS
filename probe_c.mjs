import pg from "pg";
import fs from "fs";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const l of raw.split(/\r?\n/)) { const i = l.indexOf("="); if (i>0) env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const r=await pool.query("SELECT id,name,available_on_uber,available_on_deliveroo,stock_quantity,track_stock FROM products LIMIT 5");
console.log(JSON.stringify(r.rows,null,1));
await pool.query("UPDATE products SET available_on_deliveroo=TRUE, available_on_uber=TRUE WHERE id=$1",[r.rows[0].id]);
console.log("enabled flags for",r.rows[0].id);
await pool.end();
