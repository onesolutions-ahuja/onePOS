/*
|--------------------------------------------------------------------------
| Server address (native app + web fallback)
|--------------------------------------------------------------------------
|
| The packaged Android app loads the bundle from Capacitor's local origin
| (https://localhost via androidScheme), which serves the web assets ONLY.
| Every API call the app makes is a RELATIVE /api/... URL (see
| services/api.js), so on a device that relative URL resolves against the
| WebView instead of the store's backend and every request fails.
|
| This module is the single place that knows WHERE the backend for this
| device lives:
|
|   - Web (no address stored) -> nothing changes. Relative /api URLs keep
|     resolving against the page's own origin, exactly as before.
|   - Native app / paired device -> the cashier's saved server address is
|     prefixed onto relative API URLs.
|
| Only the ORIGIN is ever stored. Whatever path or query is typed is
| dropped, so a stray "/pos" can never silently re-scope every request.
| Storage access is guarded: a disabled/private-mode localStorage must not
| break sign-in - the address is simply not persisted.
*/

const SERVER_ADDRESS_KEY = "onepos_server_address";

/*
 * True when running inside a Capacitor native shell. Reads the injected
 * window.Capacitor global rather than importing @capacitor/core, so the web
 * bundle keeps working (and the module stays testable) outside the shell.
 */
export function isNativeApp() {
  if (typeof window === "undefined") return false;
  const capacitor = window.Capacitor;
  if (!capacitor) return false;
  try {
    if (typeof capacitor.isNativePlatform === "function") {
      return capacitor.isNativePlatform() === true;
    }
    return capacitor.platform === "android" || capacitor.platform === "ios";
  } catch {
    return false;
  }
}

/*
 * Normalises cashier input to a bare origin, or "" when it is not usable.
 * Accepts "192.168.1.50:10000", "pos.example.com", "https://pos.example.com/api".
 * Rejects non-HTTP schemes and anything URL cannot parse.
 */
export function normaliseServerAddress(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  /* An explicit non-HTTP(S) scheme is a mistake, not a shorthand: refuse it
     instead of silently rewriting it to http://ftp://host. */
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) return "";

  const candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname) return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

/* The saved server origin for this device, or "" when none is configured. */
export function getServerAddress() {
  try {
    return normaliseServerAddress(localStorage.getItem(SERVER_ADDRESS_KEY));
  } catch {
    return "";
  }
}

/*
 * Saves the address (normalised) and returns what was actually stored.
 * An unusable/blank value clears the stored address instead of persisting
 * a broken one.
 */
export function setServerAddress(value) {
  const normalised = normaliseServerAddress(value);
  try {
    if (normalised) localStorage.setItem(SERVER_ADDRESS_KEY, normalised);
    else localStorage.removeItem(SERVER_ADDRESS_KEY);
  } catch {
    // Storage disabled: the address applies to this session only.
  }
  return normalised;
}

export function clearServerAddress() {
  try { localStorage.removeItem(SERVER_ADDRESS_KEY); } catch { /* ignore */ }
}

/*
 * Resolves an apiRequest URL against this device's backend.
 *   "/api/auth/login"   -> unchanged (web) | "https://host/api/auth/login"
 *   "https://x/api"     -> unchanged (already absolute)
 *   "//host/api"        -> unchanged (protocol-relative, not ours to rewrite)
 */
export function resolveApiUrl(url) {
  const target = String(url ?? "");
  const isRelative = target.startsWith("/") && !target.startsWith("//");
  if (!isRelative) return target;
  const base = getServerAddress();
  return base ? `${base}${target}` : target;
}

export const SERVER_ADDRESS_STORAGE_KEY = SERVER_ADDRESS_KEY;
