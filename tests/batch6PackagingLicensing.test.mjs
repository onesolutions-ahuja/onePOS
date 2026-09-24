import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { packageDefinition } from "../server/services/packageRegistry.js";
import { getCompanyEntitlements, getUserLicenceState } from "../server/services/licensing.js";

test("packages declare licence entitlement keys", () => {
  assert.equal(packageDefinition({ key: "retail_pos" }).manifest.entitlementKey, "pos");
  assert.equal(packageDefinition({ key: "customer_credit" }).manifest.entitlementKey, "credit_control");
  assert.equal(packageDefinition({ key: "online_orders" }).manifest.entitlementKey, "online_orders");
});

test("expired company licence disables services without deleting package metadata", async () => {
  const db=async()=>({rows:[{active:true,starts_at:null,expires_at:new Date(Date.now()-1000),entitlements:{pos:true}}]});
  assert.deepEqual(await getCompanyEntitlements(db,"c"),{});
});

test("user licence assignment has independent active and expiry state", async () => {
  const expired=async()=>({rows:[{assignment_active:true,assignment_starts_at:null,assignment_expires_at:new Date(Date.now()-1000),licence_active:true,licence_starts_at:null,licence_expires_at:null}]});
  assert.equal((await getUserLicenceState(expired,"c","u")).reason,"EXPIRED");
  const active=async()=>({rows:[{assignment_active:true,assignment_starts_at:null,assignment_expires_at:new Date(Date.now()+60000),licence_active:true,licence_starts_at:null,licence_expires_at:new Date(Date.now()+60000)}]});
  assert.equal((await getUserLicenceState(active,"c","u")).active,true);
});

test("package fields are classified as required/default metadata contracts", () => {
  const source=fs.readFileSync(new URL("../server/services/packageRegistry.js",import.meta.url),"utf8");
  assert.match(source,/packageContract: field.required === true \? "required" : "default"/);
  assert.match(source,/packageOwned: true/);
});

test("licence schema preserves data and tracks assignment dates", () => {
  const schema=fs.readFileSync(new URL("../server/database/schema.sql",import.meta.url),"utf8");
  assert.match(schema,/user_licence_assignments ADD COLUMN IF NOT EXISTS active/);
  assert.match(schema,/user_licence_assignments ADD COLUMN IF NOT EXISTS starts_at/);
  assert.match(schema,/user_licence_assignments ADD COLUMN IF NOT EXISTS expires_at/);
  assert.doesNotMatch(schema,/DELETE FROM .*licen/i);
});
