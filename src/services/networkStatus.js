/*
|--------------------------------------------------------------------------
| Network status foundation (T8A - offline architecture, first batch)
|--------------------------------------------------------------------------
|
| Browser-native, dependency-free helpers for the upcoming offline POS
| batch. Nothing imports this module yet, so application behaviour is
| completely unchanged - it is the shared foundation the offline batch
| will build on.
|
| Two jobs only:
|   1. React-free online/offline detection via the browser's own events.
|   2. Classifying a thrown apiRequest error as a TRANSPORT failure
|      (request never reached the server) versus a SERVER answer (4xx/5xx).
|      That distinction decides what may be queued offline: transport
|      failures are queueable, server rejections (validation, stock,
|      permissions) are not.
*/

let backendOnline = true;
const listeners = new Set();

export function reportConnection(online) {
  const changed = backendOnline !== online;
  backendOnline = online;
  if (changed) for (const listener of listeners) {
    try { listener(isOnline()); } catch { /* isolate subscribers */ }
  }
}
export function isOnline() {
  // Backend reachability is authoritative: if the backend has confirmed
  // it's reachable via a health check, the POS is online regardless of
  // navigator.onLine. This prevents false OFFLINE status when the browser
  // reports offline but the backend is actually reachable.
  //
  // navigator.onLine is still consulted as a fast path for transport-level
  // disconnections when backendOnline is false (e.g., network cable unplugged,
  // Wi-Fi turned off).
  if (backendOnline) return true;
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/*
 * Subscribes to the browser's network-change events.
 * Returns an unsubscribe function (safe to return from a useEffect cleanup).
 */
export function onNetworkChange(handler) {
  listeners.add(handler);
  const goOnline = () => { backendOnline = true; handler(true); };
  const goOffline = () => { /* Don't override backendOnline; let the
      next health check (reportConnection) determine actual backend reachability.
      This prevents false OFFLINE status when the browser reports offline but
      the backend is actually reachable. */ handler(isOnline()); };

  window.addEventListener("online", goOnline);
  window.addEventListener("offline", goOffline);

  return () => {
    listeners.delete(handler);
    window.removeEventListener("online", goOnline);
    window.removeEventListener("offline", goOffline);
  };
}

/*
 * True when the request never reached the server: `fetch` rejects with a
 * TypeError for offline/DNS/refused/CORS-abort transport failures, while
 * every server answer routed through apiRequest's error path carries a
 * numeric `status`. Used to decide "queue this sale locally" vs "show the
 * server's rejection to the cashier".
 */
export function isNetworkError(error) {
  if (!error || typeof error !== "object") return false;
  if (error.status !== undefined) return false;
  /*
   * A client timeout is transport-ambiguous: the server may have committed
   * the request before the client stopped waiting. Treat it as retryable so
   * callers preserve the idempotency key and can safely reconcile the result.
   */
  if (["TypeError"].includes(error.name)) return true;
  if (isTimeoutError(error)) return true;
  return (
    error.status === undefined &&
    error.code === undefined &&
    /fetch|network/i.test(error.message || "")
  );
}

/*
 * True when the request was aborted by a client-side timeout (AbortSignal →
 * AbortError/TimeoutError, or a `.timeout()` helper rejection). A timeout is
 * transport-ambiguous: the server may have committed before the client
 * stopped waiting, so callers must preserve idempotency data and retry safely.
 */
export function isTimeoutError(error) {
  if (!error || typeof error !== "object") return false;
  if (error.code === "TIMEOUT" || error.timeout === true) return true;
  if (error.status !== undefined) return false;
  if (error.name === "TimeoutError") return true;
  if (error.name === "AbortError") return true;
  return /timed out|timeout|aborted/i.test(error.message || "");
}
