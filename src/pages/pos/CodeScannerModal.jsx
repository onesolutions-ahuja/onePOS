import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  CAMERA_SCAN_DEBOUNCE_MS,
  createBarcodeDebounce,
  describeCameraError,
} from "../scanAndGo/cameraScannerSupport.js";

/*
 * POS "Search Code" camera barcode scanner (till-side, Android + web).
 *
 * Reuses the EXISTING Scan & Go scanner stack (@zxing/library +
 * cameraScannerSupport.js) rather than a new library — same decoder, same
 * debounce, same friendly error mapping. Differences are only the call site:
 *   - the detected code is handed to the caller via onDetected (the caller
 *     funnels it into the existing product search flow); the modal stays
 *     open so several products can be scanned in a row
 *   - no Scan & Go session/API involvement here
 *
 * Camera notes (Android Capacitor): getUserMedia requires CAMERA in the
 * AndroidManifest (added) — Capacitor's BridgeWebChromeClient maps the
 * WebView VIDEO_CAPTURE request onto it and shows the runtime dialog.
 * Desktop browser behaviour is unchanged (same getUserMedia constraints).
 * Frames never leave the device — only the decoded text is used.
 */

export default function CodeScannerModal({ onClose, onDetected }) {
  const [status, setStatus] = useState("starting"); // starting | scanning | error
  const [message, setMessage] = useState("");
  const [lastCode, setLastCode] = useState("");
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const unmountedRef = useRef(false);
  const shouldProcessRef = useRef(createBarcodeDebounce(CAMERA_SCAN_DEBOUNCE_MS));

  /* Fully release the camera: reset the decoder and stop every track. */
  const releaseCamera = useCallback(() => {
    const reader = readerRef.current;
    readerRef.current = null;
    if (reader) {
      try { reader.reset(); } catch { /* already stopped */ }
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      stream.getTracks().forEach((track) => { try { track.stop(); } catch { /* noop */ } });
    }
  }, []);

  /* Feed the detected barcode to the caller (existing search flow) and
     keep scanning so the next product can be scanned immediately. */
  const handleDetected = useCallback(
    (code) => {
      setLastCode(code);
      try {
        onDetected?.(code);
      } catch { /* the search flow owns its own error handling */ }
    },
    [onDetected],
  );

  const startScanning = useCallback(async () => {
    if (unmountedRef.current) return;
    setStatus("starting");
    setMessage("");
    try {
      /* Same lazy-load seam as the Scan & Go scanner. */
      const ZX = await import("@zxing/library");
      if (unmountedRef.current || !videoRef.current) return;
      const { DecodeHintType, BarcodeFormat, BrowserMultiFormatReader } = ZX;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
      ]);
      const reader = new BrowserMultiFormatReader(hints);
      readerRef.current = reader;

      await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } }, /* rear camera preferred */
        videoRef.current,
        (result) => {
          if (!result || unmountedRef.current) return;
          const code = result.getText();
          if (!shouldProcessRef.current(code)) return;
          handleDetected(code);
        },
      );
      streamRef.current = videoRef.current?.srcObject || null;
      if (unmountedRef.current) { releaseCamera(); return; }
      setStatus("scanning");
    } catch (err) {
      if (unmountedRef.current) return;
      releaseCamera();
      setStatus("error");
      setMessage(describeCameraError(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseCamera, handleDetected]);

  useEffect(() => {
    startScanning();
    return () => {
      unmountedRef.current = true;
      releaseCamera();
    };
  }, [startScanning, releaseCamera]);

  const handleClose = () => {
    releaseCamera();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900 flex flex-col"
      role="dialog"
      aria-label="Search Code camera barcode scanner"
      data-testid="pos-code-scanner"
    >
      <header className="flex items-center justify-between px-4 py-3 shrink-0">
        <div>
          <h2 className="text-white font-semibold text-sm">Search Code</h2>
          <p className="text-slate-300 text-xs">Point a barcode inside the box — it fills the product search</p>
        </div>
        <button
          onClick={handleClose}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
          aria-label="Close Scanner"
          data-testid="pos-code-scanner-close"
        >
          <X size={20} />
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
          autoPlay
        />
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-36 border-4 border-white/90 rounded-2xl pointer-events-none"
          style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
        />
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
          {status === "starting" ? "Starting camera…" : "Point the barcode inside the box"}
        </div>
      </div>

      <footer className="p-4 shrink-0 space-y-3">
        {lastCode && (
          <p
            className="text-center text-sm bg-emerald-900/60 border border-emerald-500/50 text-emerald-200 rounded-lg p-2"
            data-testid="pos-code-scanner-last-code"
          >
            Scanned: {lastCode}
          </p>
        )}
        {status === "error" && (
          <p
            className="text-center text-sm bg-red-900/60 border border-red-500/50 text-red-200 rounded-lg p-3"
            role="alert"
            data-testid="pos-code-scanner-error"
          >
            {message}
          </p>
        )}
        <button
          onClick={handleClose}
          className="w-full h-12 bg-white text-slate-900 rounded-lg text-sm font-semibold hover:bg-slate-100"
          data-testid="pos-code-scanner-close-button"
        >
          Close Scanner
        </button>
      </footer>
    </div>
  );
}
