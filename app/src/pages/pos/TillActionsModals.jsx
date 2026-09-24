import { useEffect, useState } from "react";
import { Printer, Wallet, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

/*
 * Till actions — Misc Item, Petty Cash, Print.
 *
 * All three reuse EXISTING backend behaviour:
 *   - Misc Item   → lines travel with the normal sale payload (routes/sales.js
 *                   records them as item_type='MISC' on the same sale/receipt;
 *                   no product is created per transaction).
 *   - Petty Cash  → POST /api/till/sessions/:id/cash-movements (the existing
 *                   cash_in/cash_out mechanism; expected cash at close already
 *                   subtracts cash_out movements).
 *   - Print       → GET /api/sales/:id (existing sale detail) rendered through
 *                   the browser print dialog. Reprint only — no sale, stock or
 *                   payment changes.
 */

/* Overlay shared by the three modals (existing onePOS modal pattern). */
function ModalShell({ title, testId, onClose, children, wide = false }) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
    >
      <div className={`bg-white rounded-xl shadow-2xl w-full ${wide ? "w-[560px]" : "w-[420px]"} max-w-full`}>
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded hover:bg-slate-100 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* =========================================================
   MISC ITEM — manual-price sale line
========================================================= */

const MISC_VAT_OPTIONS = [
  { label: "Standard 20%", value: 0.2 },
  { label: "Reduced 5%", value: 0.05 },
  { label: "Zero 0%", value: 0 },
];

function MiscItemModal({ vatEnabled, vatRate, onClose, onAdd }) {
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [vatOption, setVatOption] = useState(() => {
    /* Pre-select the rate matching the till's configured VAT rate. */
    const match = MISC_VAT_OPTIONS.find((o) => Math.abs(o.value - Number(vatRate || 0)) < 0.0001);
    return match ? match.value : 0.2;
  });
  const [error, setError] = useState("");

  const submit = () => {
    setError("");

    const desc = description.trim();
    const priceNum = Number(price);
    const qtyNum = Number(quantity);

    if (!desc) {
      setError("Description is required.");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Price must be a number greater than zero.");
      return;
    }
    /* Currency precision: reject more than 2 decimal places. */
    if (Math.round(priceNum * 100) / 100 !== priceNum) {
      setError("Price can have at most 2 decimal places.");
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0 || Math.floor(qtyNum) !== qtyNum) {
      setError("Quantity must be a whole number greater than zero.");
      return;
    }

    onAdd({
      description: desc.slice(0, 255),
      price: priceNum,
      quantity: qtyNum,
      vatRate: vatEnabled ? vatOption : 0,
    });
  };

  return (
    <ModalShell title="Misc Item" testId="misc-item-modal" onClose={onClose}>
      <div className="p-4 space-y-3">
        <p className="text-xs text-slate-500">
          For a product that cannot be scanned or found. It is added to the current
          sale as a manual-price line and appears on the receipt and in reporting
          like any other item. No stock is changed.
        </p>

        <div>
          <label className="text-sm text-slate-600" htmlFor="misc-desc">Description</label>
          <input
            id="misc-desc"
            type="text"
            data-testid="misc-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Emergency item"
            maxLength={255}
            className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-600" htmlFor="misc-price">Price (£)</label>
            <input
              id="misc-price"
              type="number"
              step="0.01"
              min="0.01"
              data-testid="misc-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="text-sm text-slate-600" htmlFor="misc-qty">Quantity</label>
            <input
              id="misc-qty"
              type="number"
              step="1"
              min="1"
              data-testid="misc-qty"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-600" htmlFor="misc-vat">VAT rate</label>
          <select
            id="misc-vat"
            data-testid="misc-vat"
            value={vatOption}
            onChange={(e) => setVatOption(Number(e.target.value))}
            disabled={!vatEnabled}
            className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
          >
            {vatEnabled ? (
              MISC_VAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))
            ) : (
              <option value={0}>VAT is off for this till</option>
            )}
          </select>
        </div>

        {error && (
          <div data-testid="misc-error" className="px-3 py-2 bg-red-50 text-red-700 rounded text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 px-4 border border-slate-200 rounded text-sm">
          Cancel
        </button>
        <button
          type="button"
          data-testid="misc-add"
          onClick={submit}
          className="h-10 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium"
        >
          Add to Sale
        </button>
      </div>
    </ModalShell>
  );
}

/* =========================================================
   PETTY CASH — cash drawer pay out
========================================================= */

const PETTY_CASH_REASONS = [
  "Cleaning supplies",
  "Staff refreshments",
  "Delivery/parking",
  "Stationery",
  "Repairs",
  "Other",
];

function PettyCashModal({ onClose, onRecorded }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState(PETTY_CASH_REASONS[0]);
  const [customReason, setCustomReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");

    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Amount must be a number greater than zero.");
      return;
    }
    if (Math.round(amountNum * 100) / 100 !== amountNum) {
      setError("Amount can have at most 2 decimal places.");
      return;
    }

    const finalReason =
      reason === "Other" ? customReason.trim() : reason;

    if (!finalReason) {
      setError("Please enter a reason.");
      return;
    }

    setSubmitting(true);
    try {
      const current = await apiRequest("/api/till/sessions/current");
      const session = current.success ? current.data : null;

      if (!session?.id) {
        throw new Error("No open till session. Open a till before recording petty cash.");
      }

      const data = await apiRequest(`/api/till/sessions/${session.id}/cash-movements`, {
        method: "POST",
        body: JSON.stringify({
          type: "cash_out",
          amount: amountNum,
          reason: `Petty cash: ${finalReason}`.slice(0, 255),
        }),
      });

      if (!data.success) {
        throw new Error(data.message || "Unable to record petty cash");
      }

      onRecorded(data.data);
    } catch (err) {
      setError(err.message || "Unable to record petty cash");
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Petty Cash" testId="petty-cash-modal" onClose={onClose}>
      <div className="p-4 space-y-3">
        <p className="text-xs text-slate-500">
          Records money taken from the cash drawer for a business expense. It is
          stored as a cash-out movement on the current till session, reduces the
          expected cash at close, and appears in the till's cash history.
        </p>

        <div>
          <label className="text-sm text-slate-600" htmlFor="petty-amount">Amount (£)</label>
          <input
            id="petty-amount"
            type="number"
            step="0.01"
            min="0.01"
            data-testid="petty-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-sm text-slate-600" htmlFor="petty-reason">Reason</label>
          <select
            id="petty-reason"
            data-testid="petty-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
          >
            {PETTY_CASH_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        {reason === "Other" && (
          <div>
            <label className="text-sm text-slate-600" htmlFor="petty-custom">Custom reason</label>
            <input
              id="petty-custom"
              type="text"
              data-testid="petty-custom"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              maxLength={200}
              className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {error && (
          <div data-testid="petty-error" className="px-3 py-2 bg-red-50 text-red-700 rounded text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 px-4 border border-slate-200 rounded text-sm">
          Cancel
        </button>
        <button
          type="button"
          data-testid="petty-record"
          onClick={submit}
          disabled={submitting}
          className="h-10 px-4 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white rounded text-sm font-medium flex items-center gap-2"
        >
          <Wallet size={15} />
          Record Pay Out
        </button>
      </div>
    </ModalShell>
  );
}

/* =========================================================
   PRINT — reprint receipt from existing sale data
========================================================= */

function PrintReceiptModal({ lastSale, onClose }) {
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      /* Offline sale: only the provisional receipt is known. */
      if (!lastSale?.id) {
        setSale({
          receipt_number: lastSale?.receiptNumber || null,
          total: lastSale?.total ?? null,
          offline: true,
          items: [],
        });
        return;
      }

      setLoading(true);
      setError("");
      try {
        const data = await apiRequest(`/api/sales/${lastSale.id}`);
        if (!data.success) throw new Error(data.message || "Unable to load sale");
        if (!cancelled) setSale(data.data);
      } catch (err) {
        if (!cancelled) setError(err.message || "Unable to load sale");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [lastSale]);

  const print = () => {
    /* Browser printing is the app's existing print mechanism. */
    window.print();
  };

  const money = (value) => `£${(Number(value) || 0).toFixed(2)}`;

  return (
    <ModalShell title="Receipt" testId="print-receipt-modal" onClose={onClose} wide>
      <div className="p-4">
        {error && (
          <div className="px-3 py-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>
        )}

        {loading && <div className="text-sm text-slate-500 py-6 text-center">Loading receipt…</div>}

        {sale && !loading && (
          <div
            data-testid="receipt-paper"
            className="print-area border border-slate-200 rounded-lg p-4 font-mono text-[13px] leading-6 bg-white"
          >
            <div className="text-center font-bold text-[15px]">{sale.store_name || "onePOS Receipt"}</div>
            {(sale.address_line1 || sale.store_phone) && (
              <div className="text-center text-slate-500">{sale.address_line1 || ""}{sale.store_phone ? ` · ${sale.store_phone}` : ""}</div>
            )}
            {sale.receipt_number && (
              <div className="text-center" data-testid="receipt-number">Receipt {sale.receipt_number}</div>
            )}
            {sale.offline && (
              <div className="text-center text-slate-500">(offline copy — pending sync; not yet confirmed by the server)</div>
            )}
            <div className="text-center text-slate-500">
              {sale.created_at ? new Date(sale.created_at).toLocaleString() : ""}
              {sale.terminal_name ? ` · ${sale.terminal_name}` : ""}
              {sale.cashier ? ` · ${sale.cashier}` : ""}
            </div>
            {sale.customer_name && <div data-testid="receipt-customer" className="text-center">{sale.customer_name}{sale.customer_phone ? ` · ${sale.customer_phone}` : ""}</div>}
            <div className="my-2 border-t border-dashed border-slate-300" />

            {(sale.items || []).map((item) => (
              <div key={item.id} className="flex justify-between">
                <span className="truncate mr-2">
                  {item.product_name} × {Number(item.quantity)} @ ${money(item.unit_price)}
                </span>
                <span>{money(item.total)}</span>
              </div>
            ))}

            <div className="my-2 border-t border-dashed border-slate-300" />
            {sale.subtotal !== undefined && (
              <div className="flex justify-between"><span>Subtotal</span><span>{money(sale.subtotal)}</span></div>
            )}
            {sale.tax !== undefined && (
              <div className="flex justify-between"><span>VAT</span><span>{money(sale.tax)}</span></div>
            )}
            {Number(sale.discount) > 0 && (
              <div className="flex justify-between"><span>Discount</span><span>-{money(sale.discount)}</span></div>
            )}
            {sale.total !== undefined && (
              <div className="flex justify-between font-bold"><span>TOTAL</span><span>{money(sale.total)}</span></div>
            )}
            {sale.payment_method && (
              <div className="flex justify-between text-slate-500">
                <span>Payment</span><span>{String(sale.payment_method).toUpperCase()}</span>
              </div>
            )}
            <div className="mt-2 text-center text-slate-500">Thank you for shopping with us</div>
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="h-10 px-4 border border-slate-200 rounded text-sm">
          Close
        </button>
        <button
          type="button"
          data-testid="print-confirm"
          onClick={print}
          disabled={!sale || loading}
          className="h-10 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded text-sm font-medium flex items-center gap-2"
        >
          <Printer size={15} />
          Print
        </button>
      </div>
    </ModalShell>
  );
}

export { MiscItemModal, PettyCashModal, PrintReceiptModal };
