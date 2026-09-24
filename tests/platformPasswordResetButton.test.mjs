import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const metadata = fs.readFileSync(new URL("../services/platformMetadata.js", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../services/platformWorkflow.js", import.meta.url), "utf8");
const lifecycle = fs.readFileSync(new URL("../routes/accountLifecycle.js", import.meta.url), "utf8");

test("employee password reset is a registered metadata button/action", () => {
  assert.match(metadata, /employee\.send_password_reset/);
  assert.match(metadata, /send_password_reset/);
  assert.match(metadata, /SEND_PASSWORD_RESET_EMAIL/);
  assert.match(metadata, /users\.manage/);
});

test("password reset action uses configured expiry and queues registered email delivery", () => {
  assert.match(workflow, /password_reset_expiry_minutes/);
  assert.match(workflow, /issueAccountToken/);
  assert.match(workflow, /kind: "SEND_EMAIL"/);
  assert.match(workflow, /templateKey: "PASSWORD_RESET"/);
});

test("reset token is consumed only by successful password update statement", () => {
  assert.match(lifecycle, /WITH claimed AS/);
  assert.match(lifecycle, /UPDATE account_action_tokens SET used_at=NOW\(\)/);
  assert.match(lifecycle, /UPDATE users u SET password_hash=\$2/);
  assert.doesNotMatch(lifecycle, /consumeAccountToken\(db,\{token,purpose:"PASSWORD_RESET"\}\)/);
});
