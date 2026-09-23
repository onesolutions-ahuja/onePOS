import test from "node:test";
import assert from "node:assert/strict";
import {
  canAccessDestination,
  normalizeDeviceProfile,
  resolveLandingPage,
} from "../services/runtimeAccess.js";

const access = {
  enabledModules: new Set(["retail_pos"]),
  permissions: ["sale.view"],
};

test("landing resolution follows override, profile defaults, and permitted fallbacks", () => {
  assert.equal(resolveLandingPage({ ...access, userOverride: "pos" }), "/app");
  assert.equal(resolveLandingPage({ ...access, deviceProfile: "till" }), "/app");
  assert.equal(resolveLandingPage({ ...access, deviceProfile: "admin" }), "/app/dashboard");
  assert.equal(resolveLandingPage({ ...access, userOverride: "platform", profileDefault: "pos" }), "/app");
});

test("landing destinations require enabled module and permission", () => {
  assert.equal(canAccessDestination("pos", { enabledModules: new Set(), permissions: ["sale.view"] }), false);
  assert.equal(canAccessDestination("pos", { ...access }), true);
  assert.equal(canAccessDestination("pos", { ...access, permissions: [] }), false);
  assert.equal(resolveLandingPage({ enabledModules: new Set(), permissions: [], userOverride: "pos" }), null);
});

test("device profile is preference-only and has a safe default", () => {
  assert.equal(normalizeDeviceProfile("till"), "till");
  assert.equal(normalizeDeviceProfile("admin"), "admin");
  assert.equal(normalizeDeviceProfile("till-with-admin"), "admin");
  assert.equal(resolveLandingPage({ ...access, deviceProfile: "till", permissions: [] }), null);
});
