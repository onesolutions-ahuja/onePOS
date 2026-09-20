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
  const status = syncing
    ? "SYNCING"
    : !online
      ? "OFFLINE"
      : failedCount || syncError
        ? "SYNC ERROR"
        : "ONLINE";

  return (
    <header
      className="h-[58px] text-white flex items-center justify-between px-2 sm:px-4 shrink-0 min-w-0 gap-2"
      style={{
        background:
          "linear-gradient(90deg, #104744 0%, #176F6A 100%)",
      }}
    >
      {/* LEFT SIDE — min-w-0 + truncation so a long till name can never push
          the right-side controls off-viewport. */}
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        <div className="font-bold text-lg shrink-0">
          onePOS
        </div>

        <div className="h-7 w-px bg-white/20 shrink-0 hidden sm:block" />

        <div className="text-sm min-w-0 truncate">
          {loadingTill ? (
            <span className="text-white/60">
              Loading till…
            </span>
          ) : till ? (
            <>
              <span className="font-medium">
                {till.terminal_name || "Till"}
              </span>

              <span className="text-emerald-300 ml-2 hidden md:inline">
                ● Open
              </span>
            </>
          ) : (
            <span className="text-amber-300 font-medium">
              Till closed
            </span>
          )}
        </div>
      </div>

      {/* RIGHT SIDE — every control is shrink-0, labels collapse to icons on
          small viewports, so the cluster can never overflow the header. */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">

        {/* CONNECTION / OFFLINE QUEUE */}
        <button
          onClick={onQueue}
          className={`text-xs text-left rounded px-2 py-1 mr-1 ${
            status === "SYNC ERROR"
              ? "text-red-200"
              : status === "ONLINE"
                ? "text-emerald-200"
                : "text-amber-200"
          }`}
          title="Connection and offline sale status"
          aria-live="polite"
        >
          <span className="block font-semibold">
            {status}
            {syncing ? "…" : ""}
          </span>

          <span>
            {offlineCount} pending
            {failedCount
              ? ` · ${failedCount} need attention`
              : ""}
          </span>
        </button>

        {/* MANAGE TILL — icon-only below md, icon+label at md+. */}
        <button
          onClick={onManageTill}
          className="h-9 px-2 md:px-3 bg-slate-800 rounded-md text-sm hover:bg-slate-700 transition-colors flex items-center gap-1.5 shrink-0"
          title="Manage Till"
        >
          <span className="hidden md:inline">Manage Till</span>
          <span className="md:hidden" aria-hidden="true">⎙</span>
        </button>

        {/* ONLINE ORDERS — icon+badge below md; full label at md+. */}
        <button
          onClick={onOpenOnlineOrders}
          className="relative h-9 px-2 md:px-3 bg-slate-800 rounded-md text-sm hover:bg-slate-700 transition-colors flex items-center shrink-0"
          title="Online Orders"
        >
          <span className="flex items-center gap-2">
            <ShoppingBag size={15} />

            <span className="hidden md:inline">Online Orders</span>

            {onlineOrderCount > 0 && (
              <span
                className="
                  absolute
                  -top-1.5
                  -right-1.5
                  min-w-[18px]
                  h-[18px]
                  px-1
                  bg-red-600
                  text-white
                  text-[11px]
                  font-bold
                  rounded-full
                  flex
                  items-center
                  justify-center
                "
              >
                {onlineOrderCount > 99
                  ? "99+"
                  : onlineOrderCount}
              </span>
            )}
          </span>
        </button>

        {/* ADMIN — icon-only below sm. */}
        <button
          onClick={onAdmin}
          className="h-9 px-2 sm:px-3 bg-slate-800 rounded-md text-sm hover:bg-slate-700 transition-colors shrink-0"
        >
          <span className="hidden sm:inline">Admin</span>
          <span className="sm:hidden" aria-hidden="true">☰</span>
        </button>

        {/* LOGOUT */}
        <button
          onClick={onLogout}
          className="h-9 w-9 flex items-center justify-center hover:bg-slate-800 rounded-md transition-colors"
          title="Logout"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

export default POSHeader;