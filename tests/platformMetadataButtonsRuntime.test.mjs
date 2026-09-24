import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const objectPage = fs.readFileSync("app/src/pages/settings/Platform/ObjectPage.jsx", "utf8");
const platformRoute = fs.readFileSync("server/routes/platform.js", "utf8");

test("record page renders registered metadata buttons instead of adapter-owned action buttons", () => {
  assert.match(objectPage, /\/api\/platform\/objects\/\$\{encodeURIComponent\(objectId\)\}\/buttons/);
  assert.match(objectPage, /recordButtons\.map/);
  assert.doesNotMatch(objectPage, /recordAdapter\?\.actions\?\.map/);
});

test("metadata buttons execute through the registered button runtime", () => {
  assert.match(objectPage, /\/buttons\/\$\{encodeURIComponent\(button\.button_key\)\}\/execute/);
  assert.match(platformRoute, /records\/:recordId\/buttons\/:buttonKey\/execute/);
  assert.match(platformRoute, /SELECT \* FROM platform_buttons WHERE object_id=\$1 AND button_key=\$2/);
  assert.match(platformRoute, /button\.target_type === "workflow"/);
  assert.match(platformRoute, /resolveButtonTarget\(req/);
});

test("canonical record save and delete buttons reuse record-page lifecycle", () => {
  assert.match(objectPage, /targetKey === "RECORD_SAVE"/);
  assert.match(objectPage, /targetKey === "RECORD_DELETE"/);
});
