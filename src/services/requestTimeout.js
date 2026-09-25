/*
 * Client-side request timeout helper with a fallback for runtimes without
 * AbortSignal.timeout (Safari < 15.4, older WebViews). Timeouts reject with an
 * AbortError so the existing isTimeoutError classifier keeps working.
 */
export function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(ms);
    }
  } catch { /* fall through to the manual controller below */ }
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try { controller.abort(new DOMException("Request timed out", "TimeoutError")); }
    catch { try { controller.abort(); } catch { /* ignore */ } }
  }, ms);
  if (timer?.unref) timer.unref();
  return controller.signal;
}

/* Rejects `promise` with a TIMEOUT error when `ms` elapses (for non-fetch waits). */
export function withTimeout(promise, ms, label = "Operation") {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out`);
      error.name = "TimeoutError";
      error.code = "TIMEOUT";
      error.timeout = true;
      reject(error);
    }, ms);
    if (timer?.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
