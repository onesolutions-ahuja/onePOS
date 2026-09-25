import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { executePlatformAutomations } from "../services/platformAutomation.js";

test("Platform CRUD is the canonical record command boundary for system and custom objects", () => {
  const platform = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
  assert.doesNotMatch(platform, /SYSTEM_OBJECT_OPERATION_REQUIRED|systemWriteError/);
  assert.match(platform, /router\.post\("\/platform\/objects\/:objectKey\/records"/);
  assert.match(platform, /router\.put\("\/platform\/objects\/:objectKey\/records\/:recordId"/);
  assert.match(platform, /router\.delete\("\/platform\/objects\/" \+ ":objectKey\/records\/" \+ ":recordId"/);
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
