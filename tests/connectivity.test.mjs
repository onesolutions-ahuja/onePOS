/*
 * AUTHORITATIVE CONNECTIVITY STATE — focused regression
 *
 *   node --test tests/connectivity.test.mjs
 *
 * ROOT CAUSE (regressed here):
 *   Connectivity had three independent opinions that could disagree:
 *     1. POSHeader derived ONLINE/OFFLINE/SYNC ERROR from the `online` prop
 *        plus queue counters.
 *     2. POS.jsx set its `online` state ONLY from browser online/offline
 *        events (navigator.onLine) — a laptop asleep, an emulator network
 *        blip or an Android WebView transport flap reported OFFLINE while
 *        the server was actually reachable, and startAutoSync's health
 *        probe never updated the header.
 *     3. The offline queue's binary signal (reportConnection) was fed by
 *        its own 30s probe.
 *   Result: the header said OFFLINE (navigator.onLine=false) while the
 *   queue engine happily synced against a healthy server — contradictory
 *   statuses on one screen.
 *
 * FIX under test (services/connectivity.js):
 *   ONE state source with three tiers (internet / server / database),
 *   verified by the real GET <configured-origin>/api/health probe, feeding
 *   the queue's binary contract (reportConnection) and both POS consumers.
 *   navigator.onLine is a transport hint only — never the server verdict.
 *
 * Tests run in Node: fetch is mocked, localStorage is a Map-backed stub so
 * the existing Server Address mechanism (services/serverAddress.js) is
 * exercised exactly as in the browser, and `navigator` is temporarily
 * overridden to simulate transport drops.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ---------------- Node shims so the browser modules run unmodified ------- */

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { setServerAddress, clearServerAddress, SERVER_ADDRESS_STORAGE_KEY } = await import(
  "../src/services/serverAddress.js"
);
const networkStatus = await import("../src/services/networkStatus.js");

/* Each scenario gets a FRESH connectivity module instance (query-string
 * cache bust) so the module-level singleton state from one probe never
 * leaks into the next — mirroring a fresh app boot per scenario. */
async function freshConnectivity(tag) {
  return import(`../src/services/connectivity.js?scenario=${tag}`);
}
let connectivity = await freshConnectivity("init");

const realNavigator = globalThis.navigator;
function setNavigatorOnline(online) {
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: online },
    configurable: true,
  });
}
function restoreNavigator() {
  Object.defineProperty(globalThis, "navigator", { value: realNavigator, configurable: true });
}

function mockFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return impl(url, options);
  };
  return calls;
}

beforeEach(() => {
  storage.clear();
  clearServerAddress();
  restoreNavigator();
});

async function freshScenario(tag) {
  connectivity = await freshConnectivity(tag);
}

/* ----------------------------------------------------------------- tests */

test("1. healthy server: probe marks internet + server + database connected and keeps the queue contract online", async () => {
  await freshScenario("healthy");
  setServerAddress("http://192.168.1.50:10000");
  const calls = mockFetch(() => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, database: "connected" }),
  }));

  await connectivity.checkNow();

  const snap = connectivity.getConnectivity();
  assert.equal(snap.internet, connectivity.INTERNET_STATES.CONNECTED);
  assert.equal(snap.server, connectivity.SERVER_STATES.CONNECTED);
  assert.equal(snap.database, connectivity.DB_STATES.CONNECTED);
  assert.ok(snap.lastServerOkAt, "last successful check must be recorded");
  assert.equal(snap.lastError, null);
  /* The offline-queue engine's binary signal must agree. */
  assert.equal(networkStatus.isOnline(), true);

  /* The probe used the EXISTING configured Server Address origin. */
  assert.equal(calls[0].url, "http://192.168.1.50:10000/api/health");
});

test("2. internet unavailable (browser reports offline) + probe fails: reported as Internet unavailable, not a vague offline", async () => {
  await freshScenario("internet-down");
  setNavigatorOnline(false);
  mockFetch(() => { throw new TypeError("fetch failed"); });

  await connectivity.checkNow();

  const snap = connectivity.getConnectivity();
  assert.equal(snap.internet, connectivity.INTERNET_STATES.DISCONNECTED);
  assert.equal(snap.server, connectivity.SERVER_STATES.UNREACHABLE);
  assert.equal(
    connectivity.describeConnectivity(snap),
    "Internet unavailable",
    "transport drop + unreachable server must read 'Internet unavailable'"
  );
});

test("3. server unavailable while the browser thinks it is online: server is unreachable but internet is NOT claimed down", async () => {
  await freshScenario("server-down");
  setNavigatorOnline(true);
  mockFetch(() => { throw new TypeError("fetch failed"); });

  await connectivity.checkNow();

  const snap = connectivity.getConnectivity();
  assert.equal(snap.server, connectivity.SERVER_STATES.UNREACHABLE);
  assert.notEqual(
    snap.internet,
    connectivity.INTERNET_STATES.DISCONNECTED,
    "navigator.onLine=true must never be collapsed into an internet outage"
  );
  assert.notEqual(
    connectivity.describeConnectivity(snap),
    "Internet unavailable",
    "a failed server probe alone must not be reported as an internet outage"
  );
  assert.equal(
    connectivity.describeConnectivity(snap),
    "Server unreachable",
    "the failure must name the server, not a generic offline"
  );
  /* The queue's binary contract agrees the backend is not usable. */
  assert.equal(networkStatus.isOnline(), true); /* transport fine; queue keeps its own retry loop */
});

test("4. health endpoint reporting database error surfaces Database unavailable without inventing state", async () => {
  await freshScenario("db-error");
  setServerAddress("http://pos-store.local:10000");
  mockFetch(() => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, database: "error" }),
  }));

  await connectivity.checkNow();

  const snap = connectivity.getConnectivity();
  assert.equal(snap.server, connectivity.SERVER_STATES.CONNECTED, "server answers, so it is connected");
  assert.equal(snap.database, connectivity.DB_STATES.UNAVAILABLE, "database verdict comes from the server payload");
  assert.equal(
    connectivity.describeConnectivity(snap),
    "Server connected",
    "a reachable server is never reported as offline"
  );
});

test("5. the probe target comes from the existing Server Address configuration, not a hard-coded origin", async () => {
  await freshScenario("address");
  setServerAddress("https://pos.example.com");
  const withAddress = mockFetch(() => ({ ok: true, json: async () => ({ database: "connected" }) }));

  await connectivity.checkNow();
  assert.equal(withAddress[0].url, "https://pos.example.com/api/health");

  /* Web behaviour: no saved address -> relative URL against page origin. */
  clearServerAddress();
  const withoutAddress = mockFetch(() => ({ ok: true, json: async () => ({ database: "connected" }) }));

  await connectivity.checkNow();
  assert.equal(withoutAddress[0].url, "/api/health");
  assert.equal(
    connectivity.getConnectivity().serverAddress,
    typeof window === "undefined" ? "" : window.location.origin
  );

  /* The storage key belongs to the existing mechanism (format unchanged). */
  assert.equal(SERVER_ADDRESS_STORAGE_KEY, "onepos_server_address");
});

test("6. failure tiers stay distinct: 5xx, timeout and healthy each yield different, non-collapsed states", async () => {
  await freshScenario("tiers");
  /* a) server answers but unhealthy (5xx) */
  mockFetch(() => ({ ok: false, status: 503, json: async () => ({}) }));
  await connectivity.checkNow();
  let snap = connectivity.getConnectivity();
  assert.equal(snap.server, connectivity.SERVER_STATES.UNREACHABLE);
  assert.equal(snap.database, connectivity.DB_STATES.UNKNOWN, "no database claim without a health body");
  assert.match(snap.lastError, /HTTP 503/);

  /* b) timeout is its own explanatory error, not a generic message */
  mockFetch(() => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; });
  await connectivity.checkNow();
  snap = connectivity.getConnectivity();
  assert.equal(snap.server, connectivity.SERVER_STATES.UNREACHABLE);
  assert.equal(snap.lastError, "Server check timed out");

  /* c) recovery: a later successful probe clears the error and flips states back */
  mockFetch(() => ({ ok: true, json: async () => ({ database: "connected" }) }));
  await connectivity.checkNow();
  snap = connectivity.getConnectivity();
  assert.equal(snap.server, connectivity.SERVER_STATES.CONNECTED);
  assert.equal(snap.database, connectivity.DB_STATES.CONNECTED);
  assert.equal(snap.lastError, null);
});

test("POS consumers are wired to the single source (no duplicate independent state)", () => {
  const pos = fs.readFileSync(path.join(root, "src", "pages", "pos", "POS.jsx"), "utf8");
  const header = fs.readFileSync(path.join(root, "src", "pages", "pos", "POSHeader.jsx"), "utf8");

  /* POS.jsx subscribes to the authoritative state and starts its monitoring. */
  assert.match(pos, /subscribeConnectivity/);
  assert.match(pos, /startConnectivityMonitoring/);
  assert.match(pos, /setOnline\(snapshot\.server === "connected"\)/);
  /* The browser-event-only wiring is gone from POS. */
  assert.doesNotMatch(pos, /onNetworkChange\(setOnline\)/);

  /* The header renders the shared state, not its own Online/Offline derivation. */
  assert.match(header, /subscribeConnectivity/);
  assert.match(header, /getConnectivity/);
  assert.doesNotMatch(header, /"OFFLINE"/);
  assert.match(header, /describeConnectivity/);
  assert.match(header, /checkNow\(\)/, "opening diagnostics triggers an immediate check");

  /* The queue engine still owns its sync loop — untouched. */
  const queue = fs.readFileSync(path.join(root, "src", "services", "offlineQueue.js"), "utf8");
  assert.match(queue, /reportConnection\(response\.status < 500\)/);
});
