import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apiRequest } from "../src/services/api.js";

const platformHome = readFileSync(
  new URL("../src/pages/settings/Platform/PlatformHome.jsx", import.meta.url),
  "utf8"
);
const platformRoutes = readFileSync(
  new URL("../routes/platform.js", import.meta.url),
  "utf8"
);
const settingsRoutes = readFileSync(
  new URL("../routes/settings.js", import.meta.url),
  "utf8"
);
const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("Platform Settings constructs the authenticated metadata requests correctly", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const calls = [];
  globalThis.localStorage = { getItem: () => null };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ success: true, data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await apiRequest("/api/platform/metadata");
    await apiRequest("/api/platform/modules");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalStorage;
  }
  assert.deepEqual(calls.map((call) => call.url), ["/api/platform/metadata", "/api/platform/modules"]);
  assert.match(platformHome, /apiRequest/);
  assert.doesNotMatch(platformHome, /fetch\(`\$\{API_BASE\}\/platform/);
});

test("Platform Settings backend routes are mounted with existing authorization", () => {
  assert.match(platformRoutes, /router\.get\("\/platform\/metadata", \.\.\.manage/);
  assert.match(platformRoutes, /router\.get\("\/platform\/modules", \.\.\.manage/);
  assert.match(settingsRoutes, /router\.get\("\/settings", authenticate/);
  assert.match(settingsRoutes, /router\.put\("\/settings", authenticate/);
  assert.match(server, /app\.use\("\/api", createPlatformRouter/);
  assert.match(server, /app\.use\("\/api", createSettingsRouter/);
});
