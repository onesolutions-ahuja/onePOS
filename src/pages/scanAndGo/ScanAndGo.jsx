import { useEffect, useRef, useState } from "react";
import { Camera, Minus, Plus, ScanLine, ShoppingCart, Trash2, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import CameraScanner from "./CameraScanner.jsx"; /* T10P-CAMERA */


/*
 * T10P — Scan & Go customer screen (phone-sized, read-mostly).
 *
 * Workflow: Start Scan & Go -> scan/type barcode -> product card -> basket
 * with quantity controls -> running subtotal/VAT/total -> checkout -> sale.
 *
 * The session token (issued by POST /api/scan-go/session) is an HMAC-signed
 * server-side session reference — the browser never supplies company/store/
 * session ids, so editing values in the UI cannot reach another tenant's
 * basket. Totals shown are the authoritative ones returned by the server;
 * the UI never recalculates pricing itself.
 */

const SESSION_STORAGE_KEY = "onepos_scan_go_session";

function formatMoney(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

export default function ScanAndGo({ onExit }) {
  const [sessionToken, setSessionToken] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  const [storeName, setStoreName] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_STORAGE_KEY + ":store") || "";
    } catch {
      return "";
    }
  });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const [basket, setBasket] = useState({ lines: [], subtotal: 0, vat: 0, total: 0 });
  const [scanInput, setScanInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // { ok, name?, message? }
  const [busyItem, setBusyItem] = useState("");
  const [checkingOut, setCheckingOut] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false); /* T10P-CAMERA */
  const scanRef = useRef(null);


  const authHeaders = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};

  const loadBasket = async (token = sessionToken) => {
    if (!token) return;
    try {
      const data = await apiRequest("/api/scan-go/basket", { headers: { Authorization: `Bearer ${token}` } });
      if (data.success) setBasket(data.data.basket || { lines: [], subtotal: 0, vat: 0, total: 0 });
    } catch {
      /* transient - the basket reloads on the next action */
    }
  };

  const startSession = async () => {
    if (starting) return;
    setStarting(true);
    setStartError("");
    try {
      const data = await apiRequest("/api/scan-go/session", { method: "POST", body: JSON.stringify({}) });
      if (!data.success || !data.data?.sessionToken) throw new Error(data.message || "Unable to start Scan & Go");
      const token = data.data.sessionToken;
      setSessionToken(token);
      setStoreName(data.data.session?.storeName || "");
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, token);
        sessionStorage.setItem(SESSION_STORAGE_KEY + ":store", data.data.session?.storeName || "");
      } catch { /* private mode */ }
      await loadBasket(token);
    } catch (err) {
      setStartError(err.message || "Unable to start Scan & Go");
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (sessionToken) loadBasket();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  const scan = async (rawCode) => {
    const code = String(rawCode || "").trim();
    if (!code || scanning) return;
    setScanning(true);
    setScanResult(null);
    setError("");
    try {
      const lookup = await apiRequest(`/api/scan-go/product/${encodeURIComponent(code)}`, { headers: authHeaders });
      if (!lookup.success) {
        setScanResult({ ok: false, message: lookup.message || `Unknown barcode: ${code}` });
        return { ok: false, message: lookup.message || `Unknown barcode: ${code}` };
      }
      const add = await apiRequest("/api/scan-go/items", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ productId: lookup.data.productId, quantity: 1 }),
      });
      if (!add.success) {
        setScanResult({ ok: false, message: add.message || "Unable to add product" });
        if (add.data?.basket) setBasket(add.data.basket);
        return { ok: false, message: add.message || "Unable to add product" };
      }
      setBasket(add.data.basket);
      setScanResult({ ok: true, name: lookup.data.name, price: lookup.data.price });
      return { ok: true };
    } catch (err) {
      setScanResult({ ok: false, message: err.message || "Scan failed" });
      return { ok: false, message: err.message || "Scan failed" };
    } finally {
      setScanning(false);
      setScanInput("");
      scanRef.current?.focus();
    }
  };

  const changeQuantity = async (item, delta) => {
    const next = item.quantity + delta;
    setBusyItem(item.id);
    setError("");
    try {
      const data = await apiRequest(`/api/scan-go/items/${item.id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ quantity: next }),
      });
      if (!data.success) setError(data.message || "Unable to update quantity");
      if (data.data?.basket) setBasket(data.data.basket);
    } catch (err) {
      setError(err.message || "Unable to update quantity");
    } finally {
      setBusyItem("");
    }
  };

  const removeItem = async (item) => {
    setBusyItem(item.id);
    setError("");
    try {
      const data = await apiRequest(`/api/scan-go/items/${item.id}`, { method: "DELETE", headers: authHeaders });
      if (!data.success) setError(data.message || "Unable to remove item");
      if (data.data?.basket) setBasket(data.data.basket);
    } catch (err) {
      setError(err.message || "Unable to remove item");
    } finally {
      setBusyItem("");
    }
  };

  const checkout = async () => {
    if (checkingOut) return;
    setCheckingOut(true);
    setError("");
    try {
      const data = await apiRequest("/api/scan-go/checkout", { method: "POST", headers: authHeaders, body: JSON.stringify({}) });
      if (!data.success) throw new Error(data.message || "Checkout failed");
      setReceipt(data.data);
      setBasket({ lines: [], subtotal: 0, vat: 0, total: 0 });
      setCameraOpen(false); /* T10P-CAMERA: release camera when session ends */

      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        sessionStorage.removeItem(SESSION_STORAGE_KEY + ":store");
      } catch { /* private mode */ }
      setSessionToken(null);
      setStoreName("");
    } catch (err) {
      setError(err.message || "Checkout failed");
    } finally {
      setCheckingOut(false);
    }
  };

  /* ----------------------------- start screen ----------------------------- */

  if (!sessionToken) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm w-full max-w-sm p-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-teal-600 text-white flex items-center justify-center mb-4">
            <ScanLine size={26} />
          </div>
          <h1 className="text-lg font-semibold text-slate-800">Scan &amp; Go</h1>
          <p className="text-sm text-slate-500 mt-2">
            Scan products with your phone as you shop, then check out in seconds.
            {storeName ? ` Store: ${storeName}.` : ""}
          </p>
          {startError && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{startError}</p>}
          <button
            onClick={startSession}
            disabled={starting}
            className="mt-5 w-full h-11 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start Scan & Go"}
          </button>
          {onExit && (
            <button onClick={onExit} className="mt-3 text-xs text-slate-400 hover:text-slate-600">
              Back to app
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ------------------------------ success state ---------------------------- */

  if (receipt) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm w-full max-w-sm p-6 text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4 text-2xl">✓</div>
          <h1 className="text-lg font-semibold text-slate-800">Thank you!</h1>
          <p className="text-sm text-slate-500 mt-1">Your Scan &amp; Go purchase is complete.</p>
          <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm text-left">
            <div className="flex justify-between py-1 text-slate-600"><span>Receipt</span><span className="font-mono text-xs">{receipt.receiptNumber}</span></div>
            <div className="flex justify-between py-1 text-slate-600"><span>Subtotal</span><span>{formatMoney(receipt.subtotal)}</span></div>
            <div className="flex justify-between py-1 text-slate-600"><span>VAT</span><span>{formatMoney(receipt.vat)}</span></div>
            <div className="flex justify-between py-1 font-semibold text-slate-800 border-t border-slate-200 mt-1 pt-2"><span>Total</span><span>{formatMoney(receipt.total)}</span></div>
          </div>
          <button
            onClick={() => { setReceipt(null); }}
            className="mt-5 w-full h-11 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700"
          >
            Start a new Scan &amp; Go
          </button>
        </div>
      </div>
    );
  }

  /* -------------------------------- scanner UI ------------------------------ */

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      <header className="bg-teal-600 text-white px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="font-semibold text-sm">Scan &amp; Go</h1>
          {storeName && <p className="text-xs text-teal-100">{storeName}</p>}
        </div>
        <button
          onClick={async () => {
            try { await apiRequest("/api/scan-go/session", { method: "DELETE", headers: authHeaders }); } catch { /* discard anyway */ }
            try {
              sessionStorage.removeItem(SESSION_STORAGE_KEY);
              sessionStorage.removeItem(SESSION_STORAGE_KEY + ":store");
            } catch { /* private mode */ }
            setSessionToken(null);
            setStoreName("");
            setCameraOpen(false); /* T10P-CAMERA: release camera when session ends */
          }}
          className="p-2 rounded-lg hover:bg-teal-700"
          aria-label="End session"
        >
          <X size={18} />
        </button>
      </header>

      <div className="p-3 shrink-0">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <ScanLine size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={scanRef}
              value={scanInput}
              onChange={(event) => setScanInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") scan(scanInput); }}
              placeholder="Scan or type a barcode"
              inputMode="numeric"
              autoFocus
              className="w-full h-11 pl-9 pr-3 border border-slate-200 rounded-lg text-sm bg-white"
            />
          </div>
          <button
            onClick={() => scan(scanInput)}
            disabled={scanning || !scanInput.trim()}
            className="h-11 px-4 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
          >
            {scanning ? "…" : "Add"}
          </button>
          <button
            onClick={() => setCameraOpen(true)}
            disabled={scanning}
            className="onepos-btn onepos-btn-primary flex items-center gap-1.5"
            aria-label="Scan with Camera"
            data-testid="scan-go-camera-open"
          >
            <Camera size={16} />
            Scan with Camera
          </button>
        </div>
        {cameraOpen && (
          <CameraScanner
            onClose={() => setCameraOpen(false)}
            onDetected={scan}
          />
        )}

        {scanResult && (
          <div className={`mt-2 text-xs rounded-lg p-2 border ${scanResult.ok ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
            {scanResult.ok ? `${scanResult.name} added — ${formatMoney(scanResult.price)}` : scanResult.message}
          </div>
        )}
        {error && <div className="mt-2 text-xs rounded-lg p-2 border bg-red-50 border-red-200 text-red-700">{error}</div>}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-40">
        {basket.lines.length === 0 ? (
          <div className="mt-10 text-center text-slate-400">
            <ShoppingCart size={32} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">Basket is empty — scan your first product.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {basket.lines.map((item) => (
              <li key={item.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="w-11 h-11 rounded-lg object-cover border border-slate-100" />
                ) : (
                  <div className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                    <ShoppingCart size={16} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{item.name}</p>
                  <p className="text-xs text-slate-500">{formatMoney(item.unitPrice)} each · {item.vatRate > 0 ? `VAT ${item.vatRate}%` : "No VAT"}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => changeQuantity(item, -1)}
                    disabled={busyItem === item.id}
                    className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    aria-label={`Decrease ${item.name}`}
                  >
                    <Minus size={14} />
                  </button>
                  <span className="w-8 text-center text-sm font-semibold text-slate-800" data-testid="scan-go-qty">{item.quantity}</span>
                  <button
                    onClick={() => changeQuantity(item, 1)}
                    disabled={busyItem === item.id}
                    className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    aria-label={`Increase ${item.name}`}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="text-right shrink-0 w-16">
                  <p className="text-sm font-semibold text-slate-800">{formatMoney(item.total)}</p>
                  <button
                    onClick={() => removeItem(item)}
                    disabled={busyItem === item.id}
                    className="text-xs text-red-400 hover:text-red-600 mt-0.5 inline-flex items-center gap-1"
                  >
                    <Trash2 size={11} /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-3 shadow-[0_-2px_10px_rgba(0,0,0,0.04)]">
        <div className="max-w-sm mx-auto w-full">
          <div className="flex justify-between text-xs text-slate-500 py-0.5"><span>Subtotal</span><span>{formatMoney(basket.subtotal)}</span></div>
          <div className="flex justify-between text-xs text-slate-500 py-0.5"><span>VAT</span><span>{formatMoney(basket.vat)}</span></div>
          <div className="flex justify-between text-sm font-semibold text-slate-800 py-1"><span>Total</span><span>{formatMoney(basket.total)}</span></div>
          <button
            onClick={checkout}
            disabled={checkingOut || basket.lines.length === 0}
            className="mt-1 w-full h-11 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
          >
            {checkingOut ? "Checking out…" : "Checkout"}
          </button>
        </div>
      </footer>
    </div>
  );
}
