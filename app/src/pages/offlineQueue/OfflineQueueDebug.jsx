import { useEffect, useRef, useState } from "react";
import { inspectOfflineQueue } from "../../services/offlineQueue.js";

export default function OfflineQueueDebug() {
  // lazy so the import only happens after the user explicitly opens the debug
  // page; we never fetch the queue on normal app pages.
  const [dump, setDump] = useState("Loading...");
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    try {
      const r = inspectOfflineQueue();
      setDump(r ? JSON.stringify(r, null, 2) : "(empty or not logged in)");
    } catch (e) {
      setDump(String(e));
    }
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-bold mb-4">Offline Queue (read-only)</h1>
      <button
        onClick={() => {
          const r = inspectOfflineQueue();
          setDump(r ? JSON.stringify(r, null, 2) : "(empty)");
        }}
        className="mb-4 h-10 px-4 border rounded text-sm bg-white hover:bg-slate-50"
      >
        Refresh dump
      </button>

      <pre className="text-xs bg-slate-50 p-4 rounded border overflow-auto max-h-[60vh]">
        {dump}
      </pre>

      <p className="mt-4 text-xs text-slate-400">
        This shows the live offline sale queue from browser localStorage. Nothing
        here is sent to the server. To sync pending sales, return to the till
        with the browser online — syncing is automatic.
      </p>
    </div>
  );
}
