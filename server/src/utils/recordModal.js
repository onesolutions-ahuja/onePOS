/*
 * Pure logic for the shared RecordModal.
 *
 * Kept in a plain .js module (not the .jsx component) so the unsaved-change
 * contract can be unit tested directly, without a DOM or a JSX transform.
 */

export const DISCARD_MESSAGE = "Discard unsaved changes?";

/** Default confirmation surface. Guards for non-browser environments. */
export const defaultConfirmDiscard = (message) =>
  typeof window !== "undefined" && typeof window.confirm === "function"
    ? window.confirm(message)
    : true;

/**
 * Decide whether a close request should proceed.
 *
 *   clean form            -> always closes, never prompts
 *   dirty + user confirms -> closes (discards)
 *   dirty + user declines -> stays open, data preserved
 *
 * `confirmDiscard` is injectable so callers (and tests) can supply their own
 * confirmation UI instead of window.confirm.
 */
export function resolveCloseIntent({ dirty = false, confirmDiscard = defaultConfirmDiscard } = {}) {
  if (!dirty) return true;
  return confirmDiscard(DISCARD_MESSAGE) === true;
}
