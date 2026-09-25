import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

function createFakeIndexedDb({ failWrites = false } = {}) {
  const values = new Map();
  const store = {
    get(key) {
      const request = {};
      queueMicrotask(() => {
        request.result = values.get(key);
        request.onsuccess?.();
      });
      return request;
    },
    put(value, key) {
      const request = {};
      queueMicrotask(() => {
        if (failWrites) {
          request.error = new Error("IndexedDB write failed");
          request.onerror?.();
          return;
        }
        values.set(key, structuredClone(value));
        request.onsuccess?.();
      });
      return request;
    },
  };
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store }),
  };
  return {
    values,
    open: () => {
      const request = { result: db };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}

function token() {
  const payload = Buffer.from(JSON.stringify({ companyId: "company-a", storeId: "store-a", id: "user-a" })).toString("base64url");
  return `x.${payload}.x`;
}

function legacyEntry(id, clientRequestId) {
  return {
    id,
    clientRequestId,
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    tenant: { companyId: "company-a", storeId: "store-a", userId: "user-a" },
    sale: { clientRequestId, paymentMethod: "cash", total: 1, items: [] },
  };
}

test("legacy localStorage queue migrates to IndexedDB and is removed only after verification", async () => {
  const fake = createFakeIndexedDb();
  globalThis.indexedDB = { open: fake.open };
  storage.clear();
  storage.set("onepos_token", token());
  const entry = legacyEntry("queue-a", "request-a");
  storage.set("onepos_offline_queue_company-a_store-a", JSON.stringify({
    v: 1,
    tenant: { companyId: "company-a", storeId: "store-a" },
    data: [entry],
  }));

  const queue = await import(`../src/services/offlineQueue.js?indexeddb-migration=${Date.now()}`);
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  await queue.syncOfflineQueue();

  assert.equal(storage.has("onepos_offline_queue_company-a_store-a"), false);
  assert.deepEqual(fake.values.get("company-a:store-a"), [entry]);
  delete globalThis.indexedDB;
});

test("migration failure preserves the legacy queue for a later retry", async () => {
  const fake = createFakeIndexedDb({ failWrites: true });
  globalThis.indexedDB = { open: fake.open };
  storage.clear();
  storage.set("onepos_token", token());
  const entry = legacyEntry("queue-b", "request-b");
  const key = "onepos_offline_queue_company-a_store-a";
  const legacy = JSON.stringify({ v: 1, tenant: { companyId: "company-a", storeId: "store-a" }, data: [entry] });
  storage.set(key, legacy);

  const queue = await import(`../src/services/offlineQueue.js?indexeddb-failure=${Date.now()}`);
  await assert.rejects(() => queue.syncOfflineQueue(), /IndexedDB write failed|Offline queue initialization failed/);
  assert.equal(storage.get(key), legacy);
  delete globalThis.indexedDB;
});
