import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { databaseConfigurationPayload } from "../src/services/tenantDatabaseForm.js";

const sourcePath = new URL("../src/pages/superadmin/LicensingAdmin.jsx", import.meta.url);

test("Superadmin licensing UI contains independent client-admin provisioning controls", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /data-testid="client-admin-provisioning"/);
  assert.match(source, /id="client-admin-email"/);
  assert.match(source, /Provision initial Company Admin/);
  assert.match(source, /\/provision-admin/);
  assert.match(source, /method:\s*"POST"/);
  assert.match(source, /finally \{\s*setDatabaseBusy\(false\);\s*\}/);
  assert.match(source, /signal:\s*AbortSignal\.timeout\(30000\)/);
  assert.match(source, /databaseConfig\?\.credentialsConfigured/);
  assert.match(source, /JSON\.stringify\(databaseConfigurationPayload\(databaseForm\)\)/);
});

test("Superadmin can manage independent package, bundle, and tier marketplace policies", async () => {
  const source = await readFile(sourcePath, "utf8");
  for (const endpoint of [
    "/api/superadmin/packages",
    "/api/superadmin/bundles",
    "/api/superadmin/tiers",
    "/marketplace",
  ]) assert.ok(source.includes(endpoint), `UI uses ${endpoint}`);
  for (const control of [
    "OneApps marketplace packages",
    "Bundle marketplace visibility",
    "Tier marketplace visibility",
    "system_only",
    "Billable",
    "Licence mode",
    "Allowed company IDs",
    "Allowed tier keys",
  ]) assert.ok(source.includes(control), `UI exposes ${control}`);
});

test("database save sends an entered password and omits a blank password to preserve saved credentials", () => {
  const form = {
    databaseMode: "CUSTOMER_MANAGED", host: "db.example", port: "5432",
    database: "postgres", username: "tenant", sslMode: "require", password: "fixture-password",
  };
  const payload = JSON.parse(JSON.stringify(databaseConfigurationPayload(form)));
  assert.equal(payload.password, "fixture-password");
  assert.equal(payload.port, 5432);
  assert.equal(form.password, "fixture-password");
  const unchanged = JSON.parse(JSON.stringify(databaseConfigurationPayload({ ...form, password: "" })));
  assert.equal(Object.hasOwn(unchanged, "password"), false);
  assert.deepEqual(unchanged, {
    databaseMode: "CUSTOMER_MANAGED", host: "db.example", port: 5432,
    database: "postgres", username: "tenant", sslMode: "require",
  });
});

test("provisioning code only submits the selected company and admin email", async () => {
  const source = await readFile(sourcePath, "utf8");
  assert.match(
    source,
    /`\/api\/superadmin\/companies\/\$\{databaseCompany\}\/provision-admin`/
  );
  assert.match(source, /JSON\.stringify\(\{ email: clientAdminEmail \}\)/);
  assert.doesNotMatch(source, /provision-admin[\s\S]{0,500}databaseForm/);
});
