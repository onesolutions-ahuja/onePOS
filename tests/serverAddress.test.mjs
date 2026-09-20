/*
 * Contract tests for services/serverAddress.js.
 * These define the behaviour the native app depends on: the saved server
 * origin must be prefixed onto RELATIVE /api URLs only, and never onto
 * absolute or protocol-relative ones. Web behaviour (no address saved) must
 * stay exactly what it was before. Run with: node --test tests/
 */
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import {
  clearServerAddress,
  getServerAddress,
  isNativeApp,
  normaliseServerAddress,
  resolveApiUrl,
  SERVER_ADDRESS_STORAGE_KEY,
  setServerAddress,
} from "../src/services/serverAddress.js";

/* Minimal localStorage stub, same shape as tests/offlineQueue.test.mjs. */
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

beforeEach(() => storage.clear());

test("normaliseServerAddress keeps the origin and drops path/query", () => {
  assert.equal(normaliseServerAddress("192.168.1.50:10000"), "http://192.168.1.50:10000");
  assert.equal(normaliseServerAddress("  http://192.168.1.50:10000/pos "), "http://192.168.1.50:10000");
  assert.equal(normaliseServerAddress("https://pos.example.com/api?x=1"), "https://pos.example.com");
  assert.equal(normaliseServerAddress("POS.example.com:10000"), "http://pos.example.com:10000");
});

test("normaliseServerAddress rejects unusable input", () => {
  assert.equal(normaliseServerAddress(""), "");
  assert.equal(normaliseServerAddress("   "), "");
  assert.equal(normaliseServerAddress(null), "");
  assert.equal(normaliseServerAddress("ftp://host"), "");
  assert.equal(normaliseServerAddress("javascript:alert(1)"), "");
  assert.equal(normaliseServerAddress("http://"), "");
});

test("set/get/clear round-trips the saved address", () => {
  assert.equal(getServerAddress(), "");
  assert.equal(setServerAddress("192.168.1.50:10000"), "http://192.168.1.50:10000");
  assert.equal(getServerAddress(), "http://192.168.1.50:10000");
  assert.equal(storage.get(SERVER_ADDRESS_STORAGE_KEY), "http://192.168.1.50:10000");
  clearServerAddress();
  assert.equal(getServerAddress(), "");
});

test("a broken address clears storage instead of being persisted", () => {
  setServerAddress("http://good:10000");
  assert.equal(setServerAddress("not a url ??"), "");
  assert.equal(getServerAddress(), "");
  assert.equal(storage.has(SERVER_ADDRESS_STORAGE_KEY), false);
});

test("storage failure must not throw", () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  try {
    assert.equal(getServerAddress(), "");
    assert.equal(setServerAddress("192.168.1.50:10000"), "http://192.168.1.50:10000");
  } finally {
    globalThis.localStorage = original;
  }
});

test("resolveApiUrl prefixes only relative URLs when an address is saved", () => {
  assert.equal(resolveApiUrl("/api/auth/login"), "/api/auth/login"); /* nothing saved yet */
  setServerAddress("192.168.1.50:10000");
  assert.equal(resolveApiUrl("/api/auth/login"), "http://192.168.1.50:10000/api/auth/login");
  assert.equal(resolveApiUrl("/api/sales/42/receipt"), "http://192.168.1.50:10000/api/sales/42/receipt");
  /* absolute and protocol-relative URLs are never rewritten */
  assert.equal(resolveApiUrl("https://elsewhere.example.com/api"), "https://elsewhere.example.com/api");
  assert.equal(resolveApiUrl("//cdn.example.com/api"), "//cdn.example.com/api");
  assert.equal(resolveApiUrl(undefined), "");
});

test("isNativeApp only reports true for the Capacitor shell", () => {
  const previous = globalThis.window;
  try {
    globalThis.window = undefined;
    assert.equal(isNativeApp(), false);
    globalThis.window = {};
    assert.equal(isNativeApp(), false);
    globalThis.window = { Capacitor: { isNativePlatform: () => true } };
    assert.equal(isNativeApp(), true);
    globalThis.window = { Capacitor: { platform: "android" } };
    assert.equal(isNativeApp(), true);
    globalThis.window = { Capacitor: { platform: "web" } };
    assert.equal(isNativeApp(), false);
  } finally {
    globalThis.window = previous;
  }
});

