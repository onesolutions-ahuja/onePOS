import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { systemWriteError, tenantFields } from "../services/platformSystemObjects.js";
import { saveDomainConfiguration, readDomainConfiguration, withDomainSave } from "../services/platformDomainRecords.js";
import { initializePlatformMetadata } from "../services/platformMetadata.js";

test("business writes remain protected through renamed metadata and tenant fields stay isolated", () => {
  for (const source_table of ["products", "customers", "sales", "users", "suppliers", "stores", "purchases", "inventory_movements", "online_orders"]) {
    assert.equal(systemWriteError({ object_key: "alias", source_table }).code, "SYSTEM_OBJECT_OPERATION_REQUIRED");
  }
  assert.equal(systemWriteError({ object_key: "sample", source_table: "samples" }), null);
  assert.deepEqual(tenantFields([{ id: 1, company_id: null }, { id: 2, company_id: "a" }, { id: 3, company_id: "b" }], "a").map(field => field.id), [1, 2]);
});

test("PostgreSQL: Product extensions, validation rollback, workflows, FLS and tenant isolation", { skip: process.env.PLATFORM_DOMAIN_DB_TEST !== "1" }, async () => {
  await import("dotenv/config");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000, statement_timeout: 15000, max: 1 });
  const client = await pool.connect();
  const db = client.query.bind(client);
  const schema = `platform_test_${randomUUID().replaceAll("-", "")}`;
  const a = randomUUID(), b = randomUUID(), role = randomUUID(), user = randomUUID(), id = randomUUID();
  const req = { user: { companyId: a, roleId: role, id: user }, body: { platform: { customFields: { shelf: "A1" } } } };
  try {
    await db("BEGIN");
    await db(`CREATE SCHEMA "${schema}"`);
    await db(`SET LOCAL search_path TO "${schema}"`);
    await db("CREATE TABLE companies (id uuid PRIMARY KEY); CREATE TABLE roles (id uuid PRIMARY KEY); CREATE TABLE users (id uuid PRIMARY KEY,company_id uuid,full_name text,username text,email text,active boolean,password_hash text); CREATE TABLE products (id uuid PRIMARY KEY,company_id uuid,name text,sku text,barcode text,price numeric,active boolean); CREATE TABLE customers (id uuid PRIMARY KEY,company_id uuid,name text); CREATE TABLE suppliers (id uuid PRIMARY KEY,company_id uuid,name text); CREATE TABLE stores (id uuid PRIMARY KEY,company_id uuid,name text)");
    await db("INSERT INTO companies VALUES ($1),($2)", [a, b]);
    await db("INSERT INTO roles VALUES ($1)", [role]);
    await db("INSERT INTO users (id) VALUES ($1)", [user]);
    await initializePlatformMetadata(client);
    await initializePlatformMetadata(client);
    assert.equal((await db("SELECT * FROM platform_objects")).rows.length, 6);
    const object = (await db("SELECT * FROM platform_objects WHERE object_key='product'")).rows[0];
    const field = (await db("INSERT INTO platform_fields (object_id,company_id,api_name,label,field_type,required,writable,config) VALUES ($1,$2,'shelf','Shelf','text',true,true,'{\"storage\":\"extension\"}') RETURNING *", [object.id, a])).rows[0];
    await db("INSERT INTO platform_fields (object_id,company_id,api_name,label,field_type,writable,config) VALUES ($1,$2,'shelf','Other company shelf','text',true,'{\"storage\":\"extension\"}')", [object.id, b]);
    const record = (await db("INSERT INTO products VALUES ($1,$2,'Milk','MILK','123',2,true) RETURNING *", [id,a])).rows[0];
    const result = await saveDomainConfiguration({ db, key: "product", req, record });
    assert.equal(result.customFields.shelf, "A1");
    assert.equal((await db("SELECT * FROM platform_record_history WHERE record_id=$1", [id])).rows.some(row => row.field_api_name === "shelf"), true);
    assert.equal((await readDomainConfiguration(db,"product",req,id)).customFields.shelf, "A1");
    await assert.rejects(readDomainConfiguration(db,"product",{ ...req, user: { ...req.user, companyId:b } },id), /Record not found/);
    await db("INSERT INTO platform_rules (object_id,name,trigger_key,conditions,action,active,company_id) VALUES ($1,'Reject forbidden shelf','before_save','[{\"field\":\"shelf\",\"operator\":\"equals\",\"value\":\"blocked\"}]','{\"type\":\"validation\",\"message\":\"Shelf unavailable\"}',true,$2)", [object.id,a]);
    await db("SAVEPOINT invalid_product");
    const invalid = (await db("UPDATE products SET name='Must roll back' WHERE id=$1 RETURNING *", [id])).rows[0];
    await assert.rejects(saveDomainConfiguration({ db,key:"product",req:{ ...req,body:{ platform:{customFields:{shelf:"blocked"}}}},record:invalid,previous:record }), /Shelf unavailable/);
    await db("ROLLBACK TO SAVEPOINT invalid_product");
    assert.equal((await db("SELECT name FROM products WHERE id=$1",[id])).rows[0].name,"Milk");
    assert.equal((await db("SELECT custom_values FROM platform_record_associations WHERE record_id=$1",[id])).rows[0].custom_values.shelf,"A1");
    await db("INSERT INTO platform_rules (object_id,name,trigger_key,conditions,action,active,company_id) VALUES ($1,'Assign shelf','after_save','[{\"field\":\"name\",\"operator\":\"is_not_empty\"}]','{\"type\":\"set_field\",\"field\":\"shelf\",\"value\":\"B2\"}',true,$2)",[object.id,a]);
    const changed = await saveDomainConfiguration({db,key:"product",req:{...req,body:{}},record,previous:record});
    assert.equal(changed.customFields.shelf,"B2");
    await db("INSERT INTO platform_field_security VALUES ($1,$2,$3,false,false)",[field.id,role,a]);
    assert.deepEqual((await readDomainConfiguration(db,"product",req,id)).customFields,{});
    await assert.rejects(saveDomainConfiguration({db,key:"product",req,record,previous:record}), /not editable/);
    assert.equal((await db("SELECT COUNT(*)::int AS count FROM platform_record_associations")).rows[0].count,1);
    // The master/profile adapters all use this same transaction wrapper. Check
    // actual rows and metadata rather than accepting a successful HTTP mock.
    const transactionalPool = { connect: async () => ({ query: async (sql,params) => {
      if(sql === "BEGIN") return db("SAVEPOINT profile_operation");
      if(sql === "COMMIT") return db("RELEASE SAVEPOINT profile_operation");
      if(sql === "ROLLBACK") return db("ROLLBACK TO SAVEPOINT profile_operation");
      return db(sql,params);
    },release(){} }) };
    for (const [key,table,nameColumn] of [["customer","customers","name"],["supplier","suppliers","name"],["employee","users","full_name"],["store","stores","name"]]) {
      const definition=(await db("SELECT id FROM platform_objects WHERE object_key=$1",[key])).rows[0];
      await db("INSERT INTO platform_fields (object_id,company_id,api_name,label,field_type,writable,config) VALUES ($1,$2,'reference_c','Reference','text',true,'{\"storage\":\"extension\"}')",[definition.id,a]);
      const profileId=randomUUID();
      const profileReq={...req,platformCompanyCustomers:true,body:{platform:{customFields:{reference_c:"verified"}}}};
      await withDomainSave({pool:transactionalPool,db,savePlatformRecord:saveDomainConfiguration,key,req:profileReq,write:query=>query(`INSERT INTO "${table}" (id,company_id,"${nameColumn}") VALUES ($1,$2,'Original') RETURNING id,company_id,"${nameColumn}"`,[profileId,a])});
      assert.equal((await readDomainConfiguration(db,key,profileReq,profileId)).customFields.reference_c,"verified");
      await assert.rejects(withDomainSave({pool:transactionalPool,db,savePlatformRecord:saveDomainConfiguration,key,req:{...profileReq,body:{platform:{customFields:{unknown_field:"invalid"}}}},id:profileId,write:query=>query(`UPDATE "${table}" SET "${nameColumn}"='Must roll back' WHERE id=$1 RETURNING id,company_id,"${nameColumn}"`,[profileId])}), /not editable/);
      assert.equal((await db(`SELECT "${nameColumn}" AS name FROM "${table}" WHERE id=$1`,[profileId])).rows[0].name,"Original");
      await assert.rejects(readDomainConfiguration(db,key,{...profileReq,user:{...req.user,companyId:b}},profileId),/Record not found/);
    }
    const staffObject=(await db("SELECT id FROM platform_objects WHERE object_key='employee'")).rows[0];
    await db("INSERT INTO platform_fields (object_id,api_name,label,field_type,source_column) VALUES ($1,'password_hash','Never expose','text','password_hash')",[staffObject.id]);
    assert.equal((await readDomainConfiguration(db,"employee",req)).fields.some(field=>field.source_column==="password_hash"),false);
  } finally {
    await db("ROLLBACK");
    client.release(); await pool.end();
  }
});
