import { apiRequest } from "./api.js";
import { normalizePreferences } from "../utils/adminPreferences.js";

/*
 * onePOS Admin presentation preference persistence.
 *
 * USER-level (not company) storage, backed by the dedicated
 * GET/PUT /api/auth/me/preferences endpoints — the same session-token
 * convenience pattern as /api/auth/me/permissions. A localStorage mirror
 * gives an instant first paint and keeps the choice when the API is
 * unreachable (offline till gateways), while the server row keeps the
 * preference across devices. No second settings framework: one tiny
 * user-scoped key/value row.
 */

const CACHE_KEY = "onepos_admin_prefs";

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? normalizePreferences(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(prefs) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode — the server row remains the source of truth */
  }
}

/** Cached prefs for the synchronous first paint (may be null). */
export function loadCachedPreferences() {
  return readCache();
}

/** Server preferences for the signed-in user (null when unavailable). */
export async function fetchPreferences() {
  try {
    const data = await apiRequest("/api/auth/me/preferences");
    if (data?.success && data.data) {
      const prefs = normalizePreferences(data.data);
      writeCache(prefs);
      return prefs;
    }
  } catch {
    /* offline / not signed in — the cache (or defaults) is used instead */
  }
  return readCache();
}

/** Persist changed prefs server-side and mirror them locally. */
export async function savePreferences(prefs) {
  const normalized = normalizePreferences(prefs);
  writeCache(normalized);
  try {
    const data = await apiRequest("/api/auth/me/preferences", {
      method: "PUT",
      body: JSON.stringify(normalized),
    });
    if (data?.success && data.data) return normalizePreferences(data.data);
  } catch {
    /* keep the local mirror; the next save retries */
  }
  return normalized;
}

/** Remove the local mirror only (logout housekeeping; server row persists). */
export function clearCachedPreferences() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export default {
  loadCachedPreferences,
  fetchPreferences,
  savePreferences,
  clearCachedPreferences,
};
