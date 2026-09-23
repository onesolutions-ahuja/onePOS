import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Percent, ShoppingBag, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import {
  isNetworkError,
  isOnline,
  reportConnection,
} from "../../services/networkStatus.js";
import {
  checkNow,
  startConnectivityMonitoring,
  stopConnectivityMonitoring,
  subscribeConnectivity,
} from "../../services/connectivity.js";
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
import ProductGrid from "./ProductGrid.jsx";
import MobileCartSheet from "./MobileCartSheet.jsx";
import PaymentModal from "./PaymentModal.jsx";
import CustomerSelectorModal from "./CustomerSelectorModal.jsx";
import { MiscItemModal, PettyCashModal, PrintReceiptModal } from "./TillActionsModals.jsx";

function ModifierPickerModal({ product, groups, onClose, onConfirm }) {
  const [selected, setSelected] = useState([]);
  const toggle = (group, option) => {
    setSelected((current) => {
      const sameGroup = current.filter((id) => group.options.some((entry) => entry.id === id));
      const exists = sameGroup.includes(option.id);
      if (exists) return current.filter((id) => id !== option.id);
      if (group.maxSelections <= 1) {
        return [...current.filter((id) => !sameGroup.includes(id)), option.id];
      }
      if (sameGroup.length >= group.maxSelections) return current;
      return [...current, option.id];
    });
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-md">
        <h2 className="font-semibold mb-1">{product.name}</h2>
        <p className="text-xs text-slate-500 mb-4">Choose options</p>
        {groups.map((group) => (
          <div key={group.id} className="mb-4">
            <div className="text-sm font-medium mb-2">{group.name}</div>
            <div className="space-y-1">
              {group.options.map((option) => (
                <label key={option.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <input
                      type={group.maxSelections > 1 ? "checkbox" : "radio"}
                      name={`modifier-${group.id}`}
                      checked={selected.includes(option.id)}
                      onChange={() => toggle(group, option)}
                    />
                    {option.name}
                  </span>
                  <span>{Number(option.price) > 0 ? `+£${Number(option.price).toFixed(2)}` : "Free"}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm border rounded-lg">Cancel</button>
          <button onClick={() => onConfirm(selected.map((optionId) => ({ optionId })))} className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg">Add</button>
        </div>
      </div>
    </div>
  );
}
/*
 * JARVES remains the existing components/jarvis/JarvisOrb.jsx and
 * components/jarvis/JarvisPanel.jsx interaction surface, but is mounted once
 * by App through JarvisCorner so it survives page navigation.
 */

/* =========================================================
   POS / TILL
========================================================= */

function POS({
  onAdmin,
  onSettings,
  onOpenOnlineOrders,
  onLogout,
}) {
  const [category, setCategory] = useState("All");
  const [productView, setProductView] = useState("image"); // till product browser presentation
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
  const [permissions, setPermissions] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [heldSales, setHeldSales] = useState([]);
  const [showHeldSales, setShowHeldSales] = useState(false);
  /* Cash completion popup: shows the change to return to the customer. */
  const [saleCompleteNotice, setSaleCompleteNotice] = useState(null);
  const [modifierPicker, setModifierPicker] = useState(null);

  /*
   * Till actions: Misc Item (manual-price sale line), Petty Cash (cash-drawer
   * pay out via the existing cash-movement API) and Print (reprint the last
   * completed receipt through the same receipt data). All reuse existing
   * backend behaviour — no second sale/cash system.
   */
  const [showMiscItem, setShowMiscItem] = useState(false);
  const [showPettyCash, setShowPettyCash] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [lastSale, setLastSale] = useState(null);

  /*
   * Till Misc Item lines collected via the Misc Item modal. They live in
   * their own state (NOT the product basket) until checkout, when they are
   * sent alongside the basket and become real item_type='MISC' sale lines
   * on the same sale/receipt. Cleared whenever the basket is cleared.
   *
   * Declared here, with the rest of the Till-action state, because the money
   * totals further down read it during render. A `const` read earlier in the
   * body than its own declaration is in its temporal dead zone and throws
   * "Cannot access '...' before initialization".
   */
  const [miscLines, setMiscLines] = useState([]);

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
   * T10U — Allow Negative Inventory Billing. Read from the existing
   * company settings payload; when ON, the till no longer blocks adding
   * or increasing quantities beyond recorded stock at the CLIENT side —
   * the pre-flight warning + the authoritative server-side check inside
   * the sale transaction become the enforcement points instead.
   */
  const [allowNegativeBilling, setAllowNegativeBilling] = useState(false);

  /*
   * Customer Display (second monitor) moved to Settings: the company-level
   * switch lives in Settings → Store & Till (it controls whether the till
   * offers the Open Customer Display action) — the till header has no
   * Customer Display button.
   */

  /* Bill mirror for /customer-display (a separate browser window on the
   * second monitor, NOT this document): the till ALWAYS broadcasts its
   * live basket/totals on a local BroadcastChannel — no server involved,
   * so the mirror works identically online AND offline. The customer page
   * only listens. The broadcast effect sits below the TOTALS block — its
   * dependency array is evaluated during render and must not reference
   * the totals before their declaration (TDZ). */
  const billChannelRef = useRef(null);
  useEffect(() => {
    if (typeof BroadcastChannel !== "function") return undefined;
    billChannelRef.current = new BroadcastChannel("onepos-customer-display");
    return () => {
      try { billChannelRef.current?.close(); } catch { /* already closed */ }
      billChannelRef.current = null;
    };
  }, []);

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

      if (error.code === "AUTH_REQUIRED") {
        onLogout();
      }
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
  /* Set when the cashier acknowledges the insufficient-stock warning, so the
     pre-flight check inside completeSale does not re-show it. */
  const stockWarningAck = useRef(false);

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

      if (error.code === "AUTH_REQUIRED") {
        onLogout();
        return;
      }

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

      if (error.code === "AUTH_REQUIRED") {
        onLogout();
        return;
      }

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

    let cancelled = false;
    apiRequest("/api/auth/me/permissions", {
      signal: AbortSignal.timeout(10000),
    })
      .then((p) => {
        if (cancelled) return;
        if (p.success) {
          setPermissions(p.data?.permissions || []);
          setIsAdmin(p.data?.isAdmin || false);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (error.code === "AUTH_REQUIRED") {
          onLogout();
          return;
        }
        if (isNetworkError(error)) {
          const session = loadOfflineSession();
          if (session?.permissions) {
            setPermissions(session.permissions.permissions || []);
            setIsAdmin(!!session.permissions.isAdmin);
          }
        }
      });

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

        /* T10U: honour Allow Negative Inventory Billing from company settings. */
        if (data.success && data.data?.inventory) {
          setAllowNegativeBilling(
            data.data.inventory.allowNegativeInventoryBilling === true
          );
        }


        /*
         * Till product view setting ("image" | "compact", default "image")
         * — presentation only; sale behaviour is unaffected.
         */
 if (data.success && data.data?.till) {
          setProductView(
            data.data.till.productView === "compact" ? "compact" : "image"
          );
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

        if (error.code === "AUTH_REQUIRED") {
          onLogout();
          return;
        }

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

          /* Cached settings keep till behaviour consistent while offline. */
          if (cached?.inventory) {
            setAllowNegativeBilling(
              cached.inventory.allowNegativeInventoryBilling === true
            );
          }

          if (cached?.till) {
            setProductView(
              cached.till.productView === "compact" ? "compact" : "image"
            );
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

    /* ONE authoritative connectivity source: POS state, the header icon and
     * the offline-queue engine all follow services/connectivity.js. Its
     * health probe feeds the queue's binary contract via reportConnection,
     * so a reachable server can never show as OFFLINE just because the
     * browser's navigator.onLine momentarily reports false. */
    const unsubscribeConnectivity = subscribeConnectivity((snapshot) => {
      setOnline(snapshot.server === "connected");
    });
    startConnectivityMonitoring({ intervalMs: 30000 });
    void checkNow();

    const stopSync = startAutoSync();

    return () => {
      stopSync();
      unsubscribe();
      unsubscribeConnectivity();
      stopConnectivityMonitoring();
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

  const addLine = (product, modifiers = []) => {
    /* T10U: when Allow Negative Inventory Billing is ON, stock is no longer
       capped here — the checkout pre-flight warning plus the authoritative
       server-side check inside the sale transaction take over. */
    const stockLimit =
      !allowNegativeBilling &&
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
          modifiers,
        },
      ];
    });
  };

  const add = async (product) => {
    try {
      const response = await apiRequest(`/api/products/${product.id}/modifiers`);
      const rows = response?.success && Array.isArray(response.data) ? response.data : [];
      const groups = [...new Map(rows.map((row) => [row.group_id, row])).values()].map((row) => ({
        id: row.group_id,
        name: row.group_name,
        required: row.required === true,
        maxSelections: Number(row.max_selections) || 1,
        options: rows.filter((option) => option.group_id === row.group_id && option.id),
      }));
      if (groups.length) {
        setModifierPicker({ product, groups });
      } else {
        addLine(product);
      }
    } catch {
      addLine(product);
    }
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

    /* T10U: same as add() — the cap only applies when negative billing
       is disabled; the checkout warning + server check handle the rest. */
    const stockLimit =
      !allowNegativeBilling &&
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

  /* T10-PRICE: manual price override (sale.price_change). The override applies
     only to this basket line; the catalogue price is preserved (the backend
     re-validates the permission and authoritative price). */
  const applyPriceOverride = (item, newPrice, reason) => {
    if (!(isAdmin || permissions.includes("sale.price_change"))) {
      setSaleError(
        "You do not have permission to change prices."
      );
      return;
    }
    const numeric = Number(newPrice);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    setBasket((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              price: numeric,
              priceOverride: numeric,
              priceOverrideReason: reason || null,
            }
          : entry
      )
    );
  };

  const removeMiscLine = (index) =>
    setMiscLines((current) =>
      current.filter((_line, i) => i !== index)
    );

  /* =========================================================
     TOTALS
  ========================================================= */

  /* Misc Item lines join the money totals but are NOT product-basket rows:
     they have no stock, no category and no per-line discount. Gross is
     price × quantity; VAT uses the chosen per-line rate under the same
     global VAT master switch as ordinary lines. */
  const miscGross = miscLines.reduce(
    (sum, line) =>
      sum + Number(line.price || 0) * Number(line.quantity || 0),
    0
  );
  const miscVat = vatEnabled
    ? miscLines.reduce(
        (sum, line) =>
          sum +
          Number(line.price || 0) *
            Number(line.quantity || 0) *
            Number(line.vatRate || 0),
        0
      )
    : 0;

  const {
    grossSubtotal,
    discountAmount,
    subtotal: productSubtotal,
    vat: productVat,
    total: productTotal,
  } = computeBasketTotals(basket, {
    vatEnabled,
    vatRate,
    discountType,
    discountValue,
  });

  const subtotal = productSubtotal + miscGross;
  const vat = productVat + miscVat;
  const total = subtotal + vat;
  const grossSubtotalWithMisc = grossSubtotal + miscGross;

  /* Bill broadcast — placed AFTER the totals declaration (see note above).
   * ALWAYS on: /customer-display (second monitor) shows exactly what the
   * cashier sees — items, quantities, totals — online or offline. A 2s
   * heartbeat re-sends the current bill so a display window opened mid-sale
   * picks it up immediately (BroadcastChannel does not replay to late
   * joiners). No gating: the mirror carries only what the customer at the
   * till can already read on the screen. */
  useEffect(() => {
    if (!billChannelRef.current) return undefined;
    const payload = {
      type: "BILL",
      basket,
      subtotal,
      vat,
      total,
      discountAmount,
      hasDiscount: discountType !== null && discountValue > 0,
      hasCustomer: Boolean(selectedCustomer),
      storeName,
    };
    billChannelRef.current.postMessage(payload);
    const heartbeat = window.setInterval(() => {
      try { billChannelRef.current?.postMessage(payload); } catch { /* channel closing */ }
    }, 2000);
    return () => window.clearInterval(heartbeat);
  }, [basket, subtotal, vat, total, discountAmount, discountType, discountValue, selectedCustomer, storeName]);

  /* =========================================================
     DISCOUNT
  ========================================================= */

  const canApplyDiscount = isAdmin || permissions.includes("sale.discount");

  const applyDiscount = (
    type,
    value
  ) => {
    if (!canApplyDiscount) {
      setSaleError(
        "You do not have permission to apply discounts."
      );
      return;
    }

    const numericValue = Number(value);

    if (
      !Number.isFinite(numericValue) ||
      numericValue < 0 ||
      (type === "percent" &&
        numericValue > 100) ||
      (type === "amount" &&
        numericValue > grossSubtotalWithMisc)
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
        : type === "amount"
          ? "fixed"
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

    /* Held sales live server-side — holding offline would silently lose the
       snapshot. Refuse explicitly and keep the basket intact. */
    if (!isOnline()) {
      setSaleError(
        "Hold Sale requires a connection to the onePOS server. Reconnect and try again — your current sale is unchanged."
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
            miscLines,
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
      setMiscLines([]);
      setSelectedCustomer(null);
      setDiscountType(null);
      setDiscountValue(0);
      setSaleMessage(
        "Sale held successfully."
      );
    } catch (error) {
      if (error.code === "AUTH_REQUIRED") {
        onLogout();
        return;
      }

      setSaleError(
        error.message ||
          "Unable to hold sale"
      );
    }
  };

  const loadHeldSales = async ({ storeScope = false } = {}) => {
    /* The list lives server-side — going online-only keeps the hold store
       authoritative and avoids divergent local copies. */
    if (!isOnline()) {
      setSaleError(
        "Resume Held Sale requires a connection to the onePOS server. Reconnect and try again."
      );

      return;
    }

    try {
      const data =
        await apiRequest(
          storeScope
            ? "/api/held-sales?scope=store"
            : "/api/held-sales"
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
      if (error.code === "AUTH_REQUIRED") {
        onLogout();
        return;
      }

      setSaleError(
        error.message ||
          "Unable to load held sales"
      );
    }
  };

  /* Resume = ATOMIC server-side claim (POST /:id/resume). The hold is
     removed and returned in one request, so a second tab/click gets 404
     and must not restore anything. The basket is only touched after a
     successful claim. */
  const resumeSale = async (heldSaleId) => {
    try {
      const data = await apiRequest(
        `/api/held-sales/${heldSaleId}/resume`,
        { method: "POST", body: JSON.stringify({}) }
      );

      if (!data.success) {
        if (data?.data?.alreadyResumed) {
          setSaleMessage(
            "That held sale was already resumed elsewhere."
          );
        } else {
          setSaleError(
            data.message || "Unable to resume held sale"
          );
        }
        setShowHeldSales(false);
        await loadHeldSales();
        return;
      }

      const heldSale = data.data;

      setBasket(
        heldSale.items || []
      );

      /* Held Misc Item lines: items is { items, miscLines } since the Till
         Misc Item task; older holds stored a plain array. */
      if (Array.isArray(heldSale.items)) {
        setMiscLines([]);
      } else if (heldSale.items && Array.isArray(heldSale.items.miscLines)) {
        setBasket(heldSale.items.items || []);
        setMiscLines(heldSale.items.miscLines);
      }

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
          const customerData =
            await apiRequest(
              `/api/customers/${heldSale.customer_id}`
            );

          if (customerData.success) {
            setSelectedCustomer(
              customerData.data
            );
          }
        } catch (error) {
          if (error.code === "AUTH_REQUIRED") {
            onLogout();
            return;
          }

          setSaleError(
            error.message ||
              "Unable to restore customer"
          );
        }
      }
    } catch (error) {
      if (error.code === "AUTH_REQUIRED") {
        onLogout();
        return;
      }

      setSaleError(
        error.message ||
          "Unable to resume held sale"
      );
    }
  };

  /* =========================================================
     COMPLETE SALE
  ========================================================= */

  const addMiscLine = (line) => {
    setMiscLines((current) => [
      ...current,
      {
        description: line.description,
        price: line.price,
        quantity: line.quantity,
        vatRate: line.vatRate,
      },
    ]);
  };

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

    /* The warning modal is part of the enabled flow (T10U): when the
       setting is OFF the client cap above prevents shortfalls, and any
       drift (stale stock data) is rejected authoritatively by the server. */
    if (stockShortfalls.length > 0 && allowNegativeBilling && !options.skipStockWarning && !stockWarningAck.current) {
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
          /* T10-PRICE: override proposal (server re-validates permission +
             catalogue price; ignored when sale.price_change is absent). */
          ...(item.priceOverride
            ? {
                priceOverride: item.priceOverride,
                priceOverrideReason:
                  item.priceOverrideReason || null,
              }
            : {}),
        };
      }),

      customerId:
        selectedCustomer?.id ||
        null,

      /* Till Misc Item lines: real sale lines the cashier typed by hand —
         description, price, quantity and the VAT rate chosen from the
         existing settings. The backend re-validates and re-computes the
         money values; these carry only what the operator entered. */
      miscLines: miscLines.map((line) => ({
        description: line.description,
        price: line.price,
        quantity: line.quantity,
        vatRate: line.vatRate,
      })),

       vatEnabled,
       vatRate,

       subtotal,
      tax: vat,
      discount: discountAmount,
      total,
      paymentMethod,

      /* T10-DISCOUNT: order-level discount proposal for server-side revalidation.
         The server recomputes all totals from authoritative prices and only
         applies the order discount when the operator holds sale.discount. */
      discountType,
      discountValue,

      /* Split tender: the per-method lines from PaymentModal. Undefined for
         single-tender sales, so the wire contract is unchanged for them. */
      payments: options.payments,

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
      setMiscLines([]);
      setSelectedCustomer(null);
      setShowPayment(false);
      stockWarningAck.current = false;

      setSaleMessage(
        data.sale?.receipt_number
          ? `Sale completed — Receipt ${data.sale.receipt_number}`
          : "Sale completed successfully."
      );

      /* Till Print action: remember the completed sale so the cashier can
         reprint the receipt without creating a duplicate sale. */
      if (data.sale?.id) {
        setLastSale({
          id: data.sale.id,
          receiptNumber: data.sale.receipt_number || null,
          total: data.sale.total ?? total,
          offline: false,
        });
      }

      /* Cash flow: popup telling the cashier how much to return. */
      if (paymentMethod === "cash") {
        const received = Number(options.cashReceived) || 0;
        const changeDue = Math.max(0, received - total);
        setSaleCompleteNotice({
          total,
          received: received > 0 ? received : null,
          change: received > total ? changeDue : 0,
          receiptNumber: data.sale?.receipt_number || null,
        });
      }

      await loadProducts();

      syncOfflineQueue();
    } catch (error) {
      if (
        error.code === "AUTH_REQUIRED"
      ) {
        setSaleError(error.message || "Session expired — please sign in again.");
        return;
      }

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
      setMiscLines([]);
          setSelectedCustomer(null);
          setShowPayment(false);
          stockWarningAck.current = false;

          /* Offline sale: the queued entry carries the provisional receipt —
             remember it so Print can reprint it like any other receipt. */
          if (queued.entry?.provisionalReceipt) {
            setLastSale({
              id: null,
              receiptNumber: queued.entry.provisionalReceipt,
              total,
              offline: true,
            });
          }

          setSaleMessage(
            queued.entry
              ?.provisionalReceipt
              ? `Pending sync — ${queued.entry.provisionalReceipt}. Stock is adjusted only after backend synchronization.`
              : "Sale saved locally — Pending sync. Stock is adjusted after synchronization."
          );

          if (paymentMethod === "cash") {
            const received = Number(options.cashReceived) || 0;
            setSaleCompleteNotice({
              total,
              received: received > 0 ? received : null,
              change: received > total ? Math.max(0, received - total) : 0,
              receiptNumber: queued.entry?.provisionalReceipt || null,
              pendingSync: true,
            });
          }

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
      setMiscLines([]);
        setSelectedCustomer(null);
        setDiscountType(null);
        setDiscountValue(0);
        setShowPayment(false);
        stockWarningAck.current = false;
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

  /* Open the payment view — but if stock is short and the company allows
     negative billing, surface the Insufficient Inventory warning BEFORE
     payment opens (Continue here resumes into the payment view). */
  const openPayment = () => {
    const stockShortfalls = basket
      .filter((item) => item.trackStock === true)
      .filter((item) => Number(item.stock || 0) < Number(item.quantity || 0))
      .map((item) => ({
        name: item.name,
        recordedStock: Number(item.stock || 0),
        requestedQuantity: Number(item.quantity || 0),
      }));

    if (stockShortfalls.length > 0 && allowNegativeBilling) {
      stockWarningAck.current = true;
      setNegativeStockNotice({ lines: stockShortfalls, paymentMethod: null });
      return;
    }

    setShowPayment(true);
  };

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="h-[100dvh] bg-slate-100 flex flex-col overflow-hidden">

      <POSHeader
        loadingTill={loadingTill}
        till={till}
        onManageTill={() =>
          setShowTill(true)
        }
        onAdmin={onAdmin}
        onSettings={isAdmin || permissions.includes("settings.manage") ? onSettings : null}
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

      />


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
          productView={productView}
        >
          {/* Till action bar — 8 buttons do not fit side by side below the
              till tier, so the row wraps on tablet/phone instead of being
              clipped by the root overflow-hidden. Same handlers, same order. */}
          <div className="min-h-[58px] bg-white border border-slate-200 rounded-md mt-3 px-2 py-1.5 flex flex-wrap items-center gap-2">

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
               onClick={() => setShowDiscount(true)}
               disabled={!canApplyDiscount}
               title={canApplyDiscount ? "Apply discount" : "Discounts require the sale.discount permission"}
               className="h-10 px-4 border border-slate-200 rounded text-sm disabled:opacity-50"
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

            {/* Till Misc Item: manual-price sale line for products that
                cannot be scanned/found — goes through the normal sale
                engine, receipt and reporting. */}
            <button
              type="button"
              data-testid="misc-item-button"
              onClick={() => setShowMiscItem(true)}
              className="h-10 px-4 border border-slate-200 rounded text-sm"
            >
              Misc Item
            </button>

            {/* Petty Cash: records money taken from the drawer for business
                expenses through the existing cash-movement API. */}
            <button
              type="button"
              data-testid="petty-cash-button"
              onClick={() => setShowPettyCash(true)}
              className="h-10 px-4 border border-slate-200 rounded text-sm"
            >
              Petty Cash
            </button>

            {/* Print: reprint the last completed receipt. No duplicate sale,
                no stock/payment change — the receipt renders from existing
                sale data. */}
            <button
              type="button"
              data-testid="print-button"
              onClick={() => setShowPrint(true)}
              disabled={!lastSale}
              className="h-10 px-4 border border-slate-200 rounded text-sm disabled:opacity-50"
            >
              Print
            </button>
          </div>
        </ProductGrid>

        {/* Cart tier: the 350px fixed column survives only from md/768px up.
            Below it the identical cart contract renders as a bottom summary
            bar + expandable sheet (MobileCartSheet) so the till fits a phone
            viewport without a second fixed pane. Business logic, handlers
            and sale flow are shared — only the container differs. */}
        <div className="hidden md:flex h-full min-h-0">
          <CartPanel
            basket={basket}
          miscLines={miscLines}
          onRemoveMiscLine={removeMiscLine}
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
           onPriceOverride={applyPriceOverride}
           canPriceOverride={isAdmin || permissions.includes("sale.price_change")}
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

            openPayment();
          }}
          />
        </div>
      </div>

      {/* Phone tier (<md): same cart contract as the desktop CartPanel —
          identical handlers, line markup and checkout flow — as a bottom
          summary bar + expandable sheet. POS renders exactly one cart per
          viewport tier, so no duplicated state or behaviour. */}
      <MobileCartSheet
        basket={basket}
        miscLines={miscLines}
        onRemoveMiscLine={removeMiscLine}
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
        itemCount={basket.length + miscLines.length}
        onCheckout={() => {
          if (basketHasAgeRestricted && !ageVerifiedThisSale) {
            setShowAgeModal(true);
            return;
          }
          openPayment();
        }}
      />

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
            openPayment();
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
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
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
                  const notice = negativeStockNotice;
                  setNegativeStockNotice(null);
                  if (notice.paymentMethod) {
                    completeSale(notice.paymentMethod, { skipStockWarning: true });
                  } else {
                    /* Warning was shown before payment opened — resume into payment. */
                    stockWarningAck.current = true;
                    setShowPayment(true);
                  }
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
          onComplete={(method, opts) =>
            completeSale(method, opts || {})
          }
          onCard={() =>
            completeSale("card")
          }
        />
      )}

      {saleCompleteNotice && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
          role="alertdialog"
          aria-modal="true"
          aria-label="Sale complete"
        >
          <div className="bg-white rounded-xl w-[380px] max-w-[90vw] shadow-2xl p-6 text-center">
            <div className="text-sm font-medium text-green-700">
              {saleCompleteNotice.pendingSync
                ? "Sale saved — pending sync"
                : "Transaction complete"}
            </div>

            {saleCompleteNotice.receiptNumber && (
              <div className="text-xs text-slate-500 mt-1">
                Receipt {saleCompleteNotice.receiptNumber}
              </div>
            )}

            {saleCompleteNotice.received !== null && (
              <div className="mt-4 space-y-1 text-sm text-slate-600">
                <div className="flex justify-between">
                  <span>Total</span>
                  <span>£{saleCompleteNotice.total.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Cash received</span>
                  <span>£{saleCompleteNotice.received.toFixed(2)}</span>
                </div>
              </div>
            )}

            {saleCompleteNotice.change > 0 ? (
              <>
                <div className="text-sm text-slate-500 mt-4">Return to customer</div>
                <div className="text-5xl font-bold text-green-700 mt-1">
                  £{saleCompleteNotice.change.toFixed(2)}
                </div>
              </>
            ) : (
              <div className="text-2xl font-bold text-slate-800 mt-4">
                {saleCompleteNotice.received !== null
                  ? "Exact amount — no change due"
                  : "Thank you"}
              </div>
            )}

            <button
              type="button"
              onClick={() => setSaleCompleteNotice(null)}
              className="mt-6 w-full h-11 bg-blue-600 text-white rounded-lg font-medium"
            >
              OK
            </button>
          </div>
        </div>
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
          subtotal={grossSubtotalWithMisc}
          onClose={() =>
            setShowDiscount(false)
          }
          onApply={applyDiscount}
        />
      )}

      {showHeldSales && (
        <HeldSalesModal
          sales={heldSales}
          currentUserId={getTenantFromToken()?.userId || null}
          onRefresh={loadHeldSales}
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

      {modifierPicker && (
        <ModifierPickerModal
          product={modifierPicker.product}
          groups={modifierPicker.groups}
          onClose={() => setModifierPicker(null)}
          onConfirm={(modifiers) => {
            addLine(modifierPicker.product, modifiers);
            setModifierPicker(null);
          }}
        />
      )}

      {showMiscItem && (
        <MiscItemModal
          vatEnabled={vatEnabled}
          vatRate={vatRate}
          onClose={() => setShowMiscItem(false)}
          onAdd={(line) => {
            setBasket((current) => [...current, line]);
            setShowMiscItem(false);
          }}
        />
      )}

      {showPettyCash && (
        <PettyCashModal
          onClose={() => setShowPettyCash(false)}
          onRecorded={(movement) => {
            setShowPettyCash(false);
            setSaleMessage(
              `Petty cash recorded — £${Number(movement.amount).toFixed(2)} out of the till`
            );
            loadCurrentTill();
          }}
        />
      )}

      {showPrint && (
        <PrintReceiptModal
          lastSale={lastSale}
          onClose={() => setShowPrint(false)}
        />
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
  currentUserId,
  onRefresh,
  onClose,
  onResume,
}) {
  const [storeScope, setStoreScope] = useState(false);

  /* Item count across both hold shapes ({items, miscLines} and legacy
     plain array). */
  const lineCount = (sale) => {
    if (Array.isArray(sale.items)) return sale.items.length;
    if (sale.items && Array.isArray(sale.items.items)) {
      return sale.items.items.length + (sale.items.miscLines?.length || 0);
    }
    return 0;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[560px] max-w-full">
        <div className="p-4 border-b flex justify-between items-center">
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

        <div className="px-4 pt-3 flex items-center justify-between text-xs">
          <button
            onClick={() => {
              const next = !storeScope;
              setStoreScope(next);
              if (onRefresh) onRefresh({ storeScope: next });
            }}
            className={`h-8 px-3 border rounded ${storeScope ? "bg-blue-50 border-blue-300 text-blue-700" : "border-slate-200 text-slate-600"}`}
          >
            {storeScope ? "Showing: whole store" : "Showing: my holds"}
          </button>
          {storeScope && (
            <span className="text-slate-400">
              Resuming another cashier's hold claims it atomically
            </span>
          )}
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
                    {lineCount(sale)} item(s)
                    {sale.customer_name ? (
                      <span className="text-slate-500 font-normal"> · {sale.customer_name}</span>
                    ) : null}
                    {currentUserId && sale.user_id && sale.user_id !== currentUserId && (
                      <span className="ml-2 text-[10px] uppercase bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                        {sale.user_name || "other cashier"}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-slate-500">
                    {new Date(
                      sale.created_at
                    ).toLocaleString()}
                    {sale.notes ? ` · ${String(sale.notes).slice(0, 60)}` : ""}
                  </div>
                </div>

                <button
                  onClick={() =>
                    onResume(sale.id)
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