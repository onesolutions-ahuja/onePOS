import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  CAMERA_SCAN_DEBOUNCE_MS,
  createBarcodeDebounce,
  describeCameraError,
} from "./cameraScannerSupport.js";

/*
 * T10P-CAMERA — Scan & Go camera scanner (customer-facing, phone-sized).
 *
 * A modal overlay that:
 *   - requests ONLY camera permission (video, rear camera preferred)
 *   - decodes barcodes 100% locally in the browser via @zxing/library
 *     (lazy-loaded so it never affects the main POS bundle)
 *   - funnels every detected barcode through the EXISTING Scan & Go flow via
 *     the onDetected callback (GET /api/scan-go/product/:code then
 *     POST /api/scan-go/items) — no duplicate lookup/add logic here
 *   - debounces the same barcode so one physical scan adds exactly one item
 *   - stops ALL MediaStream tracks on close, on successful add, and on
 *     unmount (session end / checkout)
 *
 * No camera frames, images or video are ever uploaded or logged — only the
 * decoded barcode text reaches the existing product lookup API.
 */

const RESUME_DELAY_MS = 1400;

export default function CameraScanner({ onClose, onDetected }) {
  const [status, setStatus] = useState("starting"); // starting | scanning | paused | error
  const [message, setMessage] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const pausedRef = useRef(false);
  const unmountedRef = useRef(false);
  const resumeTimerRef = useRef(null);
  const shouldProcessRef = useRef(createBarcodeDebounce(CAMERA_SCAN_DEBOUNCE_MS));

  /* Fully release the camera: reset the decoder and stop every track. */
  const releaseCamera = useCallback(() => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
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
    pausedRef.current = true;
  }, []);

  /* Feed the detected barcode into the EXISTING Scan & Go lookup/add flow.
   * The callback returns the outcome so the scanner knows whether to close
   * (product added) or resume (unknown / inactive / API failure). */
  const handleDetected = async (code) => {
    setResultMessage("");
    let outcome;
    try {
      outcome = await onDetected(code);
    } catch {
      outcome = { ok: false, message: "Something went wrong. Please try again." };
    }
    if (unmountedRef.current) return;
    if (outcome?.ok) {
      onClose(); /* back to the basket; cleanup stops any remaining camera */
      return;
    }
    /* Unknown product / inactive product / network failure — follow the
     * existing behaviour and allow scanning another barcode. */
    setResultMessage(outcome?.message || "Product not recognised — try another barcode.");
    setStatus("paused");
    resumeTimerRef.current = setTimeout(() => {
      if (unmountedRef.current) return;
      shouldProcessRef.current = createBarcodeDebounce(CAMERA_SCAN_DEBOUNCE_MS);
      startScanning();
    }, RESUME_DELAY_MS);
  };

  const startScanning = useCallback(async () => {
    if (unmountedRef.current) return;
    setStatus("starting");
    setMessage("");
    try {
      /* Lazy-load so the decoder ships in its own chunk, off the critical path. */
      const ZX = await import("@zxing/library");
      if (unmountedRef.current || !videoRef.current) return;
      const { DecodeHintType, BarcodeFormat, BrowserMultiFormatReader } = ZX;
      /* Only formats actually supported by this library are requested. */
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
      pausedRef.current = false;

      await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } }, /* rear camera preferred */
        videoRef.current,
        (result) => {
          if (!result || pausedRef.current || unmountedRef.current) return;
          const code = result.getText();
          /* Same barcode inside the debounce window is ignored; different
           * barcodes always pass through. */
          if (!shouldProcessRef.current(code)) return;
          pausedRef.current = true;
          releaseCamera();
          setStatus("paused");
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
  }, [releaseCamera]);

  useEffect(() => {
    startScanning();
    return () => {
      unmountedRef.current = true;
      releaseCamera();
    };
  }, [startScanning]);

  const handleClose = () => {
    releaseCamera();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900 flex flex-col"
      role="dialog"
      aria-label="Camera barcode scanner"
      data-testid="scan-go-camera-scanner"
    >
      <header className="flex items-center justify-between px-4 py-3 shrink-0">
        <div>
          <h2 className="text-white font-semibold text-sm">Scan with Camera</h2>
          <p className="text-teal-200 text-xs">Point a barcode inside the box below</p>
        </div>
        <button
          onClick={handleClose}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white"
          aria-label="Close Scanner"
          data-testid="scan-go-camera-close"
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
        {/* Scanning target box */}
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-36 border-4 border-white/90 rounded-2xl pointer-events-none"
          style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" }}
        />
        <div className="absolute left-1/2 -translate-x-1/2 bottom-4 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full pointer-events-none">
          {status === "starting" ? "Starting camera…" : "Point the barcode inside the box"}
        </div>
      </div>

      <footer className="p-4 shrink-0 space-y-3">
        {status === "paused" && !resultMessage && (
          <p className="text-center text-teal-200 text-sm" data-testid="scan-go-camera-paused">Processing…</p>
        )}
        {resultMessage && (
          <p
            className={`text-center text-sm rounded-lg p-2 border ${
              resultMessage.startsWith("Added")
                ? "bg-emerald-900/60 border-emerald-500/50 text-emerald-200"
                : "bg-amber-900/60 border-amber-500/50 text-amber-200"
            }`}
            data-testid="scan-go-camera-result"
          >
            {resultMessage}
          </p>
        )}
        {status === "error" && (
          <p
            className="text-center text-sm bg-red-900/60 border border-red-500/50 text-red-200 rounded-lg p-3"
            role="alert"
            data-testid="scan-go-camera-error"
          >
            {message}
          </p>
        )}
        <button
          onClick={handleClose}
          className="w-full h-12 bg-white text-slate-900 rounded-lg text-sm font-semibold hover:bg-slate-100"
          data-testid="scan-go-camera-close-button"
        >
          Close Scanner
        </button>
      </footer>
    </div>
  );
}

