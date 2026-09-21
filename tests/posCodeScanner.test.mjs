/*
 * POS "Search Code" camera barcode scanner (Android + web) — regression tests.
 *
 * The camera/decoder boundary cannot run headless, so tests target the
 * seams (same convention as tests/scanAndGoCamera.test.mjs):
 *   - ProductGrid exposes Search Code and returns the detected code to the
 *     EXISTING search flow (onSearchChange) — no new API path
 *   - the scanner reuses the existing @zxing/library stack (no new library)
 *   - camera released on close/unmount; no frame/video upload anywhere
 *   - AndroidManifest declares CAMERA (Capacitor's BridgeWebChromeClient
 *     maps the WebView VIDEO_CAPTURE request onto it)
 *   - cameraScannerSupport is browser-safe (guarded process.env) so the
 *     shared module can ship in the POS bundle — which also makes the
 *     previously-empty "zxing" chunk live again
 *
 *   node --test tests/posCodeScanner.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

const GRID_SRC = read("../src/pages/pos/ProductGrid.jsx");
const SCANNER_SRC = read("../src/pages/pos/CodeScannerModal.jsx");
const SUPPORT_SRC = read("../src/pages/scanAndGo/cameraScannerSupport.js");
const MANIFEST_SRC = read("../android/app/src/main/AndroidManifest.xml");

test("Search Code button exists and funnels the code into the existing search flow", () => {
  assert.ok(GRID_SRC.includes("pos-search-code-button"), "scan button testid present");
  assert.ok(SCANNER_SRC.includes("onDetected"), "scanner exposes onDetected");
  /* The bridge back to the existing search flow: code -> onSearchChange. */
  assert.ok(
    GRID_SRC.includes("onSearchChange(code)"),
    "detected code must be returned to the existing search flow",
  );
  /* No new lookup path: no direct product API call from the scanner pair. */
  assert.ok(!SCANNER_SRC.includes("apiRequest"), "scanner must not call APIs");
  assert.ok(
    !GRID_SRC.includes("pos-code-scanner") === false || GRID_SRC.includes("CodeScannerModal"),
    "grid renders the scanner modal",
  );
});

test("scanner reuses the existing ZXing stack with the retail formats (no new library)", () => {
  assert.ok(SCANNER_SRC.includes('@import("@zxing/library")') || SCANNER_SRC.includes('import("@zxing/library")'), "lazy @zxing/library import");
  for (const format of ["EAN_13", "EAN_8", "UPC_A", "UPC_E", "CODE_128"]) {
    assert.ok(SCANNER_SRC.includes(`BarcodeFormat.${format}`), `requests ${format}`);
  }
  assert.ok(SCANNER_SRC.includes("describeCameraError"), "reuses the shared error mapping");
  assert.ok(SCANNER_SRC.includes("createBarcodeDebounce"), "reuses the shared debounce");
});

test("camera lifecycle: released on close and unmount; no frame upload", () => {
  const stopCalls = (SCANNER_SRC.match(/track\.stop\(\)/g) || []).length;
  assert.ok(stopCalls >= 1, "stops MediaStream tracks");
  assert.ok(SCANNER_SRC.includes("releaseCamera();\n    onClose();"), "close releases the camera");
  assert.ok(/unmountedRef\.current = true;\s*\r?\n\s*releaseCamera\(\);/.test(SCANNER_SRC), "unmount releases the camera");
  assert.ok(!/fetch|XMLHttpRequest|FormData/.test(SCANNER_SRC), "no network upload of camera data");
});

test("Android manifest declares CAMERA for the WebView scanner", () => {
  assert.ok(MANIFEST_SRC.includes("android.permission.CAMERA"), "CAMERA permission present");
  assert.ok(
    /<uses-feature android:name="android\.hardware\.camera" android:required="false" \/>/.test(MANIFEST_SRC),
    "camera hardware optional (non-camera devices still install)",
  );
});

test("cameraScannerSupport is browser-safe (guarded process.env)", () => {
  assert.ok(
    /typeof process !== "undefined"/.test(SUPPORT_SRC),
    "process.env access must be guarded for the browser bundle",
  );
});

test("zxing chunk is live: the POS scanner path imports the shared support module", () => {
  assert.ok(
    SCANNER_SRC.includes("../scanAndGo/cameraScannerSupport.js"),
    "POS scanner imports the shared cameraScannerSupport module",
  );
  const configSrc = read("../vite.config.js");
  assert.ok(configSrc.includes('zxing: ["@zxing/library"]'), "manualChunks target kept");
});
