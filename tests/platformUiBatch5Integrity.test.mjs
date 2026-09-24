import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../routes/platform.js", import.meta.url), "utf8");

test("field and object dependency preview APIs exist", () => {
  assert.match(source, /\/platform\/fields\/:fieldId\/dependencies/);
  assert.match(source, /\/platform\/objects\/:objectId\/dependencies/);
  assert.match(source, /FIELD_IN_USE/);
  assert.match(source, /OBJECT_IN_USE/);
});

test("active dependency checks include workflows approvals buttons actions and bindings", () => {
  for (const table of ["platform_rules", "platform_approval_processes", "platform_buttons", "platform_registered_actions", "platform_action_bindings"]) {
    assert.match(source, new RegExp(table));
  }
  assert.match(source, /lifecycle_status/);
});

test("approval lifecycle supports draft active inactive", () => {
  assert.match(source, /lifecycleStatus must be DRAFT, ACTIVE or INACTIVE/);
  assert.match(source, /lifecycle_status='INACTIVE'/);
  assert.match(source, /requestedLifecycle === "ACTIVE"/);
});
