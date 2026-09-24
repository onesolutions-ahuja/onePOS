import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, Minus, Plus, RotateCcw, ScanLine, Search, Trash2, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { isNetworkError } from "../../services/networkStatus.js";
import { normaliseProduct } from "../../utils/formatters.js";
import { computeBasketTotals, lineTaxFor } from "../../utils/saleTotals.js";

/*
 * T10D — Self-Checkout mode screen.
 *
 * A deliberately restricted, card-only till view for customer operation:
 * search/scan, basket, quantities, the SHARED sale-total/VAT engine
 * (computeBasketTotals — the same single calculation the staff POS uses),
 * the T10C age-verification gate, and one large "Pay by Card" action.
 *
 * NOT available here (enforced by the server-side mode gate as well):
 * admin, reports, products/customers admin, purchases, inventory, settings,
 * integrations, user management — and cash payment.
 *
 * Sales go through the EXISTING POST /api/sale engine (same sale/inventory/
 * VAT/receipt-numbering/invoice-delivery mechanisms as the staff till).
 * Card payment uses the existing payment contract (paymentMethod "card").
 * Offline selling is intentionally NOT supported in this mode.
 */

function SelfCheckout({ modeToken, storeName, onExit }) {
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState("");

  const [search, setSearch] = useState("");
  const [basket, setBasket] = useState([]);
  const [saleError, setSaleError] = useState("");
  const [notice, setNotice] = useState("");

  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatRate, setVatRate] = useState(0.2);

  const [basketHasAgeRestricted, setBasketHasAgeRestricted] = useState(false);
  const [ageVerifiedThisSale, setAgeVerifiedThisSale] = useState(false);
  const [showAgeModal, setShowAgeModal] = useState(false);

  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const searchRef = useRef(null);

  /* Customer identification: guest by default; the customer may attach
   * their account by entering their own phone/email (company-scoped exact
   * match via the restricted lookup endpoint). No other customer data is
   * shown or editable. */
  const [identifiedCustomer, setIdentifiedCustomer] = useState(null); /* {id, name} | null */
  const [idQuery, setIdQuery] = useState("");
  const [idBusy, setIdBusy] = useState(false);
  const [idError, setIdError] = useState("");
  const [showIdPanel, setShowIdPanel] = useState(false);

  const lookupCustomer = async () => {
    const query = idQuery.trim();
    if (!query || idBusy) return;
    setIdBusy(true);
    setIdError("");
    try {
      const data = await apiRequest("/api/self-checkout/customer-lookup", {
        signal: AbortSignal.timeout(10000),
        method: "POST",
        headers: { Authorization: `Bearer ${modeToken}` },
        body: JSON.stringify({ query }),
      });
      if (!data.success || !data.found) {
        setIdError(data.message || "We could not find that account — you can continue as a guest");
        return;
      }
      setIdentifiedCustomer(data.data);
      setShowIdPanel(false);
      setIdQuery("");
    } catch (error) {
      setIdError(error.message || "Lookup failed — you can continue as a guest");
    } finally {
      setIdBusy(false);
    }
  };

  const continueAsGuest = () => {
    setIdentifiedCustomer(null);
    setShowIdPanel(false);
    setIdQuery("");
    setIdError("");
  };

  /* ------------------------------------------------ data loading (read-only APIs) */

  useEffect(() => {
    const load = async () => {
      try {
        setLoadingProducts(true);
        setProductError("");
        const data = await apiRequest("/api/products", { signal: AbortSignal.timeout(10000) });
        if (!data.success) throw new Error(data.message || "Unable to load products");
        setProducts((Array.isArray(data.data) ? data.data : []).map(normaliseProduct));
      } catch (error) {
        setProductError(error.message || "Unable to load products");
      } finally {
        setLoadingProducts(false);
      }
    };
    const loadSettings = async () => {
      try {
        const data = await apiRequest("/api/settings", { signal: AbortSignal.timeout(10000) });
        if (data.success && data.data?.tax) {
          setVatEnabled(data.data.tax.vatEnabled !== false);
          setVatRate(Number(data.data.tax.defaultVatRate || 0) / 100);
        }
      } catch { /* defaults keep VAT calculation working. */ }
    };
    load();
    loadSettings();
  }, []);

  /* ------------------------------------------------ basket (same rules as POS) */

  const add = (product) => {
    if (paying) return;
    const stockLimit = product.trackStock !== false ? Number(product.stock ?? product.stock_quantity ?? 0) : null;
    const existingQty = basket.reduce((total, item) => (item.id === product.id ? total + item.quantity : total), 0);
    if (stockLimit !== null && existingQty >= stockLimit) {
      setSaleError(`Only ${stockLimit} left in stock for ${product.name}.`);
      return;
    }
    setSaleError("");
    setBasket((current) => {
      const found = current.find((item) => item.id === product.id);
      if (found) {
        return current.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...current, { ...product, quantity: 1 }];
    });
    setSearch("");
    if (searchRef.current) searchRef.current.focus();
  };

  const decrease = (id) =>
    setBasket((current) => current.map((item) => (item.id === id ? { ...item, quantity: item.quantity - 1 } : item)).filter((item) => item.quantity > 0));

  const updateQuantity = (id, value) => {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity < 1) return;
    const item = basket.find((entry) => entry.id === id);
    if (!item) return;
    const stockLimit = item.trackStock !== false ? Number(item.stock ?? 0) : null;
    if (stockLimit !== null && quantity > stockLimit) {
      setSaleError(`Only ${stockLimit} left in stock for ${item.name}.`);
      return;
    }
    setSaleError("");
    setBasket((current) => current.map((entry) => (entry.id === id ? { ...entry, quantity: Math.floor(quantity) } : entry)));
  };

  const removeItem = (id) => setBasket((current) => current.filter((item) => item.id !== id));

  const clearBasket = () => {
    setBasket([]);
    setSaleError("");
    setNotice("Basket cleared.");
    if (searchRef.current) searchRef.current.focus();
  };

  /* Totals: the SHARED engine (identical to staff POS; no customer discounts). */
  const { subtotal, vat, total } = useMemo(
    () => computeBasketTotals(basket, { vatEnabled, vatRate, discountType: null, discountValue: 0 }),
    [basket, vatEnabled, vatRate]
  );

  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim();
    const base = products.filter((product) => product.active);
    if (!query) return base.slice(0, 24);
    return base
      .filter(
        (product) =>
          product.name.toLowerCase().includes(query) ||
          product.sku?.toLowerCase().includes(query) ||
          product.barcode?.includes(query)
      )
      .slice(0, 24);
  }, [products, search]);

  const onSearchKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = search.trim();
    if (!code) return;
    const exact = products.find((product) => product.barcode && product.barcode === code && product.active);
    if (exact) add(exact);
    else if (filtered.length === 1) add(filtered[0]);
    else setSaleError(`No product matches "${code}". Ask a member of staff for help.`);
  };

  /* ------------------------------------------------ T10C age verification */

  useEffect(() => {
    const hasRestricted = basket.some((item) => item.ageRestricted === true);
    setBasketHasAgeRestricted(hasRestricted);
    if (!hasRestricted) setAgeVerifiedThisSale(false);
  }, [basket]);

  /* ------------------------------------------------ card-only checkout */

  const payByCard = async () => {
    if (paying || !basket.length) return;
    if (basketHasAgeRestricted && !ageVerifiedThisSale) {
      setShowAgeModal(true);
      return;
    }
    setPaying(true);
    setSaleError("");
    setNotice("");
    const payload = {
      clientRequestId: crypto.randomUUID(),
      items: basket.map((item) => {
        const lineGross = Number(item.price || 0) * item.quantity;
        const lineTax = lineTaxFor(item, { vatEnabled, vatRate });
        return {
          productId: item.id,
          quantity: item.quantity,
          unitPrice: item.price,
          tax: lineTax,
          discount: 0,
          total: lineGross + lineTax,
        };
      }),
      customerId: identifiedCustomer?.id || null,
      subtotal,
      tax: vat,
      discount: 0,
      total,
      paymentMethod: "card", // CARD ONLY — the backend also rejects cash for this mode.
    };
    try {
      const data = await apiRequest("/api/sales", {
        signal: AbortSignal.timeout(20000),
        method: "POST",
        headers: { Authorization: `Bearer ${modeToken}` },
        body: JSON.stringify(payload),
      });
      if (!data.success || !data.sale?.id) throw new Error("Payment could not be confirmed");
      setReceipt({ receiptNumber: data.sale.receipt_number || null, total });
      setBasket([]);
      setAgeVerifiedThisSale(false);
      setIdentifiedCustomer(null); /* next customer starts fresh */
    } catch (error) {
      if (isNetworkError(error)) {
        setSaleError("The card payment could not be completed — the connection to the till server was lost. Your basket is kept; please try again or ask a member of staff.");
      } else if (error.status === 403 && /Age verification/.test(error.message || "")) {
        setSaleError("Age verification is required for this product.");
        setAgeVerifiedThisSale(false);
      } else {
        setSaleError(error.message || "The card payment was declined. Your basket is kept — please try again.");
      }
    } finally {
      setPaying(false);
    }
  };

  /* ------------------------------------------------ render */

  if (receipt) {
    return (
      <div className="h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-[440px] max-w-full p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-2xl font-bold">✓</div>
          <h1 className="text-xl font-bold mt-4">Thank you for your purchase</h1>
          {receipt.receiptNumber && (
            <p className="text-sm text-slate-500 mt-1">Receipt {receipt.receiptNumber}</p>
          )}
          <p className="text-3xl font-bold mt-4">£{receipt.total.toFixed(2)}</p>
          <p className="text-xs text-slate-400 mt-2">Paid by card. A VAT receipt can be emailed to you by a member of staff.</p>
          <button
            onClick={() => { setReceipt(null); setNotice(""); setIdentifiedCustomer(null); if (searchRef.current) searchRef.current.focus(); }}
            className="mt-6 h-12 px-6 bg-blue-600 text-white rounded-lg text-base font-medium hover:bg-blue-700"
            autoFocus
          >
            Start new basket
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-100 flex flex-col overflow-hidden">
      <header className="h-[58px] text-white flex items-center justify-between px-4 shrink-0" style={{ background: "linear-gradient(90deg, #104744 0%, #176F6A 100%)" }}>
        <div className="flex items-center gap-3">
          <div className="font-bold text-lg">onePOS</div>
          <div className="h-7 w-px bg-slate-700" />
          <div className="text-sm">Self-Checkout{storeName ? ` — ${storeName}` : ""}</div>
        </div>
        <div className="flex items-center gap-4">
          {/* Customer identification: guest by default, optional sign-in */}
          {identifiedCustomer ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-emerald-200">Hi, {identifiedCustomer.name.split(" ")[0]}</span>
              <button
                onClick={continueAsGuest}
                className="text-sm underline underline-offset-2 hover:text-slate-200"
              >
                Continue as guest
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setShowIdPanel((v) => !v); setIdError(""); }}
              className="text-sm underline underline-offset-2 hover:text-slate-200"
            >
              {showIdPanel ? "Close sign-in" : "Sign in (optional)"}
            </button>
          )}
          <button onClick={onExit} className="text-sm underline underline-offset-2 hover:text-slate-200">
            Staff exit
          </button>
        </div>
      </header>

      {/* Optional customer sign-in panel — the customer enters their OWN
          phone/email; only an exact company match attaches to the sale. */}
      {showIdPanel && !identifiedCustomer && (
        <div className="bg-white border-b border-slate-200 px-4 py-3">
          <div className="max-w-xl mx-auto">
            <div className="text-sm font-medium text-slate-700 mb-2">
              Add your details to earn points and keep your receipt — or continue as a guest.
            </div>
            <div className="flex gap-2">
              <input
                value={idQuery}
                onChange={(event) => setIdQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") lookupCustomer(); }}
                placeholder="Phone number or email"
                autoFocus
                className="flex-1 h-12 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-600 text-base"
              />
              <button
                onClick={lookupCustomer}
                disabled={idBusy || !idQuery.trim()}
                className="h-12 px-5 bg-teal-700 text-white rounded-lg font-medium hover:bg-teal-800 disabled:opacity-50"
              >
                {idBusy ? "Checking…" : "Sign in"}
              </button>
              <button
                onClick={continueAsGuest}
                className="h-12 px-5 border rounded-lg text-slate-600 hover:bg-slate-50"
              >
                Continue as guest
              </button>
            </div>
            {idError ? (
              <div role="alert" className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                {idError}
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0 p-3 gap-3">
        <div className="flex-1 flex flex-col min-w-0">
          <label className="text-sm font-medium text-slate-600 mb-1 flex items-center gap-2">
            <ScanLine size={16} className="text-slate-400" />
            Scan a barcode or search products
          </label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => { setSearch(event.target.value); setSaleError(""); setNotice(""); }}
              onKeyDown={onSearchKeyDown}
              autoFocus
              autoComplete="off"
              placeholder="Scan barcode or type a product name, then press Enter"
              className="w-full h-12 pl-9 pr-3 border border-slate-200 rounded-lg text-base outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>

          {loadingProducts ? (
            <div className="text-sm text-slate-400 mt-6">Loading products…</div>
          ) : productError ? (
            <div className="mt-6 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{productError}</div>
          ) : (
            <div className="grid grid-cols-3 xl:grid-cols-4 gap-2 mt-3 overflow-y-auto pr-1 content-start">
              {filtered.map((product) => (
                <button
                  key={product.id}
                  onClick={() => add(product)}
                  className="bg-white border border-slate-200 rounded-lg p-3 text-left hover:border-blue-500 hover:bg-blue-50 min-h-[64px] flex flex-col justify-between"
                >
                  <span className="text-sm font-medium text-slate-800 line-clamp-2">{product.name}</span>
                  <span className="text-sm font-bold text-slate-900">£{Number(product.price || 0).toFixed(2)}</span>
                </button>
              ))}
              {!filtered.length && (
                <div className="col-span-full text-sm text-slate-400 py-6 text-center">No matching products.</div>
              )}
            </div>
          )}
        </div>

        <div className="w-[380px] shrink-0 bg-white border border-slate-200 rounded-xl flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-bold">Your basket</h2>
            <button onClick={clearBasket} disabled={!basket.length || paying} className="flex items-center gap-1 text-sm text-slate-500 hover:text-red-600 disabled:opacity-40">
              <RotateCcw size={14} /> Clear
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            {!basket.length && <p className="text-sm text-slate-400 text-center py-8">Scan or tap a product to begin.</p>}
            {basket.map((item) => (
              <div key={item.id} className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800 truncate">{item.name}</div>
                  <div className="text-xs text-slate-500">£{Number(item.price || 0).toFixed(2)} each</div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => decrease(item.id)} disabled={paying} className="w-8 h-8 border border-slate-200 rounded flex items-center justify-center hover:bg-slate-50 disabled:opacity-40" aria-label={`Reduce ${item.name}`}>
                    <Minus size={14} />
                  </button>
                  <input
                    value={item.quantity}
                    onChange={(event) => updateQuantity(item.id, event.target.value)}
                    disabled={paying}
                    inputMode="numeric"
                    className="w-12 h-8 border border-slate-200 rounded text-center text-sm"
                    aria-label={`Quantity of ${item.name}`}
                  />
                  <button onClick={() => add(item)} disabled={paying} className="w-8 h-8 border border-slate-200 rounded flex items-center justify-center hover:bg-slate-50 disabled:opacity-40" aria-label={`Add another ${item.name}`}>
                    <Plus size={14} />
                  </button>
                </div>
                <div className="w-16 text-right text-sm font-semibold">£{(Number(item.price || 0) * item.quantity).toFixed(2)}</div>
                <button onClick={() => removeItem(item.id)} disabled={paying} className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-40" aria-label={`Remove ${item.name}`}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 px-4 py-3">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Subtotal</span><span>£{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>VAT</span><span>£{vat.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xl font-bold mt-1">
              <span>Total</span><span>£{total.toFixed(2)}</span>
            </div>

            {saleError && (
              <div role="alert" className="mt-2 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
                <span className="flex items-start gap-2"><X size={14} className="mt-0.5 shrink-0" />{saleError}</span>
              </div>
            )}
            {notice && !saleError && (
              <div role="status" className="mt-2 px-3 py-2 bg-slate-50 border border-slate-200 text-slate-600 rounded text-sm">{notice}</div>
            )}

            <button
              onClick={payByCard}
              disabled={!basket.length || paying}
              className="mt-3 w-full h-14 bg-blue-600 text-white rounded-lg text-lg font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <CreditCard size={22} />
              {paying ? "Processing payment…" : `Pay by Card — £${total.toFixed(2)}`}
            </button>
            <p className="text-[11px] text-slate-400 text-center mt-1.5">Card payments only. Ask a member of staff for help at any time.</p>
          </div>
        </div>
      </div>

      {showAgeModal && (
        <AgeVerificationModal
          productNames={basket.filter((item) => item.ageRestricted === true).map((item) => item.name)}
          onConfirm={() => { setAgeVerifiedThisSale(true); setShowAgeModal(false); payByCard(); }}
          onCancel={() => setShowAgeModal(false)}
        />
      )}
    </div>
  );
}

/* Same T10C operator/customer confirmation, no personal data captured. */
function AgeVerificationModal({ productNames, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="sco-age-verify-title">
      <div className="bg-white rounded-xl w-[380px] max-w-full p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold">18+</div>
          <div className="min-w-0">
            <h2 id="sco-age-verify-title" className="font-bold text-lg">Age Verification Required</h2>
            <p className="text-sm text-slate-600 mt-1">
              This basket contains age-restricted product{productNames.length > 1 ? "s" : ""}. Please wait for a member of staff to check the customer's age.
            </p>
            <p className="text-sm font-medium text-slate-800 mt-1 truncate" title={productNames.join(", ")}>
              {productNames.slice(0, 3).join(", ")}{productNames.length > 3 ? "…" : ""}
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-700 mt-4">Staff confirmation: the customer appears to be 18 or over?</p>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="h-10 px-4 border border-slate-200 rounded-lg text-sm hover:bg-slate-50" autoFocus>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default SelfCheckout;
