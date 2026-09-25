/*
 * THE canonical dock configuration — one source of truth for the six
 * customizable quick-access slots.
 *
 *   company configuration  (Settings → Store & Till → Dock Quick Access,
 *                           persisted by the existing PUT /api/settings
 *                           `dockQuickAccess` field and read back from
 *                           GET /api/settings → data.dock.quickAccess)
 *              ↓
 *   normalizeDockQuickAccess()  (≤ 6 slots, deduped, reserved pages removed)
 *              ↓
 *   AdminNavDock  ← the ONE dock component mounted by every shell:
 *                   admin pages · Till/POS · Settings · Custom Pages
 *
 * No shell may pass its own slot list: the dock loads this configuration
 * itself, so a route can never substitute a minimal/compact item set.
 */
import { apiRequest } from "../services/api.js";

/** Maximum desktop/tablet quick-access slots before JARVIS. */
export const DOCK_QUICK_ACCESS_LIMIT = 6;

/**
 * Fallback when nothing is saved (or the request fails). This mirrors the
 * backend default in services/settingsService (dock.quickAccess), so the first
 * paint and the persisted default are the same six pages.
 */
export const DEFAULT_DOCK_QUICK_ACCESS = Object.freeze([
  "Dashboard",
  "Sales",
  "Products",
  "Inventory",
  "Customers",
  "Reports",
]);

/**
 * Pages that own a FIXED dock destination and must never occupy a configurable
 * slot: Settings sits at the far end of the bar next to All Pages.
 */
export const DOCK_RESERVED_PAGES = Object.freeze(["Settings"]);

const RESERVED = new Set(DOCK_RESERVED_PAGES);

/**
 * Normalizes a saved configuration into the canonical slot list.
 * Non-array/empty/invalid input falls back to the canonical default, so the
 * dock can never be rendered empty or shorter by a bad payload.
 */
export function normalizeDockQuickAccess(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const slots = [];
  for (const raw of source) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || RESERVED.has(name) || seen.has(name)) continue;
    seen.add(name);
    slots.push(name);
    if (slots.length >= DOCK_QUICK_ACCESS_LIMIT) break;
  }
  return slots.length ? slots : [...DEFAULT_DOCK_QUICK_ACCESS];
}

/**
 * The slots a specific caller may actually see: the canonical configuration
 * intersected with the pages that caller is permitted (and has licensed) to
 * open. A saved shortcut the user cannot reach is dropped, never rendered.
 *
 * @param {object} input
 * @param {unknown} input.quickAccess  the saved list (or null)
 * @param {Iterable<string>} input.permitted page names the caller may render
 */
export function resolveDockQuickSlots({ quickAccess, permitted } = {}) {
  const allowed = permitted instanceof Set ? permitted : new Set(permitted || []);
  return normalizeDockQuickAccess(quickAccess).filter((name) => allowed.has(name));
}

/*
 * Module-level cache: every shell (admin pages, till, custom pages) shares ONE
 * request and ONE resolved list. A shell that mounts later paints from the
 * cached snapshot immediately instead of flashing the default layout.
 */
let snapshot = null;
let inFlight = null;
const listeners = new Set();

export function dockQuickAccessSnapshot() {
  return snapshot;
}

export function subscribeDockQuickAccess(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyDockQuickAccess(value) {
  if (value === null) {
    snapshot = null;
    return null;
  }
  snapshot = normalizeDockQuickAccess(value);
  for (const listener of listeners) {
    try { listener(snapshot); } catch { /* isolate subscribers */ }
  }
  return snapshot;
}

export function loadDockQuickAccess() {
  if (snapshot) return Promise.resolve(snapshot);
  if (inFlight) return inFlight;
  inFlight = apiRequest("/api/settings")
    .then((response) => {
      const saved = response?.success ? response.data?.dock?.quickAccess : null;
      /* The saved list is authoritative; a missing/failed payload keeps the
         canonical default (never an empty dock). */
      return saved ? applyDockQuickAccess(saved) : null;
    })
    .catch(() => null)
    .finally(() => { inFlight = null; });
  return inFlight;
}

/** Drops the cached configuration (sign-out, tests, explicit re-resolution). */
export function resetDockConfigurationCache() {
  snapshot = null;
  inFlight = null;
}
