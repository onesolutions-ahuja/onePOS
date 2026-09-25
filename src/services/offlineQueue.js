/*
|--------------------------------------------------------------------------
| Offline sale queue (T8C-F)
|--------------------------------------------------------------------------
|
| Frontend queue + sync engine for POS sales created while the network is
| down. IndexedDB is authoritative; localStorage is used only to migrate
| queues created by older builds.
|
| Guarantees:
|  - Only TRANSPORT failures are queued; server answers (400/403/500) are
|    never queued (the caller decides - this module only stores/syncs).
|  - The cart is cleared by POS only after the queue write succeeds.
|  - Sync is FIFO (oldest first), removes an entry only after a 2xx, keeps
|    transport-failed entries pending, marks server-rejected entries
|    "failed" (retained for review, never retried automatically).
|  - The same clientRequestId is reused for every retry, so the backend's
|    client_request_id idempotency (T8C-SMALL) can never create a duplicate.
|  - Every read/write goes through the current session tenant; records
|    belonging to another company/store are rejected by offlineStore.
|
| No new dependencies. Provisional receipt numbers are terminal-scoped and
| display-only (the server owns authoritative numbering later).
*/

import {
  getTenantFromToken,
} from "./offlineStore.js";
import { isNetworkError, onNetworkChange, reportConnection } from "./networkStatus.js";

/*
 * The queue lives in a PER-TENANT IndexedDB record: a different company/store
 * logged in on the same terminal can neither read, consume, nor overwrite
 * another tenant's unsynced sales.
 */
function queueKeyFor(tenant) {
  return `onepos_offline_queue_${tenant.companyId}_${tenant.storeId}`;
}

const QUEUE_DB_NAME = "onepos_offline_transactions";
const QUEUE_DB_VERSION = 1;
const QUEUE_STORE_NAME = "queues";
const queueCache = new Map();
const queueReady = new Map();

function tenantKey(tenant) {
  return `${tenant.companyId}:${tenant.storeId}`;
}

function openQueueDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB_NAME, QUEUE_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        request.result.createObjectStore(QUEUE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbRead(tenant) {
  return openQueueDatabase().then((db) => {
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const request = db.transaction(QUEUE_STORE_NAME, "readonly")
        .objectStore(QUEUE_STORE_NAME).get(tenantKey(tenant));
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error);
    });
  });
}

function idbWrite(tenant, entries) {
  return openQueueDatabase().then((db) => {
    if (!db) return false;
    return new Promise((resolve, reject) => {
      const request = db.transaction(QUEUE_STORE_NAME, "readwrite")
        .objectStore(QUEUE_STORE_NAME).put(entries, tenantKey(tenant));
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  });
}

function readLegacyQueue(tenant) {
  try {
    const raw = localStorage.getItem(queueKeyFor(tenant));
    if (!raw) return [];
    const record = JSON.parse(raw);
    const stored = record?.tenant || {};
    if (record?.v !== 1 || !Array.isArray(record.data) ||
        stored.companyId !== tenant.companyId || stored.storeId !== tenant.storeId) return [];
    return record.data.filter((entry) =>
      entry?.id && entry.clientRequestId && entry.sale &&
      entry.tenant?.companyId === tenant.companyId &&
      entry.tenant?.storeId === tenant.storeId
    );
  } catch {
    return [];
  }
}

async function ensureQueueReady(tenant) {
  if (!tenant) return [];
  if (typeof indexedDB === "undefined") {
    const entries = readLegacyQueue(tenant);
    queueCache.set(tenantKey(tenant), entries);
    return entries;
  }
  const key = tenantKey(tenant);
  if (queueReady.has(key)) return queueReady.get(key);
  const ready = (async () => {
    const db = await openQueueDatabase();
    if (!db) {
      /* Test/non-browser environments have no IndexedDB. */
      queueCache.set(key, queueCache.get(key) || readLegacyQueue(tenant));
      return queueCache.get(key);
    }
    let entries = await idbRead(tenant);
    if (!entries.length) {
      const legacy = readLegacyQueue(tenant);
      if (legacy.length) {
        await idbWrite(tenant, legacy);
        const verified = await idbRead(tenant);
        if (!verified || verified.length !== legacy.length ||
            verified.some((entry, index) => entry.id !== legacy[index].id)) {
          throw new Error("Offline queue migration verification failed");
        }
        entries = verified;
        localStorage.removeItem(queueKeyFor(tenant));
      }
    }
    queueCache.set(key, entries);
    return entries;
  })().catch((error) => {
    queueReady.delete(key);
    console.error("Offline queue initialization failed:", error);
    throw error;
  });
  queueReady.set(key, ready);
  return ready;
}

function writeQueue(tenant, entries) {
  queueCache.set(tenantKey(tenant), entries);
  if (typeof indexedDB === "undefined") {
    try {
      writeLegacyQueue(tenant, entries);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return idbWrite(tenant, entries).then((written) => {
    if (written) return true;
    throw new Error("Offline queue could not be persisted");
  });
}

function writeLegacyQueue(tenant, entries) {
  localStorage.setItem(queueKeyFor(tenant), JSON.stringify({
    v: 1,
    savedAt: new Date().toISOString(),
    tenant: { companyId: tenant.companyId, storeId: tenant.storeId },
    data: entries,
  }));
  return true;
}

/*
 * Reads this tenant's queue. A record failing validation is treated as
 * absent; foreign/corrupt data is NEVER deleted (it may belong to another
 * login on this terminal and must survive).
 */
export function readQueue(tenant) {
  const key = tenantKey(tenant);
  if (typeof indexedDB === "undefined") return readLegacyQueue(tenant);
  if (!queueCache.has(key)) queueCache.set(key, readLegacyQueue(tenant));
  return queueCache.get(key);
}

/* Read-only helper for debugging a queued offline sale from the browser.
   Prints the queue contents and a decoded sale summary to console. Safe to
   leave in dev/build; it reads localStorage but never modifies it. */
export function inspectOfflineQueue() {
  const tenant = getTenantFromToken();
  if (!tenant) {
    console.log("[offlineQueue] not logged in");
    return null;
  }
  const key = queueKeyFor(tenant);
  let raw;
  try { raw = localStorage.getItem(key); } catch { raw = null; }
  console.log(
    "[offlineQueue] key=%s tenant=%s store=%s raw=%.200s",
    key,
    tenant.companyId ? tenant.companyId.slice(0, 8) : "no-company",
    tenant.storeId ? tenant.storeId.slice(0, 8) : "no-store",
    raw || "(empty)"
  );
  const queue = readQueue(tenant);
  console.log("[offlineQueue] items=%d", queue.length);
  for (const item of queue) {
    console.log("[offlineQueue] item id=%s status=%s attempts=%s sealed=%s",
      item.id,
      item.status,
      item.attempts ?? "?",
      Boolean(item.tenant && item.tenant.companyId === tenant.companyId && item.tenant.storeId === tenant.storeId)
    );
    console.log("[offlineQueue] sale=%o", item.sale);
  }
  return { key, tenant, items: queue };
}

/*
 * Receipt counters are PER-TERMINAL keys so two tills can never advance each
 * other's sequence. Migration: the pre-T8E shared counter is imported once
 * (same day only) so an upgrade never re-issues a number, then retired.
 */
const LEGACY_RECEIPT_COUNTER_KEY = "onepos_offline_receipt_counter";

function receiptCounterKey(tenant, prefix) {
  return `onepos_offline_receipt_counter_${tenant.companyId}_${tenant.storeId}_${prefix}`;
}

/*
 * Local history of synced offline sales: keeps the provisional receipt
 * together with the server's authoritative one for traceability (and for
 * healing the local counter). Newest first, capped.
 */
function receiptHistoryKey(tenant) {
  return `onepos_offline_receipt_history_${tenant.companyId}_${tenant.storeId}`;
}

const RECEIPT_HISTORY_LIMIT = 100;

/* Reads the synced-receipt history (newest first). Never throws. */
function readSyncHistory(tenant) {
  try {
    const raw = localStorage.getItem(receiptHistoryKey(tenant));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ------------------------- change notification ------------------------- */

const listeners = new Set();

function notify() {
  for (const listener of listeners) {
    try { listener(); } catch { /* a broken listener must not break others */ }
  }
}

export function subscribeQueue(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ----------------------------- uuid helper ----------------------------- */

/*
 * Public: every sale (online or offline) gets one of these as its
 * clientRequestId so the backend can deduplicate retries.
 */
export function newClientRequestId() {
  return newUuid();
}

function newUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts (e.g. LAN http): random v4.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/* --------------------- provisional receipt numbering -------------------- */

/*
 * Terminal-scoped counter: PREFIX-YYYYMMDD-NNNN. Display-only; the server
 * issues authoritative receipt numbers. Tenant-sealed, persistent across
 * reloads ("reload -> counter continues"), and self-healing: before issuing,
 * the counter is advanced past any number already recorded in the sync
 * history, so a restored-from-backup or manually-reset counter can never
 * re-issue a receipt that was already used.
 */
function nextProvisionalReceipt(tenant, terminalNumber) {
  const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = (terminalNumber && String(terminalNumber).trim()) || "T";
  const key = receiptCounterKey(tenant, prefix);

  let lastNumber = 0;
  let migrated = false;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      const storedTenant = parsed?.tenant || {};
      if (
        parsed.v === 1 &&
        storedTenant.companyId === tenant.companyId &&
        storedTenant.storeId === tenant.storeId &&
        parsed.data && parsed.data.dateKey === dateKey &&
        Number.isFinite(parsed.data.lastNumber)
      ) {
        lastNumber = parsed.data.lastNumber;
      }
    } else {
      /* one-time migration from the pre-T8E shared counter */
      const legacyRaw = localStorage.getItem(LEGACY_RECEIPT_COUNTER_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        const legacyTenant = legacy?.tenant || {};
        if (
          legacy.v === 1 &&
          legacyTenant.companyId === tenant.companyId &&
          legacyTenant.storeId === tenant.storeId &&
          legacy.data && legacy.data.dateKey === dateKey &&
          Number.isFinite(legacy.data.lastNumber)
        ) {
          lastNumber = legacy.data.lastNumber;
          migrated = true;
        }
      }
    }
  } catch { /* treated as absent */ }

  /*
   * Self-heal: never issue a provisional number at/below one already
   * handed out (history entries carry the same PREFIX-date sequence).
   */
  try {
    const historyRaw = localStorage.getItem(receiptHistoryKey(tenant));
    if (historyRaw) {
      const history = JSON.parse(historyRaw);
      if (Array.isArray(history)) {
        for (const entry of history) {
          const match =
            typeof entry?.provisionalReceipt === "string" &&
            entry.provisionalReceipt.startsWith(`${prefix}-${dateKey}-`)
              ? Number(entry.provisionalReceipt.slice(`${prefix}-${dateKey}-`.length))
              : NaN;
          if (Number.isFinite(match) && match > lastNumber) lastNumber = match;
        }
      }
    }
  } catch { /* history is optional for healing */ }

  const nextNumber = lastNumber + 1;

  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        savedAt: new Date().toISOString(),
        tenant: { companyId: tenant.companyId, storeId: tenant.storeId },
        data: { dateKey, lastNumber: nextNumber, terminal: prefix },
      })
    );
    if (migrated) {
      try { localStorage.removeItem(LEGACY_RECEIPT_COUNTER_KEY); } catch { /* ignore */ }
    }
  } catch { /* quota - receipt simply stays display-less */ }

  return `${prefix}-${dateKey}-${String(nextNumber).padStart(4, "0")}`;
}

/* --------------------------- receipt history ---------------------------- */

/*
 * Records a successful sync: the provisional receipt stays available for
 * local history/traceability, together with the server's authoritative
 * receipt number. The provisional number is NEVER displayed as the
 * permanent invoice number after sync (POS shows the authoritative one).
 */
function recordSyncedReceipt(tenant, { clientRequestId, provisionalReceipt, receiptNumber, saleId }) {
  try {
    const raw = localStorage.getItem(receiptHistoryKey(tenant));
    let history = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) history = parsed;
    }
    history.unshift({
      clientRequestId,
      provisionalReceipt,
      receiptNumber: receiptNumber || null,
      saleId: saleId || null,
      syncedAt: new Date().toISOString(),
    });
    localStorage.setItem(
      receiptHistoryKey(tenant),
      JSON.stringify(history.slice(0, RECEIPT_HISTORY_LIMIT))
    );
  } catch { /* history must never break syncing */ }
}

/* ------------------------------ queue API ------------------------------ */

function currentQueue(tenant) {
  return readQueue(tenant);
}

export function getQueueSnapshot() {
  const tenant = getTenantFromToken();
  if (!tenant) return { pending: 0, failed: 0, needsReconciliation: 0, total: 0, syncing: false };
  const queue = currentQueue(tenant);
  return {
    pending: queue.filter((entry) => entry.status === "pending").length,
    failed: queue.filter((entry) => entry.status === "failed").length,
    needsReconciliation: queue.filter((entry) => entry.status === "needs_reconciliation").length,
    total: queue.length,
    syncing,
  };
}

/*
 * T8G: safe per-entry view for the POS queue details modal. Only
 * till-safe fields are exposed (provisional receipt reference, time,
 * status, error text) - no internal database ids and no raw payload.
 */
export function getQueueEntries() {
  const tenant = getTenantFromToken();
  if (!tenant) return [];
  return currentQueue(tenant).map((entry) => ({
    id: entry.id,
    clientRequestId: entry.clientRequestId,
    provisionalReceipt: entry.provisionalReceipt || null,
    createdAt: entry.createdAt || null,
    status: ["failed", "needs_reconciliation"].includes(entry.status) ? entry.status : "pending",
    attempts: Number(entry.attempts) || 0,
    lastError: entry.lastError || null,
    paymentUnverified: !!entry.paymentUnverified,
    total: Number(entry.sale?.total) || 0,
    itemCount: Array.isArray(entry.sale?.items) ? entry.sale.items.length : 0,
    saleId: entry.saleId || null,
    receiptNumber: entry.receiptNumber || null,
  }));
}

/*
 * T8G: puts a server-rejected entry back into the sync rotation (manual
 * retry from the details modal). The clientRequestId is unchanged, so the
 * backend idempotency still guarantees no duplicate sale is created.
 */
export function retryFailedEntry(id) {
  const tenant = getTenantFromToken();
  if (!tenant || !id) return { ok: false };
  const queue = currentQueue(tenant);
  const entry = queue.find((item) => item.id === id);
  if (!entry || entry.status !== "failed") return { ok: false };
  const next = queue.map((item) =>
    item.id === id ? { ...item, status: "pending", lastError: null } : item
  );
  const persistence = writeQueue(tenant, next);
  notify();
  syncOfflineQueue();
  return { ok: true, ready: persistence };
}

/*
 * T8G: retries every failed entry at once (single queue write, single
 * sync run - avoids racing several syncs against each other).
 */
export function retryAllFailed() {
  const tenant = getTenantFromToken();
  if (!tenant) return { ok: false, retried: 0 };
  const queue = currentQueue(tenant);
  const failedIds = new Set(
    queue.filter((item) => item.status === "failed").map((item) => item.id)
  );
  if (!failedIds.size) return { ok: true, retried: 0 };
  const next = queue.map((item) =>
    failedIds.has(item.id)
      ? { ...item, status: "pending", lastError: null }
      : item
  );
  const persistence = writeQueue(tenant, next);
  notify();
  syncOfflineQueue();
  return { ok: true, retried: failedIds.size, ready: persistence };
}

/* ------------------------- sync statistics (T8G) ------------------------ */

const SYNC_STATS_VERSION = 1;

function syncStatsKey(tenant) {
  return `onepos_offline_sync_stats_${tenant.companyId}_${tenant.storeId}`;
}

function emptySyncStats() {
  return { syncedTotal: 0, lastSyncedAt: null, lastError: null };
}

function readSyncStats(tenant) {
  try {
    const raw = localStorage.getItem(syncStatsKey(tenant));
    if (!raw) return emptySyncStats();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== SYNC_STATS_VERSION) return emptySyncStats();
    const stored = parsed.tenant || {};
    if (stored.companyId !== tenant.companyId || stored.storeId !== tenant.storeId) {
      return emptySyncStats();
    }
    return {
      syncedTotal: Number(parsed.data?.syncedTotal) || 0,
      lastSyncedAt: parsed.data?.lastSyncedAt || null,
      lastError: parsed.data?.lastError || null,
    };
  } catch {
    return emptySyncStats();
  }
}

function writeSyncStats(tenant, stats) {
  try {
    localStorage.setItem(
      syncStatsKey(tenant),
      JSON.stringify({
        v: SYNC_STATS_VERSION,
        savedAt: new Date().toISOString(),
        tenant: { companyId: tenant.companyId, storeId: tenant.storeId },
        data: stats,
      })
    );
  } catch { /* stats must never break syncing */ }
}

/* One authoritative offline sale reached the server. */
function bumpSyncedStats(tenant) {
  const stats = readSyncStats(tenant);
  stats.syncedTotal += 1;
  stats.lastSyncedAt = new Date().toISOString();
  stats.lastError = null;
  writeSyncStats(tenant, stats);
}

/* A sync attempt ended with a server rejection (shown in the details view). */
function noteSyncError(tenant, message) {
  const stats = readSyncStats(tenant);
  stats.lastError = message || "Sync error";
  writeSyncStats(tenant, stats);
}

/* Cumulative, per-tenant counters for the queue details view. */
export function getSyncStats() {
  const tenant = getTenantFromToken();
  if (!tenant) return emptySyncStats();
  return readSyncStats(tenant);
}

/*
 * T8G: central auto-sync wiring used by the POS screen. Starts a sync
 * immediately, re-syncs whenever the browser reports being back online,
 * and keeps a slow safety-net poll for missed browser events. Returns a
 * stop function (safe for useEffect cleanup); starting twice is a no-op.
 */
let autoSyncStop = null;

export function startAutoSync({ pollMs = 30000 } = {}) {
  if (autoSyncStop) return autoSyncStop;
  const attempt = async () => {
    const tenant = getTenantFromToken();
    if (tenant) await ensureQueueReady(tenant).catch(() => {});
    await syncOfflineQueue();
  };
  const removeNetworkListener = onNetworkChange((online) => {
    if (online) syncOfflineQueue();
  });
  const onStorage = () => notify();
  window.addEventListener("storage", onStorage);
  attempt();
  const timer = pollMs > 0 ? setInterval(attempt, pollMs) : null;
  autoSyncStop = () => {
    window.removeEventListener("storage", onStorage);
    removeNetworkListener();
    if (timer) clearInterval(timer);
    autoSyncStop = null;
  };
  return autoSyncStop;
}

/*
 * Adds a sale to the queue. Returns { ok: true, entry } or { ok: false }.
 * `sale` is the exact POST /api/sales payload (clientRequestId included).
 */
export function enqueueOfflineSale({ sale, terminalNumber = null, paymentUnverified = false }) {
  const tenant = getTenantFromToken();
  if (!tenant || !sale || typeof sale !== "object" || !sale.clientRequestId) {
    return { ok: false };
  }

  const entry = {
    id: newUuid(),
    clientRequestId: sale.clientRequestId,
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    lastError: null,
    provisionalReceipt: nextProvisionalReceipt(tenant, terminalNumber),
    /*
     * Offline card "payments" were never authorised by a terminal. The flag
     * keeps the till honest: the entry shows a "card payment not confirmed
     * by terminal" notice until the sale is reviewed/synced (UI only - the
     * sale payload contract is unchanged).
     */
    paymentUnverified: sale.paymentMethod === "card" || !!paymentUnverified,
    tenant: { companyId: tenant.companyId, storeId: tenant.storeId, userId: tenant.userId },
    sale,
  };

  const queue = currentQueue(tenant);
  const existing = queue.find((item) => item.clientRequestId === sale.clientRequestId);
  if (existing) return { ok: true, entry: existing };
  if (typeof indexedDB === "undefined") {
    try {
      writeLegacyQueue(tenant, [...queue, entry]);
    } catch {
      return { ok: false };
    }
  }
  const persistence = ensureQueueReady(tenant)
    .then(() => {
      const current = readQueue(tenant);
      if (current.some((item) => item.clientRequestId === sale.clientRequestId)) return true;
      return writeQueue(tenant, [...current, entry]);
    });

  notify();
  return { ok: true, entry, ready: persistence };
}

export function failQueuedSale(clientRequestId, status) {
  const tenant = getTenantFromToken();
  if (!tenant) return;
  const queue = currentQueue(tenant).map((entry) => entry.clientRequestId === clientRequestId
    ? { ...entry, status: "failed", lastError: `Sale rejected (HTTP ${Number(status) || 400}). Check stock, permissions and till session before retrying.` } : entry);
  void writeQueue(tenant, queue).catch((error) => console.error("Offline queue update failed:", error));
  notify();
}

export function acknowledgeQueuedSale(clientRequestId, sale, tenant = getTenantFromToken()) {
  if (!tenant || !sale?.id) return false;
  const queue = currentQueue(tenant);
  const entry = queue.find((item) => item.clientRequestId === clientRequestId);
  if (!entry) return true; // another response/tab already acknowledged it
  const next = queue.filter((item) => item.id !== entry.id);
  let persistence;
  if (typeof indexedDB === "undefined") {
    try {
      writeLegacyQueue(tenant, next);
      persistence = Promise.resolve(true);
    } catch {
      return false;
    }
  } else {
    persistence = writeQueue(tenant, next);
  }
  recordSyncedReceipt(tenant, { clientRequestId, provisionalReceipt: entry.provisionalReceipt, receiptNumber: sale.receipt_number, saleId: sale.id });
  bumpSyncedStats(tenant);
  notify();
  void persistence.catch((error) => console.error("Offline queue acknowledgement failed:", error));
  return true;
}

/* ------------------------------ sync engine ----------------------------- */

let syncing = false;

/*
 * Drains the queue oldest-first. Safe to call from anywhere (network event,
 * mount, after a sale); concurrent invocations collapse into the running one.
 */
async function syncOfflineQueuePass() {
  if (syncing) return { attempted: 0, synced: 0, rejected: 0, networkDown: false, skipped: true };
  const tenant = getTenantFromToken();
  if (!tenant) return { attempted: 0, synced: 0, rejected: 0, networkDown: false, skipped: true };

  syncing = true;
  notify(); // T8G: the indicator can show "Syncing…" while this runs
  try {
    await ensureQueueReady(tenant);
    let queue = currentQueue(tenant);
    let synced = 0;
    let rejected = 0;
    let networkDown = false;

    for (const entry of queue) {
      if (entry.status !== "pending") break; // strict FIFO: review/retry oldest first
      if (entry.paymentUnverified || entry.sale?.paymentMethod !== "cash") {
        noteSyncError(tenant, "Unconfirmed payment requires review; automatic sync is blocked.");
        break;
      }

      const active = getTenantFromToken();
      if (!active || active.companyId !== tenant.companyId || active.storeId !== tenant.storeId || active.userId !== tenant.userId) break;

      /* Tenant belt-and-braces: never submit another tenant's sale. */
      const entryTenant = entry.tenant || {};
      if (entryTenant.companyId !== tenant.companyId || entryTenant.storeId !== tenant.storeId) {
        continue;
      }

      try {
        /* Same authenticated request the normal sale path makes. */
        let token = null;
        try { token = localStorage.getItem("onepos_token"); } catch { /* ignore */ }
        const response = await fetch("/api/sales", {
          signal: AbortSignal.timeout(15000),
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ ...entry.sale, clientRequestId: entry.clientRequestId }),
        });

        let body = {};
        try { body = await response.json(); } catch { /* non-JSON body */ }

        if (response.status === 401) {
          noteSyncError(tenant, "Sign in again to synchronize saved sales.");
          break;
        }

        /* The backend answered - the connection is genuinely back. */
        reportConnection(true);

        if (response.status >= 500 || response.status === 429 || (response.ok && (body?.success !== true || !body?.sale?.id))) {
          noteSyncError(tenant, "No confirmed sale acknowledgement. Saved sale retained for retry.");
          if (response.status >= 500) reportConnection(false);
          break;
        }
        if (!response.ok || body?.success !== true) {
          /* Re-read before writing: another tab may have queued a sale while
           * this request was in flight - only THIS entry's state changes. */
          queue = currentQueue(tenant).map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  status: body?.code === "IDEMPOTENCY_CONFLICT" ? "needs_reconciliation" : "failed",
                  lastError: `Sale rejected (HTTP ${response.status}). Check stock, permissions and till session before retrying.`,
                  attempts: item.attempts + 1,
                }
              : item
          );
          writeQueue(tenant, queue);
          rejected += 1;
          break;
        }

        const acknowledgement = acknowledgeQueuedSale(entry.clientRequestId, body.sale, tenant);
        if (!acknowledgement || acknowledgement.ok === false) {
          noteSyncError(tenant, "Unable to update local storage. Sale retained; retry uses the same reference.");
          break;
        }
        try {
          await writeQueue(tenant, currentQueue(tenant));
        } catch {
          noteSyncError(tenant, "Unable to update local storage. Sale retained; retry uses the same reference.");
          break;
        }
        synced += 1;
      } catch (error) {
        if (isNetworkError(error)) {
          /* Timeout/abort: the request may still have reached the server, so
           * "connection" is UNKNOWN - the idempotency key on the next attempt
           * makes a duplicate sale impossible either way. */
          reportConnection(false);
          networkDown = true;
          break;
        }
        /* Non-transport throw: re-read before writing so a sale queued by
         * another tab while this request was in flight is not lost. */
        queue = currentQueue(tenant).map((item) =>
          item.id === entry.id
            ? { ...item, status: "failed", lastError: "Unable to sync. Saved sale retained for review.", attempts: item.attempts + 1 }
            : item
        );
        writeQueue(tenant, queue);
        rejected += 1;
        break;
      }
    }

    return { attempted: synced + rejected, synced, rejected, networkDown, skipped: false };
  } finally {
    syncing = false;
    notify();
  }
}

/*
 * The in-process guard above prevents duplicate sends in one tab. Where
 * supported, Web Locks extends that guarantee across tabs sharing the same
 * browser profile. IndexedDB remains the durable source of truth; the lock
 * only serializes read/modify/write synchronization passes.
 */
export async function syncOfflineQueue() {
  const tenant = getTenantFromToken();
  if (!tenant) return { attempted: 0, synced: 0, rejected: 0, networkDown: false, skipped: true };
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(
      `onepos-offline-sync-${tenant.companyId}-${tenant.storeId}`,
      { ifAvailable: true },
      (lock) => lock ? syncOfflineQueuePass() : {
        attempted: 0, synced: 0, rejected: 0, networkDown: false, skipped: true,
      }
    );
  }
  return syncOfflineQueuePass();
}
