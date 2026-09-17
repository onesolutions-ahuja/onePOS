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
  syncing = false,
  syncError = false,
  online = true,
  onQueue,
}) {
  const status = syncing ? "SYNCING" : !online ? "OFFLINE" : failedCount || syncError ? "SYNC ERROR" : "ONLINE";

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
        <button onClick={onQueue} className={`text-xs text-left rounded px-2 py-1 ${status === "SYNC ERROR" ? "text-red-200" : status === "ONLINE" ? "text-emerald-200" : "text-amber-200"}`} title="View saved sales and retry synchronization" aria-live="polite">
          <span className="block font-semibold">{status}{syncing ? "…" : ""}</span>
          <span>{offlineCount} pending{failedCount ? ` · ${failedCount} need attention` : ""}</span>
        </button>

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