import { useEffect, useState } from "react";
import { CloudUpload, RotateCcw, X } from "lucide-react";
import {
  getQueueEntries,
  getQueueSnapshot,
  getSyncStats,
  syncOfflineQueue,
  retryFailedEntry,
  retryAllFailed,
  subscribeQueue,
} from "../../services/offlineQueue.js";

/*
 * T8G: queue details view. Shows what the till is holding offline and what
 * happened at the last sync. Only till-safe data is displayed: provisional
 * receipt reference (never the server invoice number), local timestamps and
 * safe error text - no internal database ids, no raw payloads.
 */
function QueueDetailsModal({ onClose }) {
  const [entries, setEntries] = useState(() => getQueueEntries());
  const [stats, setStats] = useState(() => getSyncStats());
  const [busy, setBusy] = useState(() => getQueueSnapshot().syncing);

  useEffect(() => {
    const refresh = () => {
      setEntries(getQueueEntries());
      setStats(getSyncStats());
      setBusy(getQueueSnapshot().syncing);
    };
    refresh();
    return subscribeQueue(refresh);
  }, []);

  const pending = entries.filter((entry) => entry.status === "pending").length;
  const failed = entries.filter((entry) => entry.status === "failed").length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[560px] max-w-full max-h-[85vh] flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <div>
            <h2 className="font-bold text-lg">Offline sales queue</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Sales completed at this till while offline. They sync automatically when the connection returns.
            </p>
          </div>
          <button onClick={onClose} title="Close" className="p-2 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>
        <QueueStats stats={stats} pending={pending} failed={failed} />
        <QueueList entries={entries} busy={busy} />
        <div className="px-4 py-2"><button disabled={busy} onClick={() => syncOfflineQueue()} className="text-sm text-blue-700 disabled:opacity-50">{busy ? "Syncing…" : "Sync / retry pending"}</button></div>
        {stats.lastError && <p role="status" className="px-4 text-sm text-red-700">{stats.lastError}</p>}
        {failed > 0 && (
          <div className="p-4 border-t flex justify-end">
            <button
              disabled={busy}
              onClick={() => retryAllFailed()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center gap-2"
            >
              <CloudUpload size={15} /> Retry all failed
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function QueueStats({ stats, pending, failed }) {
  return (
    <div className="px-4 py-3 border-b grid grid-cols-4 gap-2 text-center">
      <div className="bg-amber-50 rounded-lg py-2">
        <div className="text-lg font-bold text-amber-700">{pending}</div>
        <div className="text-[11px] text-amber-700">Pending sync</div>
      </div>
      <div className="bg-red-50 rounded-lg py-2">
        <div className="text-lg font-bold text-red-700">{failed}</div>
        <div className="text-[11px] text-red-700">Needs attention</div>
      </div>
      <div className="bg-emerald-50 rounded-lg py-2">
        <div className="text-lg font-bold text-emerald-700">{stats.syncedTotal}</div>
        <div className="text-[11px] text-emerald-700">Synced (total)</div>
      </div>
      <div className="bg-slate-50 rounded-lg py-2">
        <div className="text-xs font-medium text-slate-700 mt-1">
          {stats.lastSyncedAt ? new Date(stats.lastSyncedAt).toLocaleTimeString() : "—"}
        </div>
        <div className="text-[11px] text-slate-500">Last sync</div>
      </div>
    </div>
  );
}

function QueueList({ entries, busy }) {
  return <div className="p-4 overflow-y-auto space-y-2">
    <p className="text-xs text-amber-800">Stock is checked and adjusted by the backend only after sync. Cached stock may be out of date. Failed sales remain here for review.</p>
    {!entries.length && <p className="text-sm text-slate-500 py-4">No sales waiting to sync.</p>}
    {entries.map((entry) => <div key={entry.id} className="border rounded-lg p-3 text-sm">
      <div className="font-medium">{entry.provisionalReceipt || `Ref ${entry.clientRequestId?.slice(0, 8)}`} — {entry.status === "failed" ? "Sync failed" : "Pending sync"}</div>
      <div className="text-xs text-slate-500">{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "Time unavailable"} · {entry.itemCount} items · £{entry.total.toFixed(2)} · {entry.attempts} attempts</div>
      {entry.paymentUnverified && <p className="text-amber-800">Card payment unconfirmed. Not submitted; requires review.</p>}
      {entry.lastError && <p role="status" className="text-red-700">{entry.lastError}</p>}
      {entry.status === "failed" && !entry.paymentUnverified && <button disabled={busy} onClick={() => retryFailedEntry(entry.id)} className="mt-2 px-3 py-1 bg-blue-50 text-blue-700 rounded disabled:opacity-50"><RotateCcw size={12} className="inline" /> Retry</button>}
    </div>)}
  </div>;
}

export default QueueDetailsModal;

