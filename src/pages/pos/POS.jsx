import { useEffect, useRef, useState } from "react";
import { Percent, ShoppingBag, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { isNetworkError, onNetworkChange } from "../../services/networkStatus.js";
import {
  getTenantFromToken,
  loadProductCache,
  loadSettingsCache,
  saveProductCache,
  saveSettingsCache,
  saveTillContext,
  clearTillContext,
  saveTerminalIdentity,
  loadTerminalIdentity,
} from "../../services/offlineStore.js";
import {
  newClientRequestId,
  enqueueOfflineSale,
  syncOfflineQueue,
  getQueueSnapshot,
  subscribeQueue,
} from "../../services/offlineQueue.js";
import { normaliseProduct } from "../../utils/formatters.js";
import BottomStatusBar from "../../components/BottomStatusBar.jsx";
import TillSessionModal from "./TillSessionModal.jsx";
import POSHeader from "./POSHeader.jsx";
import CartPanel from "./CartPanel.jsx";
import ProductGrid from "./ProductGrid.jsx";
import PaymentModal from "./PaymentModal.jsx";
import CustomerSelectorModal from "./CustomerSelectorModal.jsx";
/* =========================================================
   POS / TILL
========================================================= */

function POS({ onAdmin, onOpenOnlineOrders, onLogout }) {
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [basket, setBasket] = useState([]);
  const [showPayment, setShowPayment] = useState(false);
  const [showCustomerSelector, setShowCustomerSelector] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [saleError, setSaleError] = useState("");
  const [saleMessage, setSaleMessage] = useState("");
  const [discountType, setDiscountType] = useState(null);
  const [discountValue, setDiscountValue] = useState(0);
  const [showDiscount, setShowDiscount] = useState(false);
  const [heldSales, setHeldSales] = useState([]);
  const [showHeldSales, setShowHeldSales] = useState(false);
  const [till, setTill] = useState(null);
  const [showTill, setShowTill] = useState(false);
  const [loadingTill, setLoadingTill] = useState(true);
  const [storeName, setStoreName] = useState("");

  /*
   * Non-blocking online-order notification state. Polled; when the real Uber
   * webhook lands it can call notifyNewOnlineOrder() directly - the till is
   * never blocked and the current sale is never interrupted.
   */
  const [onlineOrderCount, setOnlineOrderCount] = useState(0);
  const [onlineOrderToast, setOnlineOrderToast] = useState(null);

  const loadOnlineOrderCount = async () => {
    try {
      const data = await apiRequest("/api/online/orders?status=RECEIVED&limit=50");
      if (data.success) {
        const next = Array.isArray(data.data) ? data.data.length : 0;
        setOnlineOrderCount((previous) => {
          if (next > previous) {
            setOnlineOrderToast({ message: "New Uber Eats Order" });
          }
          return next;
        });
      }
    } catch (error) {
      console.error("Load online order count error:", error);
    }
  };

  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState("");
  /* T8B: set when cached products/settings are in use (transport failure only). */
  const [offlineNotice, setOfflineNotice] = useState("");
  /* T8C-F: offline sale queue state. */
  const [offlineCount, setOfflineCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatRate, setVatRate] = useState(0.2);

  const loadCurrentTill = async () => {
    setLoadingTill(true);
    try {
      const data = await apiRequest("/api/till/sessions/current");
      if (!data.success) throw new Error(data.message || "Unable to load till");
      setTill(data.data || null);

      /*
       * T8B: remember the server-confirmed open till (context only) and the
       * terminal/store/company identity. On network errors the previous
       * till state is left untouched (below) - the server-side open-till
       * requirement is NOT bypassed.
       */
      const tenant = getTenantFromToken();
      if (tenant) {
        if (data.data && data.data.status === "open") {
          /*
           * T8E: one identity object, merged with any previously stored
           * terminal_number so the offline provisional-receipt prefix stays
           * stable across sessions (server payloads have not always
           * included the number).
           */
          const identity = {
            terminalId: data.data.terminal_id,
            terminalName: data.data.terminal_name || null,
            terminalNumber: data.data.terminal_number || null,
            storeId: tenant.storeId,
            companyId: tenant.companyId,
          };
          saveTillContext(tenant, {
            sessionId: data.data.id,
            ...identity,
            userId: data.data.user_id || tenant.userId,
            openedAt: data.data.opened_at,
          });
          const previous = loadTerminalIdentity(tenant);
          saveTerminalIdentity(tenant, {
            ...identity,
            terminalNumber:
              identity.terminalNumber ||
              previous?.terminalNumber ||
              loadSettingsCache(tenant)?.till?.terminalNumber ||
              null,
          });
        } else {
          clearTillContext(tenant);
        }
      }
    } catch (error) {
      const message = error.message || "";
      if (message.includes("No open till session") || message.includes("401") || message.includes("403")) {
        setTill(null);
      }
      // Any other error leaves the previous till value untouched.
    } finally {
      setLoadingTill(false);
    }
  };

  const loadProducts = async () => {
    try {
      setLoadingProducts(true);
      setProductError("");

      const data = await apiRequest(
        "/api/products"
      );

      if (!data.success) {
        throw new Error(
          data.message ||
            "Unable to load products"
        );
      }

      const databaseProducts = Array.isArray(
        data.data
      )
        ? data.data.map(normaliseProduct)
        : [];

      setProducts(databaseProducts);

      /* T8B: keep the freshest product list available for offline selling. */
      const tenant = getTenantFromToken();
      if (tenant) saveProductCache(tenant, databaseProducts);
      setOfflineNotice("");
    } catch (error) {
      console.error(
        "onePOS product loading error:",
        error
      );

      /*
       * T8B: only a transport failure (request never reached the server)
       * may fall back to the cached product list. Server answers such as
       * 401/403/400/500 must surface as real errors - never silently
       * become cached data.
       */
      if (isNetworkError(error)) {
        const tenant = getTenantFromToken();
        const cached = tenant ? loadProductCache(tenant) : null;
        if (cached && cached.length) {
          setProducts(cached);
          setProductError("");
          setOfflineNotice(
            "Offline — showing saved products. Selling resumes when the connection returns."
          );
          return;
        }
      }

      setProductError(
        error.message ||
          "Unable to load products"
      );
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    loadProducts();
    loadCurrentTill();
    loadOnlineOrderCount();

    apiRequest("/api/settings")
      .then((data) => {
        if (data.success && data.data?.tax) {
          setVatEnabled(data.data.tax.vatEnabled !== false);
          setVatRate(Number(data.data.tax.defaultVatRate || 0) / 100);
        }
        if (data.success && data.data?.store) {
          setStoreName(data.data.store.name);
        }
        /* T8B: cache the settings payload for offline reuse. */
        if (data.success) {
          const tenant = getTenantFromToken();
          if (tenant) saveSettingsCache(tenant, data.data);
        }
      })
      .catch((error) => {
        console.error("onePOS settings loading error:", error);
        /*
         * T8B: transport failure only - reuse cached VAT/store settings.
         * VAT calculation itself is unchanged; only the data source falls
         * back. Server answers are never replaced by cache.
         */
        if (isNetworkError(error)) {
          const tenant = getTenantFromToken();
          const cached = tenant ? loadSettingsCache(tenant) : null;
          if (cached?.tax) {
            setVatEnabled(cached.tax.vatEnabled !== false);
            setVatRate(Number(cached.tax.defaultVatRate || 0) / 100);
          }
          if (cached?.store) {
            setStoreName(cached.store.name);
          }
        }
      });

    const onlineOrderTimer = setInterval(loadOnlineOrderCount, 15000);
    return () => clearInterval(onlineOrderTimer);
  }, []);

  /*
   * T8C-F: offline sale queue lifecycle.
   *  - initial snapshot + live subscription keeps the header badge exact;
   *  - syncing when POS loads while online;
   *  - syncing when the browser comes back online.
   */
  useEffect(() => {
    const applySnapshot = () => {
      const snapshot = getQueueSnapshot();
      setOfflineCount(snapshot.pending);
      setFailedCount(snapshot.failed);
    };
    applySnapshot();
    const unsubscribe = subscribeQueue(applySnapshot);
    const removeNetworkListener = onNetworkChange((online) => {
      if (online) syncOfflineQueue();
    });
    syncOfflineQueue(); // drain anything queued while the till was closed
    return () => {
      unsubscribe();
      removeNetworkListener();
    };
  }, []);

  const productsRef = useRef(products);
  const addRef = useRef(null);

  useEffect(() => {
    let scanned = "";
    let timer;
    const handleScannerInput = (event) => {
      if (event.key === "Enter") {
        const barcode = scanned.trim();
        scanned = "";
        if (barcode) {
          const product = productsRef.current.find((item) => item.barcode === barcode);
          if (product) addRef.current(product);
          else setSaleError(`Unknown barcode: ${barcode}`);
        }
        return;
      }
      if (event.key.length === 1) {
        scanned += event.key;
        clearTimeout(timer);
        timer = setTimeout(() => { scanned = ""; }, 120);
      }
    };
    window.addEventListener("keydown", handleScannerInput);
    return () => { window.removeEventListener("keydown", handleScannerInput); clearTimeout(timer); };
  }, []);

  const filtered = products.filter(
    (product) => {
      const categoryMatch =
        category === "All" ||
        product.category === category;

      const query =
        search.toLowerCase().trim();

      const searchMatch =
        !query ||
        product.name
          .toLowerCase()
          .includes(query) ||
        product.sku
          ?.toLowerCase()
          .includes(query) ||
        product.barcode
          ?.toLowerCase()
          .includes(query);

      return (
        categoryMatch &&
        searchMatch &&
        product.active
      );
    }
  );

  const add = (product) => {
    const stockLimit = product.trackStock !== false ? Number(product.stock ?? product.stock_quantity ?? 0) : null;
    const existingQty = basket.reduce((total, item) => item.id === product.id ? total + item.quantity : total, 0);

    if (stockLimit !== null && existingQty >= stockLimit) {
      setSaleError(`Only ${stockLimit} left in stock for ${product.name}.`);
      return;
    }

    setSaleError("");
    setBasket((current) => {
      const found = current.find(
        (item) => item.id === product.id
      );

      if (found) {
        return current.map((item) =>
          item.id === product.id
            ? {
                ...item,
                quantity:
                  item.quantity + 1,
              }
            : item
        );
      }

      return [
        ...current,
        {
          ...product,
          quantity: 1,
        },
      ];
    });
  };

  useEffect(() => {
    productsRef.current = products;
    addRef.current = add;
  }, [products, add]);

  const decrease = (id) => {
    setBasket((current) =>
      current
        .map((item) =>
          item.id === id
            ? {
                ...item,
                quantity:
                  item.quantity - 1,
              }
            : item
        )
        .filter(
          (item) => item.quantity > 0
        )
    );
  };

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
    setBasket((current) => current.map((entry) => entry.id === id ? { ...entry, quantity: Math.floor(quantity) } : entry));
  };

  const removeItem = (id) => setBasket((current) => current.filter((item) => item.id !== id));

  const grossSubtotal = basket.reduce(
    (total, item) =>
      total +
      Number(item.price || 0) *
        item.quantity,
    0
  );

  const discountAmount = discountType === "percent"
    ? Math.min(grossSubtotal, grossSubtotal * (Number(discountValue) / 100))
    : Math.min(grossSubtotal, Math.max(0, Number(discountValue) || 0));
  const subtotal = Math.max(0, grossSubtotal - discountAmount);
  const vat = vatEnabled ? subtotal * vatRate : 0;
  const total = subtotal + vat;

  const applyDiscount = (type, value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0 || (type === "percent" && numericValue > 100) || (type === "amount" && numericValue > grossSubtotal)) {
      setSaleError(type === "percent" ? "Discount must be between 0 and 100%." : "Discount cannot exceed the subtotal.");
      return;
    }
    setDiscountType(numericValue === 0 ? null : type);
    setDiscountValue(numericValue);
    setShowDiscount(false);
    setSaleError("");
  };

  const holdSale = async () => {
    if (!basket.length) { setSaleError("Add an item before holding the sale."); return; }
    try {
      const data = await apiRequest("/api/held-sales", { method: "POST", body: JSON.stringify({ items: basket, customerId: selectedCustomer?.id || null, discountType, discountValue }) });
      if (!data.success) throw new Error(data.message || "Unable to hold sale");
      setBasket([]); setSelectedCustomer(null); setDiscountType(null); setDiscountValue(0); setSaleMessage("Sale held successfully.");
    } catch (error) { setSaleError(error.message || "Unable to hold sale"); }
  };

  const loadHeldSales = async () => {
    try {
      const data = await apiRequest("/api/held-sales");
      if (!data.success) throw new Error(data.message || "Unable to load held sales");
      setHeldSales(data.data || []); setShowHeldSales(true);
    } catch (error) { setSaleError(error.message || "Unable to load held sales"); }
  };

  const resumeSale = async (heldSale) => {
    setBasket(heldSale.items || []); setDiscountType(heldSale.discount_type); setDiscountValue(Number(heldSale.discount_value) || 0); setShowHeldSales(false);
    if (heldSale.customer_id) {
      try { const data = await apiRequest(`/api/customers/${heldSale.customer_id}`); if (data.success) setSelectedCustomer(data.data); } catch (error) { setSaleError(error.message || "Unable to restore customer"); }
    }
    await apiRequest(`/api/held-sales/${heldSale.id}`, { method: "DELETE" });
  };

  const completeSale = async (paymentMethod) => {
    if (!till) {
      setSaleError("Open a till session before completing a sale.");
      setShowTill(true);
      return;
    }
    /*
     * T8C-F: every sale carries a clientRequestId. The backend deduplicates
     * on it (T8C-SMALL), so a retried/queued sale can never be recorded
     * twice. Built at function scope so the offline fallback can reuse the
     * EXACT payload (and the SAME clientRequestId): if the original request
     * was only timeout-ambiguous, the later sync becomes a no-op server-side
     * instead of a duplicate sale. Payload shape and VAT/discount maths are
     * unchanged.
     */
    const payload = {
      clientRequestId: newClientRequestId(),
      items: basket.map((item) => {
        const lineGross = Number(item.price || 0) * item.quantity;
        const lineDiscount = grossSubtotal
          ? discountAmount * (lineGross / grossSubtotal)
          : 0;
        const lineNet = lineGross - lineDiscount;
        return {
          productId: item.id,
          quantity: item.quantity,
          unitPrice: item.price,
          tax: vatEnabled ? lineNet * vatRate : 0,
          discount: lineDiscount,
          total: lineNet + (vatEnabled ? lineNet * vatRate : 0),
        };
      }),
      customerId: selectedCustomer?.id || null,
      subtotal,
      tax: vat,
      discount: discountAmount,
      total,
      paymentMethod,
    };
    try {
      setSaleError("");
      setSaleMessage("");
      const data = await apiRequest("/api/sales", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!data.success) throw new Error(data.message || "Sale could not be completed");
      setBasket([]);
      setSelectedCustomer(null);
      setShowPayment(false);
      /*
       * T8E: show the server's authoritative receipt number for online
       * sales (falls back to the plain message if the server did not
       * return one, e.g. older backend).
       */
      setSaleMessage(
        data.sale?.receipt_number
          ? `Sale completed — Receipt ${data.sale.receipt_number}`
          : "Sale completed successfully."
      );
      await loadProducts();
      syncOfflineQueue(); // T8C-F: opportunistic drain now that connectivity is proven
    } catch (error) {
      /*
       * T8C-F: transport failure (request never reached the server) -> save
       * the exact payload to the offline queue. The cart clears only after
       * the queue write succeeds; otherwise the sale stays on screen so
       * nothing is lost. Server answers (400/403/500/...) keep the existing
       * error behaviour and are never queued.
       */
      if (isNetworkError(error)) {
        /*
         * The SAME clientRequestId is queued: if the original request was
         * only timeout-ambiguous (it actually reached the server), the
         * backend's idempotency key makes the later sync a no-op instead
         * of a duplicate sale.
         */
        const tenant = getTenantFromToken();
        const identity = tenant ? loadTerminalIdentity(tenant) : null;
        const queued = enqueueOfflineSale({
          sale: payload,
          terminalNumber: identity?.terminalNumber || null,
        });
        if (queued.ok) {
          setBasket([]);
          setSelectedCustomer(null);
          setShowPayment(false);
          /*
           * T8E: the provisional receipt is displayed while offline; after
           * sync the server's authoritative number replaces it (POS only
           * ever shows the provisional one here, never as permanent).
           */
          setSaleMessage(
            queued.entry?.provisionalReceipt
              ? `Saved offline — Receipt ${queued.entry.provisionalReceipt} (will sync automatically).`
              : "Sale saved offline — will sync automatically."
          );
          return;
        }
        setSaleError("Could not save the sale offline. The sale is still on screen — do not clear it.");
        return;
      }
      setSaleError(error.message || "Sale could not be completed");
    }
  };

  return (
    <div className="h-screen bg-[#eef1f4] flex flex-col overflow-hidden">
      <POSHeader
        loadingTill={loadingTill}
        till={till}
        onManageTill={() => setShowTill(true)}
        onAdmin={onAdmin}
        onOpenOnlineOrders={onOpenOnlineOrders}
        onLogout={onLogout}
        onlineOrderCount={onlineOrderCount}
        offlineCount={offlineCount}
        failedCount={failedCount}
      />

      {/* T8B: small non-blocking notice while cached data is in use. */}
      {offlineNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-amber-50 border border-amber-200 text-amber-800 shadow-lg rounded-lg px-4 py-2 text-sm">
            {offlineNotice}
          </div>
        </div>
      )}

      {/* Non-blocking new-online-order notification: a small toast over the
          till that never interrupts the current sale. Auto-dismisses. */}
      {onlineOrderToast && (
        <ToastAutoDismiss onDone={() => setOnlineOrderToast(null)}>
          <div className="fixed top-16 right-4 z-50">
            <div className="bg-white border border-slate-200 shadow-lg rounded-lg px-4 py-3 text-sm">
              <span className="flex items-start gap-2">
                <ShoppingBag size={16} className="text-blue-600 mt-0.5" />
                <button onClick={onOpenOnlineOrders} className="text-left">
                  <span className="font-medium">{onlineOrderToast.message}</span>
                  <span className="block text-xs text-slate-500 mt-0.5">Click to open Online Orders</span>
                </button>
                <button onClick={() => setOnlineOrderToast(null)} className="p-1 hover:bg-slate-100 rounded">
                  <X size={14} className="text-slate-400" />
                </button>
              </span>
            </div>
          </div>
        </ToastAutoDismiss>
      )}

      <div className="flex-1 flex min-h-0 pb-8">
        <ProductGrid
          category={category}
          onCategoryChange={setCategory}
          search={search}
          onSearchChange={setSearch}
          loadingProducts={loadingProducts}
          productError={productError}
          onRetry={loadProducts}
          filtered={filtered}
          onAddProduct={add}
        >
          <div className="h-[58px] bg-white border border-slate-200 rounded-md mt-3 flex items-center gap-2 px-2">
            <button onClick={holdSale} className="h-10 px-4 border border-slate-200 rounded text-sm">
              Hold Sale
            </button>

            <button onClick={loadHeldSales} className="h-10 px-4 border border-slate-200 rounded text-sm">
              Resume Sale
            </button>

            <button onClick={() => setShowCustomerSelector(true)} className="h-10 px-4 border border-slate-200 rounded text-sm">
              Customer
            </button>

            <button onClick={() => setShowDiscount(true)} className="h-10 px-4 border border-slate-200 rounded text-sm">
              <Percent
                size={15}
                className="inline mr-1"
              />
              Discount
            </button>

            <button onClick={() => basket.length && removeItem(basket[basket.length - 1].id)} disabled={!basket.length} className="h-10 px-4 border border-slate-200 rounded text-sm">
              Void
            </button>

            <button className="h-10 px-4 border border-slate-200 rounded text-sm">
              More
            </button>
          </div>
        </ProductGrid>

        <CartPanel
          basket={basket}
          selectedCustomer={selectedCustomer}
          onCustomerClick={() => setShowCustomerSelector(true)}
          onCustomerRemove={() => setSelectedCustomer(null)}
          saleError={saleError}
          saleMessage={saleMessage}
          onIncrease={add}
          onDecrease={decrease}
          onUpdateQuantity={updateQuantity}
          onRemoveItem={removeItem}
          subtotal={subtotal}
          vat={vat}
          total={total}
          onCheckout={() => setShowPayment(true)}
        />
      </div>

      {showPayment && (
        <PaymentModal
          total={total}
          onClose={() =>
            setShowPayment(false)
          }
          onComplete={() => {
            completeSale("cash");
          }}
          onCard={() => completeSale("card")}
        />
      )}

      {showCustomerSelector && <CustomerSelectorModal onClose={() => setShowCustomerSelector(false)} onSelected={(customer) => { setSelectedCustomer(customer); setShowCustomerSelector(false); }} />}
      {showDiscount && <DiscountModal subtotal={grossSubtotal} onClose={() => setShowDiscount(false)} onApply={applyDiscount} />}
      {showHeldSales && <HeldSalesModal sales={heldSales} onClose={() => setShowHeldSales(false)} onResume={resumeSale} />}
      {showTill && (
        <TillSessionModal
          onClose={() => { setShowTill(false); loadCurrentTill(); }}
          onUpdate={loadCurrentTill}
        />
      )}

      <BottomStatusBar storeName={storeName} till={till} />
    </div>
  );
}

function DiscountModal({ subtotal, onClose, onApply }) {
  const [type, setType] = useState("percent");
  const [value, setValue] = useState("");
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><form onSubmit={(event) => { event.preventDefault(); onApply(type, value); }} className="bg-white rounded-xl w-[360px] p-5"><div className="flex justify-between mb-4"><h2 className="font-bold text-lg">Apply discount</h2><button type="button" onClick={onClose} title="Close"><X size={18} /></button></div><div className="grid grid-cols-2 gap-2 mb-3"><button type="button" onClick={() => setType("percent")} className={`h-9 border rounded text-sm ${type === "percent" ? "border-blue-600 bg-blue-50 text-blue-700" : ""}`}>Percentage</button><button type="button" onClick={() => setType("amount")} className={`h-9 border rounded text-sm ${type === "amount" ? "border-blue-600 bg-blue-50 text-blue-700" : ""}`}>Amount</button></div><label className="text-sm">Discount value<input required type="number" min="0" step="0.01" max={type === "percent" ? 100 : subtotal} value={value} onChange={(event) => setValue(event.target.value)} className="block w-full h-10 mt-1 border rounded px-2" /></label><div className="flex justify-end gap-2 mt-5"><button type="button" onClick={onClose} className="px-3 py-2 border rounded text-sm">Cancel</button><button className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Apply</button></div></form></div>;
}

function HeldSalesModal({ sales, onClose, onResume }) {
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[520px] max-w-full"><div className="p-4 border-b flex justify-between"><h2 className="font-bold text-lg">Held sales</h2><button onClick={onClose} title="Close"><X size={18} /></button></div><div className="p-4 max-h-80 overflow-y-auto">{sales.length ? sales.map((sale) => <div key={sale.id} className="flex justify-between items-center py-3 border-b"><div><div className="font-medium text-sm">{sale.items.length} item(s)</div><div className="text-xs text-slate-500">{new Date(sale.created_at).toLocaleString()}</div></div><button onClick={() => onResume(sale)} className="px-3 py-2 bg-blue-50 text-blue-700 rounded text-sm">Resume</button></div>) : <div className="text-sm text-slate-500 text-center py-6">No held sales.</div>}</div></div></div>;
}

export default POS;

/* Auto-dismisses its children after 10 seconds (non-blocking notification). */
function ToastAutoDismiss({ onDone, timeoutMs = 10000, children }) {
  useEffect(() => {
    const timer = setTimeout(onDone, timeoutMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return children;
}
