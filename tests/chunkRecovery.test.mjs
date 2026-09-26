import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claimChunkRecovery, isChunkLoadError } from "../src/utils/chunkRecovery.js";

const source = readFileSync(new URL("../src/components/dev/DevErrorBoundary.jsx", import.meta.url), "utf8");
const recoverySource = readFileSync(new URL("../src/utils/chunkRecovery.js", import.meta.url), "utf8");

test("chunk recovery detects lazy module failures without matching unrelated errors", () => {
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module")), true);
  assert.equal(isChunkLoadError(new Error("Loading chunk 19 failed")), true);
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
});

test("automatic recovery is claimed once per build signature", () => {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
  };

  assert.equal(claimChunkRecovery(storage, "build-a", {}), true);
  assert.equal(claimChunkRecovery(storage, "build-a", {}), false);
  assert.equal(claimChunkRecovery(storage, "build-b", {}), true);
});

test("the URL fallback also prevents loops when session storage is unavailable", () => {
  const fallback = {};
  assert.equal(claimChunkRecovery(null, "build-a", fallback), true);
  assert.equal(claimChunkRecovery(null, "build-a", fallback), false);
});

test("the boundary revalidates once and provides manual Retry and Go Home actions", () => {
  assert.match(source, /__chunk_recovery/);
  assert.match(source, /__reload/);
  assert.match(recoverySource, /onepos:chunk-recovery/);
  assert.match(source, /onClick=\{retryChunkLoad\}/);
  assert.match(source, /Go Home/);
  assert.match(source, /if \(isChunkLoadError\(error\)\)/);
});
