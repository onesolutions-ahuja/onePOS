import { useEffect, useState } from "react";
import { LogOut, ShoppingBag } from "lucide-react";

function POSHeader({
  loadingTill,
  till,
  onManageTill,
  onAdmin,
  onOpenOnlineOrders,
  onLogout,
  onlineOrderCount = 0,
  offlineCount = 0,
  failedCount = 0,
}) {
  /* Compact connection/queue indicator state (T8C-F). */
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const queuePending = offlineCount > 0;

  return (
    <header className="h-[58px] text-white flex items-center justify-between px-4 shrink-0" style={{ background: "linear-gradient(90deg, #104744 0%, #176F6A 100%)" }}>
      <div className="flex items-center gap-4">
        <div className="font-bold text-lg">
          onePOS
        </div>

        <div className="h-7 w-px bg-slate-700" />

        <div className="text-sm">
          {loadingTill ? (
            <span className="text-slate-400">Loading till…</span>
          ) : till ? (
            <>
              <span className="font-medium">
                {till.terminal_name || "Till"}
              </span>
              <span className="text-emerald-400 ml-2">
                ● Open
              </span>
            </>
          ) : (
            <>
              <span className="text-amber-400 font-medium">
                Till closed
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isOnline && !queuePending && failedCount === 0 ? (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <span className="w-2 h-2 bg-emerald-400 rounded-full" />
            Online
          </div>
        ) : !isOnline ? (
          <div className="flex items-center gap-2 text-xs text-amber-400" title="Offline — sales are saved and will sync automatically">
            <span className="w-2 h-2 bg-amber-400 rounded-full" />
            Offline
          </div>
        ) : queuePending ? (
          <div
            className="flex items-center gap-2 text-xs text-amber-400"
            title={`${offlineCount} sale(s) saved offline, syncing automatically`}
          >
            <span className="w-2 h-2 bg-amber-400 rounded-full" />
            {offlineCount === 1 ? "1 offline sale" : `${offlineCount} offline sales`}
            {failedCount > 0 && <span className="text-red-400">· {failedCount} failed</span>}
          </div>
        ) : (
          <div
            className="flex items-center gap-2 text-xs text-red-400"
            title="Offline sale(s) were rejected by the server - they are kept for review"
          >
            <span className="w-2 h-2 bg-red-400 rounded-full" />
            {failedCount === 1 ? "1 failed sale" : `${failedCount} failed sales`}
          </div>
        )}

        <button
          onClick={onManageTill}
          className="px-3 py-2 bg-slate-800 rounded-md text-sm hover:bg-slate-700"
        >
          Manage Till
        </button>

        <button
          onClick={onOpenOnlineOrders}
          className="relative px-3 py-2 bg-slate-800 rounded-md text-sm hover:bg-slate-700"
        >
          <span className="flex items-center gap-2">
            <ShoppingBag size={15} />
            Online Orders
            {onlineOrderCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
                {onlineOrderCount > 99 ? "99+" : onlineOrderCount}
              </span>
            )}
          </span>
        </button>

        <button
          onClick={onAdmin}
          className="px-3 py-2 bg-slate-800 rounded-md text-sm hover:bg-slate-700"
        >
          Admin
        </button>

        <button
          onClick={onLogout}
          className="p-2 hover:bg-slate-800 rounded-md"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

export default POSHeader;