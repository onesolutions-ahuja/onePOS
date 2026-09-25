import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("settings uses hierarchical categories, permission-filtered search source, and compact content width", () => {
  const settings = read("../src/pages/settings/SettingsAdmin.jsx");
  const css = read("../src/index.css");
  assert.match(settings, /settings-categories/);
  assert.match(settings, /Search settings/);
  assert.match(settings, /const searchResults = settingsQuery\.trim\(\) \? tabs\.filter/);
  assert.match(css, /grid-template-columns: minmax\(220px, 260px\) minmax\(0, 1fr\)/);
});

test("settings is excluded from the operational dock launcher", () => {
  const dock = read("../src/components/AdminNavDock.jsx");
  assert.match(dock, /filter\(\(name\) => name !== "Settings"\)/);
  assert.doesNotMatch(dock, /"Accounting", "Settings", "Audit Log"/);
});

test("field access lives in Object Manager and is absent from role object permissions", () => {
  const objectEditor = read("../src/pages/settings/Platform/ObjectEditor.jsx");
  const settings = read("../src/pages/settings/SettingsAdmin.jsx");
  assert.match(objectEditor, /FieldAccessDialog/);
  assert.match(objectEditor, /\/api\/platform\/fields\/\$\{fieldId\}\/security/);
  assert.doesNotMatch(settings, /Field visibility and edit access/);
});

test("Business Division is removed as a built-in capability", () => {
  const server = read("../server.js");
  const metadata = read("../services/platformMetadata.js");
  const schema = read("../database/schema.sql");
  assert.doesNotMatch(server, /createBusinessDivisionsRouter/);
  assert.doesNotMatch(metadata, /key: "business_division"/);
  assert.doesNotMatch(schema, /CREATE TABLE IF NOT EXISTS business_divisions/);
});

test("AppExchange uninstall blocks package-owned business records", () => {
  const packages = read("../routes/packages.js");
  assert.match(packages, /PACKAGE_RECORDS_EXIST/);
  assert.match(packages, /information_schema\.columns/);
  assert.match(packages, /Package cannot be uninstalled while package-owned records exist/);
});

test("custom buttons can only reference registered actions", () => {
  const platform = read("../routes/platform.js");
  assert.match(platform, /UNREGISTERED_HANDLER/);
  assert.match(platform, /listRegisteredPlatformActions\(\)/);
  assert.match(platform, /Button must reference a registered action/);
  assert.match(platform, /platform_registered_actions/);
  assert.match(platform, /platform_buttons/);
});
