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

test("Uber connector and menu capabilities are registered workflow actions", () => {
  for (const key of [
    "UBER_GET_STORES",
    "UBER_TEST_CONNECTION",
    "UBER_UPLOAD_MENU",
    "UBER_ACCEPT_ORDER",
    "UBER_DENY_ORDER",
    "UBER_UPDATE_ITEM_PRICE",
    "UBER_SET_ITEM_UNAVAILABLE",
    "UBER_SET_ITEM_AVAILABLE",
  ]) {
    const action = getRegisteredPlatformAction(key);
    assert.ok(action, `${key} should be registered`);
    assert.ok(
      action.requiredPermissions.includes(
        key === "UBER_ACCEPT_ORDER" || key === "UBER_DENY_ORDER"
          ? "online_orders.manage"
          : "online_orders.configure"
      )
    );
  }
});
