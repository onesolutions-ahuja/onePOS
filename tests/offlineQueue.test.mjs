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
