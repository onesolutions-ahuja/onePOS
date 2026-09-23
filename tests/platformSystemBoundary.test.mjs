import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createPlatformRouter from "../routes/platform.js";
import { executePlatformAutomations } from "../services/platformAutomation.js";

test("generic create/update/delete/import cannot bypass a business module through an alias", async t => {
  const writes = [];
  const object = { id: "object-a", object_key: "alias", source_table: "products", active: true, company_id: "company-a", company_scoped: true };
  const db = async (sql) => {
    if (sql.startsWith("SELECT * FROM platform_objects")) return { rows: [object] };
    if (sql.startsWith("SELECT * FROM platform_fields")) return { rows: [] };
    writes.push(sql); return { rows: [] };
  };
  const app = express(); app.use(express.json());
  app.use(createPlatformRouter({ db,
    authenticate(req, res, next) { if (!req.headers.authorization) return res.sendStatus(401); req.user = {companyId:"company-a"}; next(); },
    authorize: () => (req,res,next) => req.headers.authorization === "denied" ? res.sendStatus(403) : next(),
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  t.after(() => {server.closeAllConnections(); server.close();});
  const base = `http://127.0.0.1:${server.address().port}/platform/objects/alias/records`;
  for (const [method,suffix] of [["POST",""],["PUT","/a0000000-0000-4000-8000-000000000001"],["DELETE","/a0000000-0000-4000-8000-000000000001"],["POST","/import"],["POST","/import/validate"]]) {
    const response = await fetch(base+suffix,{method,headers:{Authorization:"allowed","Content-Type":"application/json"},body:JSON.stringify({data:{price:1},csv:"price\n1"})});
    assert.equal(response.status,409);
    assert.equal((await response.json()).code,"SYSTEM_OBJECT_OPERATION_REQUIRED");
  }
  assert.equal((await fetch(base,{method:"POST"})).status,401);
  assert.equal((await fetch(base,{method:"POST",headers:{Authorization:"denied"}})).status,403);
  assert.deepEqual(writes,[]);
});

test("workflows cannot write protected business fields even when metadata says writable", async () => {
  const writes=[];
  const fields=[{api_name:"price",source_column:"price",field_type:"currency",active:true,writable:true}];
  const db=async (sql) => {
    if(sql.startsWith("SELECT * FROM platform_rules")) return {rows:[{id:"rule",conditions:[{field:"price",operator:"greater_than",value:0}],action:{type:"set_field",field:"price",value:0}}]};
    writes.push(sql);return {rows:[]};
  };
  const result=await executePlatformAutomations({db,object:{id:"o",source_table:"products",company_scoped:true},fields,record:{price:2},recordId:"p",trigger:"after_update",req:{user:{companyId:"a"}}});
  assert.equal(result.record.price,2);
  assert.equal(result.executions[0].status,"skipped");
  assert.equal(writes.some(sql=>sql.startsWith("UPDATE")),false);
});
