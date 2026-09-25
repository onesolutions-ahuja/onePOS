import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const platform = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
const objectPage = fs.readFileSync(new URL("../src/pages/settings/Platform/ObjectPage.jsx", import.meta.url), "utf8");

test("Platform Record Page uses canonical record commands for every object", () => {
  assert.match(objectPage, /\/api\/platform\/objects\/\$\{encodeURIComponent\(resolvedObjectKey\)\}\/records/);
  assert.doesNotMatch(objectPage, /SYSTEM_OBJECT_OPERATION_REQUIRED|moduleManagedObject|recordAdapter/);
});

test("Platform record routes do not redirect system objects to legacy CRUD", () => {
  assert.doesNotMatch(platform, /systemWriteError/);
  assert.match(platform, /router\.post\("\/platform\/objects\/:objectKey\/records"/);
  assert.match(platform, /router\.put\("\/platform\/objects\/:objectKey\/records\/:recordId"/);
  assert.match(platform, /router\.delete\("\/platform\/objects\/" \+ ":objectKey\/records\/" \+ ":recordId"/);
});
