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
  return (typeof navigator === "undefined" || navigator.onLine !== false) && backendOnline;
}

/*
 * Subscribes to the browser's network-change events.
 * Returns an unsubscribe function (safe to return from a useEffect cleanup).
 */
export function onNetworkChange(handler) {
  listeners.add(handler);
  const goOnline = () => { backendOnline = true; handler(true); };
  const goOffline = () => handler(false);

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
  if (["TypeError", "AbortError", "TimeoutError"].includes(error.name)) return true;
  return (
    error.status === undefined &&
    error.code === undefined &&
    /fetch|network/i.test(error.message || "")
  );
}
