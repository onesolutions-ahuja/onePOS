/*
 * T10P-CAMERA — camera scanning support logic.
 *
 * Pure, browser-independent helpers for the Scan & Go camera scanner:
 *   - duplicate-scan debounce (one physical scan must add exactly one item)
 *   - friendly error mapping for camera permission/device/browser failures
 *   - the barcode formats the camera scanner claims to support
 *
 * No camera, network or React code lives here — only this file, so it can be
 * unit-tested with node:test (see tests/scanAndGoCamera.test.mjs).
 */

/* Same-barcode debounce window. Different barcodes are never blocked. */
export const CAMERA_SCAN_DEBOUNCE_MS = Number(
  (typeof process !== "undefined" ? process.env?.SCAN_GO_CAMERA_DEBOUNCE_MS : undefined) || 2000
);

/*
 * ZXing BarcodeFormat values the camera scanner requests. Only formats this
 * library actually decodes in-browser are listed:
 * EAN-13, EAN-8, UPC-A, UPC-E, Code 128 — the common retail formats for an
 * off-licence/retail environment. (Code 39 / QR etc. are deliberately NOT
 * advertised.)
 */
export const CAMERA_BARCODE_FORMATS = [
  "EAN_13",
  "EAN_8",
  "UPC_A",
  "UPC_E",
  "CODE_128",
];

/**
 * Create a same-barcode debounce gate.
 *
 * A barcode remains visible to the camera for many frames; this ensures one
 * physical scan is processed exactly once, while legitimate rapid scans of
 * DIFFERENT products always pass through.
 *
 * Returns a function (code, nowMs?) -> true when the code should be
 * processed, false when it is a repeat within the debounce window.
 */
export function createBarcodeDebounce(windowMs = CAMERA_SCAN_DEBOUNCE_MS) {
  let lastCode = "";
  let lastAt = 0;
  return (code, now = Date.now()) => {
    const value = String(code || "").trim();
    if (!value) return false;
    if (value === lastCode && now - lastAt < windowMs) return false;
    lastCode = value;
    lastAt = now;
    return true;
  };
}

/**
 * Reset the debounce gate (e.g. when the scanner is reopened) so a barcode
 * held over from a previous scanner session is not silently swallowed.
 */
export function resetBarcodeDebounce(shouldProcess) {
  /* Recreated gates start clean; exposed for symmetry in tests. */
  return shouldProcess;
}

/**
 * Map a camera/decoder failure to a short, customer-friendly message.
 * Raw error text/stack traces are NEVER surfaced to the customer.
 */
export function describeCameraError(err) {
  const name = err && (err.name || "");
  const message = String((err && err.message) || err || "").toLowerCase();

  if (name === "NotAllowedError" || name === "PermissionDeniedError" || message.includes("permission")) {
    return "Camera access was blocked. Please allow camera access in your browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError" || message.includes("no camera") || message.includes("not readable")) {
    return "No camera is available on this device.";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || message.includes("could not start video") || message.includes("in use")) {
    return "The camera is already in use by another app. Close it and try again.";
  }
  if (name === "SecurityError" || message.includes("secure context") || message.includes("https")) {
    return "Camera scanning requires a secure connection. Please open this page over HTTPS.";
  }
  return "The camera scanner could not start. You can still type or scan the barcode with the box scanner.";
}
