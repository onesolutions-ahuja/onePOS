/*
|--------------------------------------------------------------------------
| Authoritative connectivity state (Internet / onePOS Server / Database)
|--------------------------------------------------------------------------
|
| ONE small module owns connectivity for the whole POS. Everything that
| previously derived its own online/offline opinion (POSHeader's status
| text, POS's browser-event-only `online` state, the offline queue's binary
| signal) reflects THIS module's verdict, so the header can never say
| ONLINE while the body says OFFLINE.
|
| Status tiers (not collapsed into one generic "offline"):
|
|   internet   — "connected" | "disconnected" | "unknown"
|                browser events + verified against the next probe
|   server     — "connected" | "unreachable" | "unknown"
|                authoritative: a real GET <origin>/api/health answer.
|                navigator.onLine is NEVER used as the server verdict.
|   database   — "connected" | "unavailable" | "unknown"
|                reported by the server's own /api/health `database` field;
|                never invented locally.
|
| The backend ORIGIN comes from the existing Server Address mechanism
| (services/serverAddress.js — resolveApiUrl), which on native Android
| prefixes the cashier's saved server address onto relative /api URLs.
| Nothing here hard-codes a backend URL.
|
| Polling is deliberately light: default 30s interval, an immediate check
| when a subscriber asks (diagnostics popup open), and instant probe on
| browser online/offline events. The existing reportConnection()/isOnline()
| binary contract (services/networkStatus.js) stays authoritative for the
| offline-queue engine and is fed FROM here, so both systems agree.
*/

import { reportConnection } from "./networkStatus.js";
import { resolveApiUrl } from "./serverAddress.js";

export const INTERNET_STATES = { CONNECTED: "connected", DISCONNECTED: "disconnected", UNKNOWN: "unknown" };
export const SERVER_STATES = { CONNECTED: "connected", UNREACHABLE: "unreachable", UNKNOWN: "unknown" };
export const DB_STATES = { CONNECTED: "connected", UNAVAILABLE: "unavailable", UNKNOWN: "unknown" };

const state = {
  internet: navigator && navigator.onLine === false ? INTERNET_STATES.DISCONNECTED : INTERNET_STATES.UNKNOWN,
  server: SERVER_STATES.UNKNOWN,
  database: DB_STATES.UNKNOWN,
  serverAddress: "",
  lastServerOkAt: null,
  lastError: null,
  checking: false,
};

const listeners = new Set();
let pollTimer = null;
let pollMs = 0;
let inFlight = null;

function notify() {
  for (const listener of listeners) {
    try { listener(getConnectivity()); } catch { /* isolate subscribers */ }
  }
}

/* Public read-only snapshot. */
export function getConnectivity() {
  return { ...state };
}

export function subscribeConnectivity(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* Browser transport events: instant opinion, verified by an immediate probe. */
function handleOnlineEvent() {
  if (state.internet !== INTERNET_STATES.CONNECTED) {
    state.internet = INTERNET_STATES.CONNECTED;
    notify();
  }
  void checkNow();
}
function handleOfflineEvent() {
  /* The browser says the transport dropped. The server verdict stays until a
   * probe proves otherwise — no premature generic "offline" collapse. */
  state.internet = INTERNET_STATES.DISCONNECTED;
  notify();
}

/*
 * One health probe against the configured backend origin.
 *   fetch resolves with a 2xx       -> server connected (+ database from body)
 *   fetch resolves with 5xx         -> server reachable but unhealthy
 *   fetch rejects (TypeError/abort) -> transport failure: server unreachable;
 *                                      if the browser also says the network
 *                                      is down, internet reads disconnected.
 * Never throws. Consecutive calls share one in-flight request.
 */
export async function checkNow() {
  if (inFlight) return inFlight;
  state.checking = true;
  notify();

  inFlight = (async () => {
    const url = resolveApiUrl("/api/health");
    const origin = typeof window !== "undefined" && window.location ? window.location.origin : "";
    state.serverAddress = url.replace(/\/api\/health$/, "") || origin;
    try {
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        state.server = SERVER_STATES.CONNECTED;
        state.lastServerOkAt = new Date().toISOString();
        state.lastError = null;
        state.internet = INTERNET_STATES.CONNECTED;
        try {
          const body = await response.json();
          state.database = body && body.database === "connected" ? DB_STATES.CONNECTED
            : body && body.database === "error" ? DB_STATES.UNAVAILABLE
            : body && body.database === "not configured" ? DB_STATES.UNAVAILABLE
            : DB_STATES.UNKNOWN;
        } catch {
          state.database = DB_STATES.UNKNOWN; /* server answered but not JSON */
        }
      } else {
        state.server = SERVER_STATES.UNREACHABLE;
        state.database = DB_STATES.UNKNOWN;
        state.lastError = `Server responded HTTP ${response.status}`;
      }
    } catch (error) {
      state.server = SERVER_STATES.UNREACHABLE;
      state.database = DB_STATES.UNKNOWN;
      state.lastError = error && error.name === "TimeoutError" ? "Server check timed out" : "Server unreachable";
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        state.internet = INTERNET_STATES.DISCONNECTED;
      }
    } finally {
      state.checking = false;
      inFlight = null;
      /* Keep the queue's binary contract in agreement (server reachable = online). */
      reportConnection(state.server === SERVER_STATES.CONNECTED);
      notify();
    }
  })();

  return inFlight;
}

/*
 * Lightweight polling + browser events. Returns a stop function (safe for
 * useEffect cleanup); starting twice re-rates the interval, it never doubles.
 */
export function startConnectivityMonitoring({ intervalMs = 30000 } = {}) {
  if (typeof window === "undefined") return () => {};
  pollMs = Number(intervalMs) > 0 ? Number(intervalMs) : 0;
  window.addEventListener("online", handleOnlineEvent);
  window.addEventListener("offline", handleOfflineEvent);
  void checkNow();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = pollMs > 0 ? setInterval(() => void checkNow(), pollMs) : null;
  return stopConnectivityMonitoring;
}

export function stopConnectivityMonitoring() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (typeof window !== "undefined") {
    window.removeEventListener("online", handleOnlineEvent);
    window.removeEventListener("offline", handleOfflineEvent);
  }
}

/*
 * Plain-language line for the diagnostics popup. The generic word "offline"
 * is reserved for a KNOWN transport drop; a reachable server is never
 * reported as offline just because navigator.onLine is false.
 */
export function describeConnectivity({ internet, server, database } = getConnectivity()) {
  if (server === SERVER_STATES.CONNECTED) return "Server connected";
  if (internet === INTERNET_STATES.DISCONNECTED && server !== SERVER_STATES.CONNECTED) return "Internet unavailable";
  if (server === SERVER_STATES.UNREACHABLE) return "Server unreachable";
  if (server === SERVER_STATES.UNKNOWN && internet === INTERNET_STATES.UNKNOWN) return "Checking connection…";
  return "Connection unknown";
}
