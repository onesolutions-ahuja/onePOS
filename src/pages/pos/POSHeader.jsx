import { LogOut, ShoppingBag, Monitor } from "lucide-react";

function POSHeader({
  loadingTill,
  till,
  onManageTill,
  onAdmin,
  onOpenOnlineOrders,
  onLogout,
  onStartSelfCheckout,
  scoStarting = false,
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
      className="h-[58px] text-white flex items-center justify-between px-4 shrink-0"
      style={{
        background:
          "linear-gradient(90deg, #104744 0%, #176F6A 100%)",
      }}
    >
      {/* LEFT SIDE */}
      <div className="flex items-center gap-4">
        <div className="font-bold text-lg">
          onePOS
        </div>

        <div className="h-7 w-px bg-white/20" />

        <div className="text-sm">
          {loadingTill ? (
            <span className="text-white/60">
              Loading till…
            </span>
          ) : till ? (
            <>
              <span className="font-medium">
                {till.terminal_name || "Till"}
              </span>

              <span className="text-emerald-300 ml-2">
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

      {/* RIGHT SIDE */}
      <div className="flex items-center gap-2">

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

        {/* MANAGE TILL */}
        <button
          onClick={onManageTill}
          className="h-9 px-3 bg-slate-800 rounded-md text-sm hover:bg-slate-700 transition-colors"
        >
          Manage Till
        </button>

        {/* SELF CHECKOUT */}
        <button
          onClick={onStartSelfCheckout}
          disabled={scoStarting || !online}
          title={
            online
              ? "Start Self-Checkout mode on this device"
              : "Self-Checkout requires an internet connection"
          }
          className="h-9 px-3 bg-white text-slate-800 rounded-md text-sm font-medium hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <Monitor size={15} />

          {scoStarting
            ? "Starting…"
            : "Self-Checkout"}
        </button>

        {/* ONLINE ORDERS */}
        <button
          onClick={onOpenOnlineOrders}
          className="relative h-9 px-3 bg-slate-800 rounded-md text-sm hover:bg-slate-700 transition-colors"
        >
          <span className="flex items-center gap-2">
            <ShoppingBag size={15} />

            Online Orders

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

        {/* ADMIN */}
        <button
          onClick={onAdmin}
          className="h-9 px-3 bg-slate-800 rounded-md text-sm hover:bg-slate-700 transition-colors"
        >
          Admin
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