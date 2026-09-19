/*
 * T10P-CAMERA — Scan & Go camera barcode scanning tests (permanent).
 *
 * The camera/decoder boundary (@zxing/library + getUserMedia) cannot run in
 * a headless test environment, so the tests target the seam we control:
 *   - the pure scanning logic in cameraScannerSupport.js (debounce, error
 *     mapping, supported formats) — unit tested directly
 *   - the wiring in ScanAndGo.jsx / CameraScanner.jsx — source-level
 *     assertions (same convention as tests/scanAndGo.test.mjs), verifying
 *     the camera feeds the EXISTING scan() flow and never sends camera
 *     image/video data to the backend
 *
 *   node --test tests/scanAndGoCamera.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  CAMERA_BARCODE_FORMATS,
  CAMERA_SCAN_DEBOUNCE_MS,
  createBarcodeDebounce,
  describeCameraError,
} from "../src/pages/scanAndGo/cameraScannerSupport.js";

const pageSrc = fs.readFileSync(
  new URL("../src/pages/scanAndGo/ScanAndGo.jsx", import.meta.url),
  "utf8",
);
const scannerSrc = fs.readFileSync(
  new URL("../src/pages/scanAndGo/CameraScanner.jsx", import.meta.url),
  "utf8",
);

/* --------------------------- supported formats --------------------------- */

test("camera scanner advertises exactly the retail formats ZXing supports", () => {
  assert.deepEqual([...CAMERA_BARCODE_FORMATS].sort(), ["CODE_128", "EAN_13", "EAN_8", "UPC_A", "UPC_E"]);
  /* Component requests exactly these ZXing formats — nothing more. */
  for (const format of CAMERA_BARCODE_FORMATS) {
    assert.ok(scannerSrc.includes(`BarcodeFormat.${format}`), `scanner requests ${format}`);
  }
  /* Do not claim unsupported formats (e.g. QR / Code 39 / PDF417). */
  assert.ok(!scannerSrc.includes("QR_CODE"));
  assert.ok(!scannerSrc.includes("CODE_39"));
  assert.ok(!scannerSrc.includes("PDF_417"));
});

/* ----------------------------- debounce logic ---------------------------- */

test("same barcode within the debounce window is processed once", () => {
  const shouldProcess = createBarcodeDebounce(2000);
  assert.equal(shouldProcess("5000111122223", 1000), true);
  assert.equal(shouldProcess("5000111122223", 1500), false); /* repeat frame */
  assert.equal(shouldProcess("5000111122223", 2500), false); /* still inside window */
  assert.equal(shouldProcess("5000111122223", 4500), true);  /* window elapsed — intentional rescan */
});

test("different barcodes are never blocked by the debounce", () => {
  const shouldProcess = createBarcodeDebounce(2000);
  assert.equal(shouldProcess("5000111122223", 1000), true);
  assert.equal(shouldProcess("5000444455556", 1100), true); /* rapid different scan */
  assert.equal(shouldProcess("5000111122223", 1200), true); /* back to first */
});

test("debounce ignores empty/whitespace codes and defaults to the configured window", () => {
  const shouldProcess = createBarcodeDebounce();
  assert.equal(CAMERA_SCAN_DEBOUNCE_MS > 0, true);
  assert.equal(shouldProcess(""), false);
  assert.equal(shouldProcess("   "), false);
  assert.equal(shouldProcess("5000111122223"), true);
});

/* ----------------------------- error mapping ----------------------------- */

test("camera failures map to friendly messages without raw error text", () => {
  const denied = describeCameraError(Object.assign(new Error("permission"), { name: "NotAllowedError" }));
  assert.match(denied, /allow camera access/i);

  const noCamera = describeCameraError(Object.assign(new Error("Requested device not found"), { name: "NotFoundError" }));
  assert.match(noCamera, /no camera is available/i);

  const busy = describeCameraError(Object.assign(new Error("could not start video source"), { name: "NotReadableError" }));
  assert.match(busy, /already in use/i);

  const insecure = describeCameraError(Object.assign(new Error("insecure context"), { name: "SecurityError" }));
  assert.match(insecure, /secure connection/i);

  /* Unknown errors stay generic — no stack traces reach the customer. */
  const mystery = describeCameraError(new Error("weird internal stack bomb 0xdeadbeef"));
  assert.match(mystery, /could not start/i);
  assert.ok(!mystery.includes("0xdeadbeef"));
});

/* ------------------------ wiring / regression guards ---------------------- */

test("Scan & Go page renders the camera button and reuses the existing scan flow", () => {
  assert.ok(pageSrc.includes('data-testid="scan-go-camera-open"'), "[Scan with Camera] button present");
  assert.ok(pageSrc.includes("<CameraScanner"), "CameraScanner modal is rendered");
  /* Camera detected codes go through the EXISTING scan() lookup/add flow. */
  assert.match(pageSrc, /onDetected=\{scan\}/);
  /* No second lookup/add implementation was added. */
  const lookupCalls = (pageSrc.match(/scan-go\/product\//g) || []).length;
  assert.equal(lookupCalls, 1, "existing barcode lookup endpoint used exactly once");
});

test("camera scanner never sends image/video data to the backend", () => {
  assert.ok(!scannerSrc.includes("apiRequest"), "scanner must not call the API itself");
  assert.ok(!scannerSrc.includes("fetch("), "scanner must not fetch directly");
  assert.ok(!scannerSrc.includes("FormData"), "no image upload");
  assert.ok(!scannerSrc.includes("captureStream"), "no video capture/upload");
  /* Only decoded barcode text flows through onDetected. */
  assert.ok(scannerSrc.includes("onDetected(code)"));
});

test("scanner releases camera on close, on detection, on unmount and session end", () => {
  assert.match(scannerSrc, /releaseCamera[\s\S]*track\.stop/, "all MediaStream tracks are stopped");
  assert.match(scannerSrc, /unmountedRef\.current = true;[\s\S]*releaseCamera\(\)/,
    "unmount cleanup stops the camera");
  assert.ok(scannerSrc.includes("handleClose"), "explicit close path stops the camera");
  /* On detection the decoder is reset and tracks stopped before lookup. */
  assert.match(scannerSrc, /pausedRef\.current = true;[\s\S]{0,60}releaseCamera\(\);[\s\S]{0,60}setStatus\("paused"\)/,
    "scanning pauses/stops on barcode detection");
  assert.match(pageSrc, /setCameraOpen\(false\); \/\* T10P-CAMERA: release camera when session ends/,
    "checkout/session end closes the scanner");
});

test("scanner handles permission, device and unsupported-browser states with friendly UI", () => {
  /* Lazy ZXing import + try/catch -> friendly error state, no stack traces. */
  assert.ok(scannerSrc.includes('data-testid="scan-go-camera-error"'), "friendly error state exists");
  assert.ok(scannerSrc.includes("facingMode"), "rear/environment camera preferred");
  assert.ok(scannerSrc.includes('aria-label="Close Scanner"'));
  assert.ok(scannerSrc.includes('aria-label="Camera barcode scanner"'));
});

test("existing keyboard/handheld scan input is untouched", () => {
  assert.ok(pageSrc.includes("Scan or type a barcode"), "text/keyboard wedge input still present");
  assert.ok(pageSrc.includes('onKeyDown={(event) => { if (event.key === "Enter") scan(scanInput); }}'),
    "Enter-key submit (keyboard-wedge behaviour) still wired");
  assert.ok(pageSrc.includes('onClick={() => scan(scanInput)}'), "Add button still wired");
});

