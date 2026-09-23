import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
  assert.match(source, /\.\.\.\(databaseForm\.password \? \{\} : \{ password: undefined \}\)/);
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
