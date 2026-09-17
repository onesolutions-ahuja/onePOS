import pg from "pg";
import fs from "fs";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const l of raw.split(/\r?\n/)) { const i = l.indexOf("="); if (i>0) env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const r=await pool.query("SELECT pid,usename,state,wait_event_type,wait_event,query_start,now()-query_start AS dur,left(query,120) AS q FROM pg_stat_activity WHERE datname='onepos' ORDER BY query_start");
for (const row of r.rows) console.log(JSON.stringify(row));
const l2=await pool.query("SELECT locktype,mode,granted,count(*) FROM pg_locks GROUP BY 1,2,3 ORDER BY 1,2");
console.log(JSON.stringify(l2.rows,null,1));
await pool.end();
