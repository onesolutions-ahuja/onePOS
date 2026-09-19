import test from "node:test";
import assert from "node:assert/strict";
import { enqueueOfflineSale, syncOfflineQueue, getQueueEntries } from "../src/services/offlineQueue.js";

// Browser storage persists independently of the queue module's in-memory state.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const tenant = { companyId: 1, storeId: 2, id: 3 };
const queueKey = "onepos_offline_queue_1_2";
const firstKey = "11111111-1111-4111-8111-111111111111";
const secondKey = "22222222-2222-4222-8222-222222222222";
const sale = (clientRequestId) => ({
  clientRequestId, paymentMethod: "cash", total: 5,
  items: [{ productId: 1, quantity: 1, unitPrice: 5, total: 5 }],
});
function seed() {
  storage.clear();
  localStorage.setItem("onepos_token", `x.${Buffer.from(JSON.stringify(tenant)).toString("base64url")}.x`);
  localStorage.setItem(queueKey, JSON.stringify({
    v: 1, tenant: { companyId: 1, storeId: 2 },
    data: [{ id: "first", clientRequestId: firstKey, status: "pending", attempts: 0,
      tenant: { companyId: 1, storeId: 2 }, sale: sale(firstKey) }],
  }));
}

test("sale added while sync is awaiting its response is not overwritten", async () => {
  seed();
  const originalFetch = globalThis.fetch;
  let release;
  let started;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  const response = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => { started(); return response; };
  try {
    const syncing = syncOfflineQueue();
    await requestStarted;
    // Model another till tab's append to the same persistent queue. It can
    // happen while this tab awaits fetch, without invoking its JS module.
    const stored = JSON.parse(localStorage.getItem(queueKey));
    stored.data.push({ id: "second", clientRequestId: secondKey, status: "pending",
      attempts: 0, tenant: { companyId: 1, storeId: 2 }, sale: sale(secondKey) });
    localStorage.setItem(queueKey, JSON.stringify(stored));
    release({ ok: true, status: 201, json: async () => ({ success: true, sale: { id: 10 } }) });
    await syncing;
    assert.deepEqual(getQueueEntries().map((entry) => entry.clientRequestId), [secondKey]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a cash sale can be appended through the public queue API", () => {
  seed();
  const result = enqueueOfflineSale({ sale: sale(secondKey) });
  assert.equal(result.ok, true);
  assert.deepEqual(getQueueEntries().map((entry) => entry.clientRequestId), [firstKey, secondKey]);
});

// ---- Offline hardening regressions; browser storage outlives modules ----
import { beforeEach, afterEach } from "node:test";
import { newClientRequestId, getQueueSnapshot, retryFailedEntry, acknowledgeQueuedSale, getSyncStats, startAutoSync } from "../src/services/offlineQueue.js";
import { saveProductCache, loadProductCache, saveSettingsCache, loadSettingsCache, saveOfflineSession, loadOfflineSession, clearOfflineSession } from "../src/services/offlineStore.js";
import { reportConnection, isOnline, isNetworkError } from "../src/services/networkStatus.js";
const savedFetch = globalThis.fetch;
const scope = { companyId: 1, storeId: 2 };
const ok = (id = 10) => ({ ok: true, status: 201, json: async () => ({ success: true, sale: { id, receipt_number: `T-${id}` } }) });
const idle = async () => { for (let i = 0; i < 250 && getQueueSnapshot().syncing; i++) await new Promise((r) => setTimeout(r, 2)); };
beforeEach(() => { seed(); reportConnection(true); });
afterEach(async () => { await idle(); globalThis.fetch = savedFetch; });

test("offline catalogue supports name/SKU/barcode lookup without secrets", () => {
  saveProductCache(scope, [{ id: 1, name: "Tea", sku: "TEA", barcode: "00123", price: 5, stock: 10, secret: "NEVER", cost: 2 }]);
  reportConnection(false);
  const products = loadProductCache(scope);
  assert.equal(products.find((p) => p.barcode === "00123").name, "Tea");
  assert.equal(products.filter((p) => p.name.toLowerCase().includes("tea")).length, 1);
  assert.equal(products[0].sku, "TEA");
  assert.equal(products[0].secret, undefined);
  assert.equal(products[0].cost, undefined);
  saveSettingsCache(scope, { tax: { vatEnabled: true, defaultVatRate: 20 }, secret: "NEVER" });
  assert.equal(loadSettingsCache(scope).secret, undefined);
});

test("queue survives module reload with stable UUID and exact payload", async () => {
  const key = newClientRequestId();
  assert.match(key, /^[a-f0-9-]{36}$/i);
  assert.notEqual(key, newClientRequestId());
  enqueueOfflineSale({ sale: sale(key) });
  const reloaded = await import(`../src/services/offlineQueue.js?reload=${key}`);
  assert.equal(reloaded.getQueueEntries().at(-1).clientRequestId, key);
  assert.deepEqual(JSON.parse(storage.get(queueKey)).data.at(-1).sale, sale(key));
});

test("duplicate enqueue uses one record and successful sync is acknowledged", async () => {
  enqueueOfflineSale({ sale: sale(firstKey) });
  assert.equal(getQueueEntries().length, 1);
  let requests = 0;
  globalThis.fetch = async (url, options) => { requests++; assert.equal(url, "/api/sales"); assert.equal(JSON.parse(options.body).clientRequestId, firstKey); return ok(); };
  await syncOfflineQueue();
  await syncOfflineQueue();
  assert.equal(requests, 1);
  assert.equal(getQueueSnapshot().total, 0);
  assert.equal(getSyncStats().syncedTotal, 1);
});

test("rejection retained safely and manual retry reuses key", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({ success: false, message: "SECRET" }) });
  await syncOfflineQueue();
  assert.equal(getQueueSnapshot().failed, 1);
  assert.doesNotMatch(JSON.stringify(getQueueEntries()), /SECRET/);
  globalThis.fetch = async (_, options) => { assert.equal(JSON.parse(options.body).clientRequestId, firstKey); return ok(); };
  assert.equal(retryFailedEntry(getQueueEntries()[0].id).ok, true);
  await idle();
  assert.equal(getQueueSnapshot().total, 0);
});

test("ambiguous timeout after server commit retries same idempotency key", async () => {
  // Simulated server ledger; the real route's lock/unique key is exercised in E2E.
  const serverSales = new Map();
  let calls = 0;
  globalThis.fetch = async (_, options) => {
    const payload = JSON.parse(options.body);
    if (!serverSales.has(payload.clientRequestId)) serverSales.set(payload.clientRequestId, 10);
    if (++calls === 1) throw new DOMException("Timed out", "TimeoutError");
    return ok(serverSales.get(payload.clientRequestId));
  };
  await syncOfflineQueue();
  assert.equal(getQueueSnapshot().total, 1);
  await syncOfflineQueue();
  assert.equal(serverSales.size, 1);
  assert.equal(getQueueSnapshot().total, 0);
});

test("duplicate sync clicks collapse into a single request", async () => {
  let release;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise((r) => { release = r; }); };
  const first = syncOfflineQueue();
  assert.equal(getQueueSnapshot().syncing, true);
  const second = await syncOfflineQueue();
  assert.equal(second.skipped, true);
  release(ok());
  await first;
  await idle();
  assert.equal(calls, 1);
});

test("FIFO blocks newer sales behind failed oldest and resumes in order", async () => {
  enqueueOfflineSale({ sale: sale(secondKey) });
  const order = [];
  globalThis.fetch = async (_, options) => { order.push(JSON.parse(options.body).clientRequestId); return { ok: false, status: 400, json: async () => ({ success: false }) }; };
  await syncOfflineQueue();
  await syncOfflineQueue();
  assert.deepEqual(order, [firstKey]);
  globalThis.fetch = async (_, options) => { order.push(JSON.parse(options.body).clientRequestId); return ok(order.length); };
  retryFailedEntry(getQueueEntries()[0].id);
  await idle();
  assert.deepEqual(order, [firstKey, firstKey, secondKey]);
});

for (const status of [401, 429, 500, 503]) test(`HTTP ${status} retains pending sale`, async () => {
  globalThis.fetch = async () => ({ ok: false, status, json: async () => ({ success: false }) });
  await syncOfflineQueue();
  assert.equal(getQueueSnapshot().total, 1);
});

test("invalid 2xx acknowledgement never removes a sale", async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true }) });
  await syncOfflineQueue();
  assert.equal(getQueueSnapshot().total, 1);
});

test("online acknowledgement and late duplicate response count once", () => {
  assert.equal(acknowledgeQueuedSale(firstKey, { id: 10 }), true);
  assert.equal(acknowledgeQueuedSale(firstKey, { id: 10 }), true);
  assert.equal(getQueueSnapshot().total, 0);
  assert.equal(getSyncStats().syncedTotal, 1);
});

test("storage failure retains queued sale", async () => {
  const set = localStorage.setItem;
  localStorage.setItem = () => { throw new Error("Quota"); };
  try {
    assert.equal(enqueueOfflineSale({ sale: sale(secondKey) }).ok, false);
    globalThis.fetch = async () => ok();
    await syncOfflineQueue();
    assert.equal(getQueueSnapshot().total, 1);
  } finally { localStorage.setItem = set; }
});

test("unconfirmed card entries are never sent automatically", async () => {
  storage.delete(queueKey);
  enqueueOfflineSale({ sale: { ...sale(firstKey), paymentMethod: "card" } });
  let calls = 0;
  globalThis.fetch = async () => { calls++; return ok(); };
  await syncOfflineQueue();
  assert.equal(calls, 0);
  assert.equal(getQueueEntries()[0].paymentUnverified, true);
});

test("reconnect event automatically drains retained sale", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  let connected = false;
  globalThis.fetch = async () => { if (!connected) throw new TypeError("Network down"); return ok(); };
  const stop = startAutoSync({ pollMs: 0 });
  try {
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(getQueueSnapshot().total, 1);
    connected = true;
    window.dispatchEvent(new Event("online"));
    await idle();
    assert.equal(getQueueSnapshot().total, 0);
    assert.equal(isOnline(), true);
  } finally { stop(); globalThis.window = previousWindow; }
});

test("verified session survives outage, masks secrets and rejects changed/expired token", async () => {
  const token = `x.${Buffer.from(JSON.stringify({ ...tenant, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.x`;
  storage.set("onepos_token", token);
  const user = { id: 3, ...scope, email: "private", secret: "NEVER" };
  assert.equal(await saveOfflineSession(user, { isAdmin: false, permissions: ["sale.create", "sale.discount", "admin.users"] }), true);
  const cached = await loadOfflineSession();
  assert.deepEqual(cached.permissions.permissions, ["sale.create", "sale.discount"]);
  assert.equal(cached.user.email, undefined);
  assert.equal(storage.get("onepos_offline_session").includes(token), false);
  storage.set("onepos_token", token + "changed");
  assert.equal(await loadOfflineSession(), null);
  storage.set("onepos_token", token);
  const record = JSON.parse(storage.get("onepos_offline_session"));
  record.expiresAt = 1;
  storage.set("onepos_offline_session", JSON.stringify(record));
  assert.equal(await loadOfflineSession(), null);
  clearOfflineSession();
  assert.equal(await loadOfflineSession(), null);
});

test("network classification leaves validation/auth errors online", () => {
  assert.equal(isNetworkError({ status: 403, name: "TypeError" }), false);
  assert.equal(isNetworkError(new DOMException("timeout", "TimeoutError")), true);
  /* Backend-authoritative semantics (networkStatus.isOnline): marking the
     backend unreachable defers to navigator.onLine, which does not exist in
     Node — so a reportConnection(false) round-trip must still end online
     once the backend reports reachable again. The core guarantee under test:
     validation/auth errors are NEVER classified as network failures and a
     connectivity flap is recoverable. */
  reportConnection(false);
  reportConnection(true);
  assert.equal(isOnline(), true);
});
