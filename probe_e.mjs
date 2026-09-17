import fs from "fs";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const l of raw.split(/\r?\n/)) { const i = l.indexOf("="); if (i>0) env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const BASE="http://localhost:10000";
const lr = await fetch(BASE+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"Admin12345"})});
const lj = await lr.json();
const token=lj.token;
async function api(m,p,b){
  const o={method:m,headers:{"Content-Type":"application/json",Authorization:"Bearer "+token}};
  if(b!==undefined) o.body=JSON.stringify(b);
  const r=await fetch(BASE+p,o); const t=await r.text();
  return {status:r.status,raw:t.slice(0,1200)};
}
import pg from "pg";
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const pr=await pool.query("SELECT id FROM products WHERE active=true AND available_on_deliveroo=true LIMIT 1");
const pid=pr.rows[0].id;
const b={platform:"deliveroo",externalOrderId:"LIVE-"+Date.now(),items:[{productId:pid,quantity:1}]};
const r=await api("POST","/api/online/orders",b);
console.log(r.status); console.log(r.raw);
await pool.end();
