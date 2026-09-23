import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const automation = readFileSync(new URL("../services/platformAutomation.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");
const ruleEditor = readFileSync(new URL("../src/pages/settings/Platform/RuleEditor.jsx", import.meta.url), "utf8");

test("platform automation evaluates tenant-scoped after-save rules", () => {
  assert.match(automation, /trigger_key IN \(\$3,'after_save'\)/);
  assert.match(automation, /evaluateCondition/);
  assert.match(automation, /company_id=\$2/);
});

test("generic create and update execute after-save automations", () => {
  assert.match(routes, /executePlatformAutomations\(\{ db, object, fields, record: calculate\(result\.rows\[0\]\), recordId: result\.rows\[0\]\.id, trigger: "after_create"/);
  assert.match(routes, /executePlatformAutomations\(\{ db, object, fields, record: calculate\(result\.rows\[0\]\), recordId: result\.rows\[0\]\.id, trigger: "after_update"/);
  assert.match(routes, /messages: automation\.messages/);
});

test("rule editor exposes automation actions", () => {
  assert.match(ruleEditor, /set_field/);
  assert.match(ruleEditor, /show_message/);
});
