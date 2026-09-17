import pg from "pg";
import fs from "fs";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const l of raw.split(/\r?\n/)) { const i = l.indexOf("="); if (i>0) env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const r=await pool.query("SELECT action,order_id,success,error_message,response_status,created_at FROM platform_api_logs ORDER BY created_at DESC LIMIT 8");
console.log(JSON.stringify(r.rows,null,1));
await pool.end();
