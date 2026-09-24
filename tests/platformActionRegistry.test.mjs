import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ACTION_REGISTRY, getRegisteredPlatformAction } from "../services/platformActionRegistry.js";

test("registered platform action keys are unique", () => {
  const keys = PLATFORM_ACTION_REGISTRY.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("canonical record save/delete capabilities are registered", () => {
  assert.ok(getRegisteredPlatformAction("RECORD_SAVE"));
  assert.ok(getRegisteredPlatformAction("RECORD_DELETE"));
});
