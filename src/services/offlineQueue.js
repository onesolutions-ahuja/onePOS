/*
|--------------------------------------------------------------------------
| Offline sale queue (T8C-F)
|--------------------------------------------------------------------------
|
| Frontend queue + sync engine for POS sales created while the network is
| down. Storage primitives and tenant sealing come from T8B's
| offlineStore.js (onepos_offline_queue, keyed to companyId+storeId).
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
import { isNetworkError } from "./networkStatus.js";

/*
 * The queue lives in a PER-TENANT key: a different company/store logged in
 * on the same terminal can neither read, consume, nor overwrite another
 * tenant's unsynced sales. Records are additionally tenant-sealed (same
 * convention as offlineStore) as belt-and-braces.
 */
function queueKeyFor(tenant) {
  return `onepos_offline_queue_${tenant.companyId}_${tenant.storeId}`;
}

/*
 * Reads this tenant's queue. A record failing validation is treated as
 * absent; foreign/corrupt data is NEVER deleted (it may belong to another
 * login on this terminal and must survive).
 */
function readQueue(tenant) {
  let record = null;
  try {
    const raw = localStorage.getItem(queueKeyFor(tenant));
    if (!raw) return [];
    record = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!record || typeof record !== "object" || record.v !== 1) return [];
  const stored = record.tenant || {};
  if (stored.companyId !== tenant.companyId || stored.storeId !== tenant.storeId) {
    return [];
  }
  return Array.isArray(record.data) ? record.data : [];
}

function writeQueue(tenant, entries) {
  try {
    localStorage.setItem(
      queueKeyFor(tenant),
      JSON.stringify({
        v: 1,
        savedAt: new Date().toISOString(),
        tenant: { companyId: tenant.companyId, storeId: tenant.storeId },
        data: entries,
      })
    );
    return true;
  } catch {
    return false;
  }
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
  if (!tenant) return { pending: 0, failed: 0, total: 0 };
  const queue = currentQueue(tenant);
  return {
    pending: queue.filter((entry) => entry.status === "pending").length,
    failed: queue.filter((entry) => entry.status === "failed").length,
    total: queue.length,
  };
}

/*
 * Adds a sale to the queue. Returns { ok: true, entry } or { ok: false }.
 * `sale` is the exact POST /api/sales payload (clientRequestId included).
 */
export function enqueueOfflineSale({ sale, terminalNumber = null }) {
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
    tenant: { companyId: tenant.companyId, storeId: tenant.storeId, userId: tenant.userId },
    sale,
  };

  const queue = currentQueue(tenant);
  if (!writeQueue(tenant, [...queue, entry])) return { ok: false };

  notify();
  return { ok: true, entry };
}

/* ------------------------------ sync engine ----------------------------- */

let syncing = false;

/*
 * Drains the queue oldest-first. Safe to call from anywhere (network event,
 * mount, after a sale); concurrent invocations collapse into the running one.
 */
export async function syncOfflineQueue() {
  if (syncing) return { attempted: 0, synced: 0, rejected: 0, networkDown: false, skipped: true };
  const tenant = getTenantFromToken();
  if (!tenant) return { attempted: 0, synced: 0, rejected: 0, networkDown: false, skipped: true };

  syncing = true;
  try {
    let queue = currentQueue(tenant);
    let mutated = false;
    let synced = 0;
    let rejected = 0;
    let networkDown = false;

    for (const entry of queue) {
      if (entry.status !== "pending") continue; // failed entries are never retried

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
          // Session expired mid-offline: auth problem, NOT a bad sale.
          // Keep everything pending; the cashier logs in again and we resume.
          networkDown = true;
          break;
        }

        if (response.ok) {
          /*
           * Success (T8E): remember the authoritative receipt number with
           * the provisional one in local history, then remove the entry
           * (never create a second local sale).
           */
          recordSyncedReceipt(tenant, {
            clientRequestId: entry.clientRequestId,
            provisionalReceipt: entry.provisionalReceipt,
            receiptNumber: body?.sale?.receipt_number || null,
            saleId: body?.sale?.id || null,
          });
          queue = queue.filter((item) => item.id !== entry.id);
          mutated = true;
          synced += 1;
        } else {
          // Server rejected the sale permanently - mark failed, keep for review.
          queue = queue.map((item) =>
            item.id === entry.id
              ? {
                  ...item,
                  status: "failed",
                  lastError: body?.message || `Server rejected the sale (${response.status})`,
                  attempts: item.attempts + 1,
                }
              : item
          );
          mutated = true;
          rejected += 1;
        }
      } catch (error) {
        if (isNetworkError(error)) {
          // Still offline (or dropped mid-sync): stop, keep everything queued.
          networkDown = true;
          break;
        }
        // Non-transport throw during retry: treat like a server rejection.
        queue = queue.map((item) =>
          item.id === entry.id
            ? { ...item, status: "failed", lastError: error.message, attempts: item.attempts + 1 }
            : item
        );
        mutated = true;
        rejected += 1;
      }
    }

    if (mutated) {
      writeQueue(tenant, queue);
      notify();
    }
    return { attempted: synced + rejected, synced, rejected, networkDown, skipped: false };
  } finally {
    syncing = false;
  }
}
