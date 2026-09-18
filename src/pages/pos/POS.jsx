import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Percent, ShoppingBag, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import {
  isNetworkError,
  onNetworkChange,
  isOnline,
  reportConnection,
} from "../../services/networkStatus.js";
import QueueDetailsModal from "./QueueDetailsModal.jsx";
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
  loadTillContext,
  loadOfflineSession,
} from "../../services/offlineStore.js";
import {
  newClientRequestId,
  enqueueOfflineSale,
  syncOfflineQueue,
  getQueueSnapshot,
  subscribeQueue,
  startAutoSync,
  getSyncStats,
  acknowledgeQueuedSale,
  failQueuedSale,
} from "../../services/offlineQueue.js";
import { normaliseProduct } from "../../utils/formatters.js";
import { computeBasketTotals } from "../../utils/saleTotals.js";
import BottomStatusBar from "../../components/BottomStatusBar.jsx";
import TillSessionModal from "./TillSessionModal.jsx";
import POSHeader from "./POSHeader.jsx";
import CartPanel from "./CartPanel.jsx";
import CustomerDisplayWindow from "./CustomerDisplayWindow.jsx";
import ProductGrid from "./ProductGrid.jsx";
import PaymentModal from "./PaymentModal.jsx";
import CustomerSelectorModal from "./CustomerSelectorModal.jsx";

/* =========================================================
   POS / TILL
========================================================= */

function POS({
  onAdmin,
  onOpenOnlineOrders,
  onLogout,
  onStartSelfCheckout,
  scoStarting = false,
  scoError = "",
}) {
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

  /*
   * T10C age verification
   */
  const basketHasAgeRestricted = basket.some(
    (item) => item.ageRestricted === true
  );

  const [ageVerifiedThisSale, setAgeVerifiedThisSale] = useState(false);
  const [showAgeModal, setShowAgeModal] = useState(false);

  /*
   * T10U — negative-inventory billing safety. The till keeps its products
   * (already carrying `stock` / `trackStock`) so it can warn BEFORE asking
   * the server. The backend remains the authority: it re-checks stock
   * inside the sale transaction and still rejects when the company setting
   * is OFF — even if this modal is bypassed.
   */
  const [negativeStockNotice, setNegativeStockNotice] = useState(null);

  useEffect(() => {
    if (!basketHasAgeRestricted) {
      setAgeVerifiedThisSale(false);
    }
  }, [basketHasAgeRestricted]);

  /* T10F-FIX-UI — listen for non-blocking notices from the customer window. */
  useEffect(() => {
    const onToast = (event) => {
      if (event.detail && event.detail.message) {
        setPopupNotice(String(event.detail.message));
      }
    };

    window.addEventListener("onepos:toast", onToast);

    return () => window.removeEventListener("onepos:toast", onToast);
  }, []);

  const [till, setTill] = useState(null);
  const [showTill, setShowTill] = useState(false);
  const [loadingTill, setLoadingTill] = useState(true);
  const [storeName, setStoreName] = useState("");

  /*
   * T10F-FIX — Customer Display is a SEPARATE browser window (for a second
   * monitor). The till always keeps its full cashier layout; the popup is a
   * read-only mirror of the same basket/totals state.
   */
  const [showCustomerDisplay, setShowCustomerDisplay] = useState(false);

  /*
   * Online orders
   */
  const [onlineOrderCount, setOnlineOrderCount] = useState(0);
  const [onlineOrderToast, setOnlineOrderToast] = useState(null);

  const loadOnlineOrderCount = async () => {
    try {
      const data = await apiRequest(
        "/api/online/orders?status=RECEIVED&limit=50"
      );

      if (data.success) {
        const next = Array.isArray(data.data) ? data.data.length : 0;

        setOnlineOrderCount((previous) => {
          if (next > previous) {
            setOnlineOrderToast({
              message: "New Uber Eats Order",
            });
          }

          return next;
        });
      }
    } catch (error) {
      console.error("Load online order count error:", error);
    }
  };

  /*
   * Products
   */
  const [products, setProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productError, setProductError] = useState("");

  /*
   * Offline
   */
  const [offlineNotice, setOfflineNotice] = useState("");

  /* T10F-FIX-UI — non-blocking toast channel (e.g. popup-blocked notice
     from the Customer Display window uses the same pattern as offline). */
  const [popupNotice, setPopupNotice] = useState("");
  const [offlineCount, setOfflineCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const [online, setOnline] = useState(isOnline);
  const [showQueue, setShowQueue] = useState(false);

  const completing = useRef(false);
  const requestRef = useRef(null);

  /*
   * VAT
   */
  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatRate, setVatRate] = useState(0.2);

  /* =========================================================
     TILL
  ========================================================= */

  const loadCurrentTill = async () => {
    setLoadingTill(true);

    try {
      const data = await apiRequest("/api/till/sessions/current", {
        signal: AbortSignal.timeout(10000),
      });

      if (!data.success) {
        throw new Error(data.message || "Unable to load till");
      }

      setTill(data.data || null);

      const tenant = getTenantFromToken();

      if (tenant) {
        if (data.data && data.data.status === "open") {
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

      if (isNetworkError(error)) {
        reportConnection(false);

        const tenant = getTenantFromToken();
        const cached = tenant ? loadTillContext(tenant) : null;

        if (
          cached?.userId === tenant?.userId &&
          cached?.sessionId
        ) {
          setTill({
            id: cached.sessionId,
            terminal_name: cached.terminalName,
            status: "open",
            offline: true,
          });
        }
      }

      if (
        error.status === 401 ||
        error.status === 403 ||
        message.includes("No open till session")
      ) {
        setTill(null);
      }
    } finally {
      setLoadingTill(false);
    }
  };

  /* =========================================================
     PRODUCTS
  ========================================================= */

  const loadProducts = async () => {
    try {
      setLoadingProducts(true);
      setProductError("");

      const data = await apiRequest("/api/products", {
        signal: AbortSignal.timeout(10000),
      });

      if (!data.success) {
        throw new Error(
          data.message || "Unable to load products"
        );
      }

      const databaseProducts = Array.isArray(data.data)
        ? data.data.map(normaliseProduct)
        : [];

      setProducts(databaseProducts);
      reportConnection(true);

      const tenant = getTenantFromToken();

      if (tenant) {
        saveProductCache(tenant, databaseProducts);
      }

      setOfflineNotice("");
    } catch (error) {
      console.error(
        "onePOS product loading error:",
        error
      );

      if (isNetworkError(error)) {
        const tenant = getTenantFromToken();
        const cached = tenant
          ? loadProductCache(tenant)
          : null;

        if (cached && cached.length) {
          setProducts(cached);
          setProductError("");

          setOfflineNotice(
            "Offline — cash sales can be saved pending sync. Stock is last-known; adjusted only by the backend on sync."
          );

          return;
        }
      }

      setProductError(
        error.message || "Unable to load products"
      );
    } finally {
      setLoadingProducts(false);
    }
  };

  /* =========================================================
     INITIAL LOAD
  ========================================================= */

  useEffect(() => {
    loadProducts();
    loadCurrentTill();
    loadOnlineOrderCount();

    apiRequest("/api/settings", {
      signal: AbortSignal.timeout(10000),
    })
      .then((data) => {
        if (data.success && data.data?.tax) {
          setVatEnabled(
            data.data.tax.vatEnabled !== false
          );

          setVatRate(
            Number(
              data.data.tax.defaultVatRate || 0
            ) / 100
          );
        }

        if (data.success && data.data?.store) {
          setStoreName(data.data.store.name);
        }

        if (data.success) {
          const tenant = getTenantFromToken();

          if (tenant) {
            saveSettingsCache(tenant, data.data);
          }
        }
      })
      .catch((error) => {
        console.error(
          "onePOS settings loading error:",
          error
        );

        if (isNetworkError(error)) {
          const tenant = getTenantFromToken();

          const cached = tenant
            ? loadSettingsCache(tenant)
            : null;

          if (cached?.tax) {
            setVatEnabled(
              cached.tax.vatEnabled !== false
            );

            setVatRate(
              Number(
                cached.tax.defaultVatRate || 0
              ) / 100
            );
          }

          if (cached?.store) {
            setStoreName(cached.store.name);
          }
        }
      });

    const onlineOrderTimer = setInterval(
      loadOnlineOrderCount,
      15000
    );

    return () => clearInterval(onlineOrderTimer);
  }, []);

  /* =========================================================
     OFFLINE QUEUE
  ========================================================= */

  useEffect(() => {
    const applySnapshot = () => {
      const snapshot = getQueueSnapshot();

      setOfflineCount(snapshot.pending);
      setFailedCount(snapshot.failed);
      setSyncing(snapshot.syncing);
      setSyncError(
        Boolean(getSyncStats().lastError)
      );
    };

    applySnapshot();

    const unsubscribe = subscribeQueue(
      applySnapshot
    );

    const removeNetworkListener =
      onNetworkChange(setOnline);

    const stopSync = startAutoSync();

    return () => {
      stopSync();
      unsubscribe();
      removeNetworkListener();
    };
  }, []);

  /* =========================================================
     BARCODE SCANNER
  ========================================================= */

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
          const product =
            productsRef.current.find(
              (item) =>
                item.barcode === barcode
            );

          if (product) {
            addRef.current(product);
          } else {
            setSaleError(
              `Unknown barcode: ${barcode}`
            );
          }
        }

        return;
      }

      if (event.key.length === 1) {
        scanned += event.key;

        clearTimeout(timer);

        timer = setTimeout(() => {
          scanned = "";
        }, 120);
      }
    };

    window.addEventListener(
      "keydown",
      handleScannerInput
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleScannerInput
      );

      clearTimeout(timer);
    };
  }, []);

  /* =========================================================
     FILTER PRODUCTS
  ========================================================= */

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

  /* =========================================================
     ADD PRODUCT
  ========================================================= */

  const add = (product) => {
    const stockLimit =
      product.trackStock !== false
        ? Number(
            product.stock ??
              product.stock_quantity ??
              0
          )
        : null;

    const existingQty =
      basket.reduce(
        (total, item) =>
          item.id === product.id
            ? total + item.quantity
            : total,
        0
      );

    if (
      stockLimit !== null &&
      existingQty >= stockLimit
    ) {
      setSaleError(
        `Only ${stockLimit} left in stock for ${product.name}.`
      );

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

  /* =========================================================
     BASKET
  ========================================================= */

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

  const updateQuantity = (
    id,
    value
  ) => {
    const quantity = Number(value);

    if (
      !Number.isFinite(quantity) ||
      quantity < 1
    ) {
      return;
    }

    const item = basket.find(
      (entry) => entry.id === id
    );

    if (!item) {
      return;
    }

    const stockLimit =
      item.trackStock !== false
        ? Number(item.stock ?? 0)
        : null;

    if (
      stockLimit !== null &&
      quantity > stockLimit
    ) {
      setSaleError(
        `Only ${stockLimit} left in stock for ${item.name}.`
      );

      return;
    }

    setSaleError("");

    setBasket((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              quantity:
                Math.floor(quantity),
            }
          : entry
      )
    );
  };

  const removeItem = (id) =>
    setBasket((current) =>
      current.filter(
        (item) => item.id !== id
      )
    );

  /* =========================================================
     TOTALS
  ========================================================= */

  const {
    grossSubtotal,
    discountAmount,
    subtotal,
    vat,
    total,
  } = computeBasketTotals(basket, {
    vatEnabled,
    vatRate,
    discountType,
    discountValue,
  });

  /* =========================================================
     DISCOUNT
  ========================================================= */

  const applyDiscount = (
    type,
    value
  ) => {
    const numericValue = Number(value);

    if (
      !Number.isFinite(numericValue) ||
      numericValue < 0 ||
      (type === "percent" &&
        numericValue > 100) ||
      (type === "amount" &&
        numericValue > grossSubtotal)
    ) {
      setSaleError(
        type === "percent"
          ? "Discount must be between 0 and 100%."
          : "Discount cannot exceed the subtotal."
      );

      return;
    }

    setDiscountType(
      numericValue === 0
        ? null
        : type
    );

    setDiscountValue(
      numericValue
    );

    setShowDiscount(false);
    setSaleError("");
  };

  /* =========================================================
     HELD SALES
  ========================================================= */

  const holdSale = async () => {
    if (!basket.length) {
      setSaleError(
        "Add an item before holding the sale."
      );

      return;
    }

    try {
      const data = await apiRequest(
        "/api/held-sales",
        {
          method: "POST",
          body: JSON.stringify({
            items: basket,
            customerId:
              selectedCustomer?.id ||
              null,
            discountType,
            discountValue,
          }),
        }
      );

      if (!data.success) {
        throw new Error(
          data.message ||
            "Unable to hold sale"
        );
      }

      setBasket([]);
      setSelectedCustomer(null);
      setDiscountType(null);
      setDiscountValue(0);
      setSaleMessage(
        "Sale held successfully."
      );
    } catch (error) {
      setSaleError(
        error.message ||
          "Unable to hold sale"
      );
    }
  };

  const loadHeldSales = async () => {
    try {
      const data =
        await apiRequest(
          "/api/held-sales"
        );

      if (!data.success) {
        throw new Error(
          data.message ||
            "Unable to load held sales"
        );
      }

      setHeldSales(
        data.data || []
      );

      setShowHeldSales(true);
    } catch (error) {
      setSaleError(
        error.message ||
          "Unable to load held sales"
      );
    }
  };

  const resumeSale = async (
    heldSale
  ) => {
    setBasket(
      heldSale.items || []
    );

    setDiscountType(
      heldSale.discount_type
    );

    setDiscountValue(
      Number(
        heldSale.discount_value
      ) || 0
    );

    setShowHeldSales(false);

    if (heldSale.customer_id) {
      try {
        const data =
          await apiRequest(
            `/api/customers/${heldSale.customer_id}`
          );

        if (data.success) {
          setSelectedCustomer(
            data.data
          );
        }
      } catch (error) {
        setSaleError(
          error.message ||
            "Unable to restore customer"
        );
      }
    }

    await apiRequest(
      `/api/held-sales/${heldSale.id}`,
      {
        method: "DELETE",
      }
    );
  };

  /* =========================================================
     COMPLETE SALE
  ========================================================= */

  const completeSale = async (
    paymentMethod,
    options = {}
  ) => {
    if (
      completing.current ||
      !basket.length
    ) {
      return;
    }

    if (
      basketHasAgeRestricted &&
      !ageVerifiedThisSale
    ) {
      setShowPayment(false);
      setShowAgeModal(true);
      return;
    }

    /* T10U — pre-flight insufficient-stock warning. Advisory only: the
       backend decides via the company setting, inside the sale
       transaction. Cards show recorded stock vs requested quantity. */
    const stockShortfalls = basket
      .filter((item) => item.trackStock === true)
      .filter((item) => Number(item.stock || 0) < Number(item.quantity || 0))
      .map((item) => ({
        name: item.name,
        recordedStock: Number(item.stock || 0),
        requestedQuantity: Number(item.quantity || 0),
      }));

    if (stockShortfalls.length > 0 && !options.skipStockWarning) {
      setNegativeStockNotice({
        lines: stockShortfalls,
        paymentMethod,
      });
      return;
    }

    if (!isOnline()) {
      const session =
        await loadOfflineSession();

      const allowed = (code) =>
        session?.permissions
          ?.isAdmin ||
        session?.permissions?.permissions?.includes(
          code
        );

      if (
        !allowed("sale.create") ||
        (discountAmount > 0 &&
          !allowed("sale.discount"))
      ) {
        setSaleError(
          "Connect and verify your sale/discount permissions before selling offline."
        );

        return;
      }
    }

    if (
      paymentMethod !== "cash" &&
      !isOnline()
    ) {
      setSaleError(
        "Card payment needs a confirmed terminal payment and an online connection. Use cash offline."
      );

      return;
    }

    if (!till) {
      setSaleError(
        "Open a till session before completing a sale."
      );

      setShowTill(true);

      return;
    }

    const signature =
      JSON.stringify({
        basket,
        selectedCustomer:
          selectedCustomer?.id,
        total,
        paymentMethod,
      });

    if (
      !requestRef.current ||
      requestRef.current.signature !==
        signature
    ) {
      requestRef.current = {
        signature,
        id: newClientRequestId(),
      };
    }

    const payload = {
      clientRequestId:
        requestRef.current.id,

      items: basket.map((item) => {
        const lineGross =
          Number(item.price || 0) *
          item.quantity;

        const lineDiscount =
          grossSubtotal
            ? discountAmount *
              (lineGross /
                grossSubtotal)
            : 0;

        const lineNet =
          lineGross -
          lineDiscount;

        const lineVatRate =
          item.vatApplicable === false
            ? 0
            : vatRate;

        const lineTax =
          vatEnabled
            ? lineNet *
              lineVatRate
            : 0;

        return {
          productId: item.id,
          quantity: item.quantity,
          unitPrice: item.price,
          tax: lineTax,
          discount: lineDiscount,
          total:
            lineNet + lineTax,
        };
      }),

      customerId:
        selectedCustomer?.id ||
        null,

      subtotal,
      tax: vat,
      discount: discountAmount,
      total,
      paymentMethod,

      ageVerified:
        basketHasAgeRestricted
          ? ageVerifiedThisSale
          : undefined,
    };

    const hadQueuedSales =
      getQueueSnapshot().total > 0;

    completing.current = true;

    if (
      paymentMethod === "cash"
    ) {
      const tenant =
        getTenantFromToken();

      const stored =
        enqueueOfflineSale({
          sale: payload,
          terminalNumber: tenant
            ? loadTerminalIdentity(
                tenant
              )?.terminalNumber
            : null,
        });

      if (!stored.ok) {
        completing.current = false;

        setSaleError(
          "Unable to save a durable sale record. Do not take payment or clear the cart."
        );

        return;
      }
    }

    try {
      setSaleError("");
      setSaleMessage("");

      if (
        !isOnline() ||
        (paymentMethod === "cash" &&
          hadQueuedSales)
      ) {
        throw new TypeError(
          "Offline or earlier sales waiting"
        );
      }

      const data =
        await apiRequest(
          "/api/sales",
          {
            signal:
              AbortSignal.timeout(
                15000
              ),
            method: "POST",
            body: JSON.stringify(
              payload
            ),
          }
        );

      if (
        !data.success ||
        !data.sale?.id
      ) {
        throw Object.assign(
          new Error(
            "Unconfirmed sale response"
          ),
          {
            code:
              "INVALID_RESPONSE",
          }
        );
      }

      if (
        paymentMethod === "cash"
      ) {
        acknowledgeQueuedSale(
          payload.clientRequestId,
          data.sale
        );
      }

      reportConnection(true);

      requestRef.current = null;

      setDiscountType(null);
      setDiscountValue(0);
      setBasket([]);
      setSelectedCustomer(null);
      setShowPayment(false);

      setSaleMessage(
        data.sale?.receipt_number
          ? `Sale completed — Receipt ${data.sale.receipt_number}`
          : "Sale completed successfully."
      );

      await loadProducts();

      syncOfflineQueue();
    } catch (error) {
      if (
        isNetworkError(error) ||
        error.code ===
          "INVALID_RESPONSE" ||
        error.status >= 500
      ) {
        reportConnection(false);

        if (
          paymentMethod !== "cash"
        ) {
          setSaleError(
            "Card sale outcome is unknown. Check the terminal and sale history before retrying; no offline card payment was recorded."
          );

          return;
        }

        const tenant =
          getTenantFromToken();

        const identity =
          tenant
            ? loadTerminalIdentity(
                tenant
              )
            : null;

        const queued =
          enqueueOfflineSale({
            sale: payload,
            terminalNumber:
              identity?.terminalNumber ||
              null,
          });

        if (queued.ok) {
          requestRef.current = null;

          setDiscountType(null);
          setDiscountValue(0);
          setBasket([]);
          setSelectedCustomer(null);
          setShowPayment(false);

          setSaleMessage(
            queued.entry
              ?.provisionalReceipt
              ? `Pending sync — ${queued.entry.provisionalReceipt}. Stock is adjusted only after backend synchronization.`
              : "Sale saved locally — Pending sync. Stock is adjusted after synchronization."
          );

          return;
        }

        setSaleError(
          "Could not save the sale offline. The sale is still on screen — do not clear it."
        );

        return;
      }

      if (
        paymentMethod === "cash"
      ) {
        failQueuedSale(
          payload.clientRequestId,
          error.status
        );

        setBasket([]);
        setSelectedCustomer(null);
        setDiscountType(null);
        setDiscountValue(0);
        setShowPayment(false);
        requestRef.current = null;

        setSaleError(
          "Sale retained in the queue for review. Check queue details before retrying; do not enter it again."
        );
      } else {
        setSaleError(
          error.message ||
            "Sale could not be completed"
        );
      }
    } finally {
      completing.current = false;
    }
  };

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="h-screen bg-slate-100 flex flex-col overflow-hidden">

      <POSHeader
        loadingTill={loadingTill}
        till={till}
        onManageTill={() =>
          setShowTill(true)
        }
        onAdmin={onAdmin}
        onOpenOnlineOrders={
          onOpenOnlineOrders
        }
        onLogout={onLogout}
        onlineOrderCount={
          onlineOrderCount
        }
        offlineCount={offlineCount}
        failedCount={failedCount}
        syncing={syncing}
        syncError={syncError}
        online={online}
        onQueue={() =>
          setShowQueue(true)
        }

        /* T10D */
        onStartSelfCheckout={
          onStartSelfCheckout
        }
        scoStarting={scoStarting}

        /* T10F-FIX */
        onToggleCustomerDisplay={() =>
          setShowCustomerDisplay((v) => !v)
        }
        customerDisplayOn={showCustomerDisplay}
      />

      {/* T10F-FIX — separate customer window (second monitor). Rendered
          THROUGH a portal into that window so it always shows the same live
          basket/totals state with zero duplicated logic. Closing it never
          affects the till. */}
      {showCustomerDisplay && (
        <CustomerDisplayWindow
          basket={basket}
          subtotal={subtotal}
          vat={vat}
          total={total}
          discountAmount={discountAmount}
          hasDiscount={discountType !== null && discountValue > 0}
          hasCustomer={Boolean(selectedCustomer)}
          storeName={storeName}
          onClose={() => setShowCustomerDisplay(false)}
        />
      )}

      {showQueue && (
        <QueueDetailsModal
          onClose={() =>
            setShowQueue(false)
          }
        />
      )}

      {offlineNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40">
          <div className="bg-amber-50 border border-amber-200 text-amber-800 shadow-lg rounded-lg px-4 py-2 text-sm">
            {offlineNotice}
          </div>
        </div>
      )}

      {popupNotice && (
        <ToastAutoDismiss
          timeout={6000}
          onDone={() => setPopupNotice("")}
        >
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50">
            <div className="bg-red-50 border border-red-200 text-red-700 shadow-lg rounded-lg px-4 py-2 text-sm">
              {popupNotice}
            </div>
          </div>
        </ToastAutoDismiss>
      )}

      {onlineOrderToast && (
        <ToastAutoDismiss
          onDone={() =>
            setOnlineOrderToast(null)
          }
        >
          <div className="fixed top-16 right-4 z-50">
            <div className="bg-white border border-slate-200 shadow-lg rounded-lg px-4 py-3 text-sm">
              <span className="flex items-start gap-2">
                <ShoppingBag
                  size={16}
                  className="text-blue-600 mt-0.5"
                />

                <button
                  onClick={
                    onOpenOnlineOrders
                  }
                  className="text-left"
                >
                  <span className="font-medium">
                    {
                      onlineOrderToast.message
                    }
                  </span>

                  <span className="block text-xs text-slate-500 mt-0.5">
                    Click to open Online Orders
                  </span>
                </button>

                <button
                  onClick={() =>
                    setOnlineOrderToast(
                      null
                    )
                  }
                  className="p-1 hover:bg-slate-100 rounded"
                >
                  <X
                    size={14}
                    className="text-slate-400"
                  />
                </button>
              </span>
            </div>
          </div>
        </ToastAutoDismiss>
      )}

      <div className="flex-1 flex min-h-0 pb-8">

        <ProductGrid
          category={category}
          onCategoryChange={
            setCategory
          }
          search={search}
          onSearchChange={setSearch}
          loadingProducts={
            loadingProducts
          }
          productError={
            productError
          }
          onRetry={loadProducts}
          filtered={filtered}
          onAddProduct={add}
        >
          <div className="h-[58px] bg-white border border-slate-200 rounded-md mt-3 flex items-center gap-2 px-2">

            <button
              onClick={holdSale}
              className="h-10 px-4 border border-slate-200 rounded text-sm"
            >
              Hold Sale
            </button>

            <button
              onClick={loadHeldSales}
              className="h-10 px-4 border border-slate-200 rounded text-sm"
            >
              Resume Sale
            </button>

            <button
              onClick={() =>
                setShowCustomerSelector(
                  true
                )
              }
              className="h-10 px-4 border border-slate-200 rounded text-sm"
            >
              Customer
            </button>

            <button
              onClick={() =>
                setShowDiscount(true)
              }
              className="h-10 px-4 border border-slate-200 rounded text-sm"
            >
              <Percent
                size={15}
                className="inline mr-1"
              />
              Discount
            </button>

            <button
              onClick={() =>
                basket.length &&
                removeItem(
                  basket[
                    basket.length - 1
                  ].id
                )
              }
              disabled={!basket.length}
              className="h-10 px-4 border border-slate-200 rounded text-sm disabled:opacity-50"
            >
              Void
            </button>

            <button className="h-10 px-4 border border-slate-200 rounded text-sm">
              More
            </button>
          </div>
        </ProductGrid>

        <CartPanel
          basket={basket}
          selectedCustomer={
            selectedCustomer
          }
          onCustomerClick={() =>
            setShowCustomerSelector(
              true
            )
          }
          onCustomerRemove={() =>
            setSelectedCustomer(null)
          }
          saleError={saleError}
          saleMessage={saleMessage}
          onIncrease={add}
          onDecrease={decrease}
          onUpdateQuantity={
            updateQuantity
          }
          onRemoveItem={removeItem}
          subtotal={subtotal}
          vat={vat}
          total={total}
          onCheckout={() => {
            if (
              basketHasAgeRestricted &&
              !ageVerifiedThisSale
            ) {
              setShowAgeModal(true);
              return;
            }

            setShowPayment(true);
          }}
        />
      </div>

      {showAgeModal && (
        <AgeVerificationModal
          productNames={basket
            .filter(
              (item) =>
                item.ageRestricted ===
                true
            )
            .map(
              (item) => item.name
            )}
          onConfirm={() => {
            setAgeVerifiedThisSale(
              true
            );
            setShowAgeModal(false);
            setShowPayment(true);
          }}
          onCancel={() =>
            setShowAgeModal(false)
          }
        />
      )}

      {/* T10U — Insufficient Inventory warning. Read-only: recorded stock and
          requested quantity per affected line; Cancel returns to the payment
          view, Continue proceeds through the EXISTING checkout (the server
          still enforces the company setting and audits the sale). */}
      {negativeStockNotice && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label="Insufficient inventory warning"
        >
          <div className="bg-white rounded-xl w-[440px] max-w-full shadow-2xl">
            <div className="px-4 py-3 border-b border-amber-200 bg-amber-50 rounded-t-xl">
              <h2 className="font-bold text-amber-800 flex items-center gap-2">
                <AlertTriangle size={18} />
                Insufficient Inventory
              </h2>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-sm text-slate-600">
                Recorded stock is lower than the quantity being sold:
              </p>
              {negativeStockNotice.lines.map((line) => (
                <div
                  key={line.name}
                  data-testid="negative-stock-line"
                  className="flex items-center justify-between border border-slate-200 rounded-md px-3 py-2 text-sm"
                >
                  <span className="font-medium text-slate-800 truncate mr-2">{line.name}</span>
                  <span className="text-xs text-slate-500 shrink-0">
                    Stock: <b className="text-slate-700">{line.recordedStock}</b>
                    {' \u00b7 '}
                    Requested: <b className="text-red-600">{line.requestedQuantity}</b>
                  </span>
                </div>
              ))}
              <p className="text-xs text-slate-500 pt-1">
                Continuing will record the sale and stock may go negative; a later purchase inward, sales return or stock adjustment corrects the balance.
              </p>
            </div>
            <div className="p-4 pt-0 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNegativeStockNotice(null)}
                className="h-10 px-4 border border-slate-200 rounded text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="negative-stock-continue"
                onClick={() => {
                  const method = negativeStockNotice.paymentMethod;
                  setNegativeStockNotice(null);
                  completeSale(method, { skipStockWarning: true });
                }}
                className="h-10 px-4 bg-blue-600 text-white rounded text-sm font-medium"
              >
                Continue Sale
              </button>
            </div>
          </div>
        </div>
      )}

      {showPayment && (
        <PaymentModal
          total={total}
          onClose={() =>
            setShowPayment(false)
          }
          offline={!online}
          onComplete={() =>
            completeSale("cash")
          }
          onCard={() =>
            completeSale("card")
          }
        />
      )}

      {showCustomerSelector && (
        <CustomerSelectorModal
          onClose={() =>
            setShowCustomerSelector(
              false
            )
          }
          onSelected={(customer) => {
            setSelectedCustomer(
              customer
            );
            setShowCustomerSelector(
              false
            );
          }}
        />
      )}

      {showDiscount && (
        <DiscountModal
          subtotal={grossSubtotal}
          onClose={() =>
            setShowDiscount(false)
          }
          onApply={applyDiscount}
        />
      )}

      {showHeldSales && (
        <HeldSalesModal
          sales={heldSales}
          onClose={() =>
            setShowHeldSales(false)
          }
          onResume={resumeSale}
        />
      )}

      {showTill && (
        <TillSessionModal
          onClose={() => {
            setShowTill(false);
            loadCurrentTill();
          }}
          onUpdate={loadCurrentTill}
        />
      )}

      {scoError && (
        <div
          role="alert"
          className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm shadow"
        >
          {scoError}
        </div>
      )}

      <BottomStatusBar
        storeName={storeName}
        till={till}
      />
    </div>
  );
}

/* =========================================================
   DISCOUNT MODAL
========================================================= */

function DiscountModal({
  subtotal,
  onClose,
  onApply,
}) {
  const [type, setType] =
    useState("percent");

  const [value, setValue] =
    useState("");

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onApply(type, value);
        }}
        className="bg-white rounded-xl w-[360px] p-5"
      >
        <div className="flex justify-between mb-4">
          <h2 className="font-bold text-lg">
            Apply discount
          </h2>

          <button
            type="button"
            onClick={onClose}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <button
            type="button"
            onClick={() =>
              setType("percent")
            }
            className={`h-9 border rounded text-sm ${
              type === "percent"
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : ""
            }`}
          >
            Percentage
          </button>

          <button
            type="button"
            onClick={() =>
              setType("amount")
            }
            className={`h-9 border rounded text-sm ${
              type === "amount"
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : ""
            }`}
          >
            Amount
          </button>
        </div>

        <label className="text-sm">
          Discount value

          <input
            required
            type="number"
            min="0"
            step="0.01"
            max={
              type === "percent"
                ? 100
                : subtotal
            }
            value={value}
            onChange={(event) =>
              setValue(
                event.target.value
              )
            }
            className="block w-full h-10 mt-1 border rounded px-2"
          />
        </label>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 border rounded text-sm"
          >
            Cancel
          </button>

          <button className="px-4 py-2 bg-blue-600 text-white rounded text-sm">
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}

/* =========================================================
   AGE VERIFICATION
========================================================= */

function AgeVerificationModal({
  productNames,
  onConfirm,
  onCancel,
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-verify-title"
    >
      <div className="bg-white rounded-xl w-[380px] max-w-full p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
            18+
          </div>

          <div className="min-w-0">
            <h2
              id="age-verify-title"
              className="font-bold text-lg"
            >
              Age Verification Required
            </h2>

            <p className="text-sm text-slate-600 mt-1">
              This basket contains
              age-restricted product
              {productNames.length > 1
                ? "s"
                : ""}
              :
            </p>

            <p
              className="text-sm font-medium text-slate-800 mt-1 truncate"
              title={productNames.join(
                ", "
              )}
            >
              {productNames
                .slice(0, 3)
                .join(", ")}

              {productNames.length >
              3
                ? "…"
                : ""}
            </p>
          </div>
        </div>

        <p className="text-sm text-slate-700 mt-4">
          Customer appears to be 18
          or over?
        </p>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
            autoFocus
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={onConfirm}
            className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   HELD SALES
========================================================= */

function HeldSalesModal({
  sales,
  onClose,
  onResume,
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[520px] max-w-full">
        <div className="p-4 border-b flex justify-between">
          <h2 className="font-bold text-lg">
            Held sales
          </h2>

          <button
            onClick={onClose}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 max-h-80 overflow-y-auto">
          {sales.length ? (
            sales.map((sale) => (
              <div
                key={sale.id}
                className="flex justify-between items-center py-3 border-b"
              >
                <div>
                  <div className="font-medium text-sm">
                    {
                      sale.items.length
                    }{" "}
                    item(s)
                  </div>

                  <div className="text-xs text-slate-500">
                    {new Date(
                      sale.created_at
                    ).toLocaleString()}
                  </div>
                </div>

                <button
                  onClick={() =>
                    onResume(sale)
                  }
                  className="px-3 py-2 bg-blue-50 text-blue-700 rounded text-sm"
                >
                  Resume
                </button>
              </div>
            ))
          ) : (
            <div className="text-sm text-slate-500 text-center py-6">
              No held sales.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   TOAST
========================================================= */

function ToastAutoDismiss({
  onDone,
  timeoutMs = 10000,
  children,
}) {
  useEffect(() => {
    const timer = setTimeout(
      onDone,
      timeoutMs
    );

    return () =>
      clearTimeout(timer);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return children;
}

export default POS;