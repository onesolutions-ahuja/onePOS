import { useEffect, useState } from "react";
import {
  Database,
  LogOut,
  RefreshCw,
  ShoppingBag,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  DB_STATES,
  INTERNET_STATES,
  SERVER_STATES,
  checkNow,
  describeConnectivity,
  getConnectivity,
  subscribeConnectivity,
} from "../../services/connectivity.js";

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
  /* ONE authoritative connectivity source (services/connectivity.js). The
   * header no longer derives its own Online/Offline opinion — it renders
   * whatever the shared probe last verified. */
  const [conn, setConn] = useState(getConnectivity);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => subscribeConnectivity(setConn), []);

  /* Opening the diagnostics popup triggers an immediate fresh check. */
  const openDiagnostics = () => {
    setShowDiagnostics(true);
    void checkNow();
  };

  const serverConnected = conn.server === SERVER_STATES.CONNECTED;
  const checking = conn.checking || conn.server === SERVER_STATES.UNKNOWN;

  const StatusIcon = serverConnected ? Wifi : WifiOff;
  const statusTone = serverConnected
    ? "text-emerald-200 hover:text-white"
    : checking
      ? "text-amber-200 hover:text-white"
      : "text-red-200 hover:text-white";

  const internetTone =
    conn.internet === INTERNET_STATES.CONNECTED
      ? "text-emerald-700"
      : conn.internet === INTERNET_STATES.DISCONNECTED
        ? "text-red-700"
        : "text-slate-500";
  const serverTone = serverConnected
    ? "text-emerald-700"
    : conn.server === SERVER_STATES.UNREACHABLE
      ? "text-red-700"
      : "text-slate-500";
  const dbTone =
    conn.database === DB_STATES.CONNECTED
      ? "text-emerald-700"
      : conn.database === DB_STATES.UNAVAILABLE
        ? "text-red-700"
        : "text-slate-500";

  const internetLabel =
    conn.internet === INTERNET_STATES.CONNECTED
      ? "Connected"
      : conn.internet === INTERNET_STATES.DISCONNECTED
        ? "Disconnected"
        : "Unknown";

  const lastCheckLabel = conn.lastServerOkAt
    ? new Date(conn.lastServerOkAt).toLocaleTimeString()
    : "Never";

  const queueSummary =
    offlineCount === 0 && failedCount === 0
      ? "No pending offline sales"
      : `${offlineCount} pending${failedCount ? ` · ${failedCount} need attention` : ""}`;

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

        {/* CONNECTION DIAGNOSTICS — small unobtrusive status icon fed by the
            authoritative connectivity state. Click opens the diagnostics
            popup (and triggers an immediate fresh health check). */}
        <div className="relative shrink-0">
          <button
            onClick={openDiagnostics}
            className={`h-9 w-9 flex items-center justify-center rounded-md hover:bg-slate-800 transition-colors ${statusTone}`}
            title={describeConnectivity(conn)}
            aria-label={`Connection: ${describeConnectivity(conn)}. Open diagnostics.`}
          >
            <StatusIcon
              size={17}
              className={checking && !serverConnected ? "animate-pulse" : ""}
            />
          </button>

          {showDiagnostics && (
            <div
              className="absolute right-0 top-11 z-50 w-72 bg-white text-slate-800 rounded-lg shadow-2xl border border-slate-200 overflow-hidden"
              role="dialog"
              aria-label="Connection diagnostics"
            >
              <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
                <span className="font-semibold text-sm">Connection</span>
                <button
                  onClick={() => setShowDiagnostics(false)}
                  className="p-1 hover:bg-slate-100 rounded"
                  aria-label="Close diagnostics"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="px-3 py-2 space-y-1.5 text-sm">
                <p className={`font-medium ${internetTone}`}>
                  {conn.internet === INTERNET_STATES.DISCONNECTED
                    ? "Internet unavailable"
                    : `Internet: ${internetLabel}`}
                </p>
                <p className={`font-medium ${serverTone}`}>
                  {conn.server === SERVER_STATES.CONNECTED
                    ? "Server connected"
                    : conn.server === SERVER_STATES.UNREACHABLE
                      ? "Server unreachable"
                      : "Server: checking…"}
                </p>
                <p className={`font-medium flex items-center gap-1.5 ${dbTone}`}>
                  <Database size={13} />
                  {conn.database === DB_STATES.CONNECTED
                    ? "Database connected"
                    : conn.database === DB_STATES.UNAVAILABLE
                      ? "Database unavailable"
                      : "Database: unknown"}
                </p>
                {conn.lastError && (
                  <p className="text-xs text-red-600">{conn.lastError}</p>
                )}
              </div>

              <div className="px-3 py-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                <p className="truncate" title={conn.serverAddress || undefined}>
                  Server: {conn.serverAddress || "not checked yet"}
                </p>
                <p>Last successful server check: {lastCheckLabel}</p>
                <p>
                  Offline sales: {queueSummary}
                  {syncing ? " · syncing…" : syncError ? " · sync error" : ""}
                </p>
              </div>

              <div className="px-3 py-2 border-t border-slate-100 flex gap-2">
                <button
                  onClick={() => void checkNow()}
                  disabled={conn.checking}
                  className="h-8 px-2.5 border border-slate-200 rounded text-xs hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <RefreshCw size={12} className={conn.checking ? "animate-spin" : ""} />
                  Check again
                </button>
                <button
                  onClick={() => {
                    setShowDiagnostics(false);
                    onQueue();
                  }}
                  className="h-8 px-2.5 border border-slate-200 rounded text-xs hover:bg-slate-50"
                >
                  View queue
                </button>
              </div>
            </div>
          )}
        </div>

        {/* MANAGE TILL — icon-only below md, icon+label at md+. */}
        <button
          onClick={onManageTill}
          className="h-9 px-2 md:px-3 bg-slate-800 rounded-md text-sm hover:bg-slate-700 transition-colors flex items-center gap-1.5 shrink-0"
          title="Manage Till"
        >
          <span className="hidden md:inline">Manage Till</span>
          <span className="md:hidden">Till</span>
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
          <span className="sm:hidden">A</span>
        </button>

        {/* LOGOUT */}
        <button
          onClick={onLogout}
          className="h-9 w-9 flex items-center justify-center hover:bg-slate-800 rounded-md transition-colors shrink-0"
          title="Logout"
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  );
}

export default POSHeader;
