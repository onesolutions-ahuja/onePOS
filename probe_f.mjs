import pg from "pg";
import fs from "fs";
const raw = fs.readFileSync(".env", "utf8");
const env = {};
for (const l of raw.split(/\r?\n/)) { const i = l.indexOf("="); if (i>0) env[l.slice(0,i).trim()]=l.slice(i+1).trim(); }
const BASE="http://localhost:10000";
const lr = await fetch(BASE+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"admin",password:"Admin12345"})});
const lj = await lr.json();
const token=lj.token;
const pool=new pg.Pool({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
async function api(m,p,b){
  const o={method:m,headers:{"Content-Type":"application/json",Authorization:"Bearer "+token}};
  if(b!==undefined) o.body=JSON.stringify(b);
  const r=await fetch(BASE+p,o); const t=await r.text();
  let j; try{j=JSON.parse(t);}catch{j={raw:t};}
  return {status:r.status,body:j};
}
async function st(id){ const r=await pool.query("SELECT status FROM online_orders WHERE id=$1",[id]); return r.rows[0]?.status; }
async function lg(id){ const r=await pool.query("SELECT action,response_status,success,error_message FROM platform_api_logs WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1",[id]); return r.rows[0]||null; }
const pr=await pool.query("SELECT id FROM products WHERE active=true AND available_on_deliveroo=true LIMIT 1");
const pid=pr.rows[0].id;
async function mk(tag,otp){
  const b={platform:"deliveroo",externalOrderId:"LIVE2-"+Date.now()+"-"+tag,items:[{productId:pid,quantity:1}]};
  if(otp) b.otp=otp;
  const r=await api("POST","/api/online/orders",b);
  const id=r.body?.data?.order?.id;
  console.log("INTAKE",tag,r.status,"id=",id,"status=",r.body?.data?.order?.status);
  return id;
}
const a=await mk("a1"); const rj=await mk("r1"); const rd=await mk("rd1"); const cc=await mk("c1");
const o1=await mk("otp1","7777"); const n1=await mk("nootp1");
let r1=await api("POST","/api/online/orders/"+a+"/accept",{});
console.log("ACCEPT",r1.status,JSON.stringify(r1.body).slice(0,400),"DB->",await st(a),"LOG",JSON.stringify(await lg(a)));
let r2=await api("POST","/api/online/orders/"+rj+"/reject",{reason:"t"});
console.log("REJECT",r2.status,JSON.stringify(r2.body).slice(0,400),"DB->",await st(rj),"LOG",JSON.stringify(await lg(rj)));
await api("POST","/api/online/orders/"+rd+"/accept",{});
console.log("rd after accept:",await st(rd));
let r3=await api("POST","/api/online/orders/"+rd+"/ready",{});
console.log("READY-from-ACCEPTED",r3.status,JSON.stringify(r3.body).slice(0,400),"DB->",await st(rd),"LOG",JSON.stringify(await lg(rd)));
let r3b=await api("POST","/api/online/orders/"+rd+"/preparing",{});
console.log("PREPARING-from-ACCEPTED",r3b.status,JSON.stringify(r3b.body).slice(0,400),"DB->",await st(rd),"LOG",JSON.stringify(await lg(rd)));
let r3c=await api("POST","/api/online/orders/"+rd+"/ready",{});
console.log("READY-from-PREPARING",r3c.status,JSON.stringify(r3c.body).slice(0,400),"DB->",await st(rd),"LOG",JSON.stringify(await lg(rd)));
let r4=await api("POST","/api/online/orders/"+rd+"/complete",{});
console.log("COMPLETE-nootp-order-nobody",r4.status,JSON.stringify(r4.body).slice(0,500),"DB->",await st(rd),"LOG",JSON.stringify(await lg(rd)));
await api("POST","/api/online/orders/"+cc+"/accept",{});
let r6=await api("POST","/api/online/orders/"+cc+"/cancel",{reason:"t"});
console.log("CANCEL",r6.status,JSON.stringify(r6.body).slice(0,400),"DB->",await st(cc),"LOG",JSON.stringify(await lg(cc)));
await api("POST","/api/online/orders/"+o1+"/accept",{});
await api("POST","/api/online/orders/"+o1+"/preparing",{});
await api("POST","/api/online/orders/"+o1+"/ready",{});
console.log("otp order at ready:",await st(o1));
let rc1=await api("POST","/api/online/orders/"+o1+"/complete",{});
console.log("COMPLETE-otp-missing",rc1.status,JSON.stringify(rc1.body).slice(0,500),"DB->",await st(o1));
let rc2=await api("POST","/api/online/orders/"+o1+"/complete",{otp:"0000"});
console.log("COMPLETE-otp-wrong",rc2.status,JSON.stringify(rc2.body).slice(0,500),"DB->",await st(o1));
let rc3=await api("POST","/api/online/orders/"+o1+"/complete",{otp:"7777"});
console.log("COMPLETE-otp-ok",rc3.status,JSON.stringify(rc3.body).slice(0,500),"DB->",await st(o1),"LOG",JSON.stringify(await lg(o1)));
await pool.end();
