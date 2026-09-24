import { useState } from "react";
import { ChevronUp, CreditCard, Receipt, ShoppingCart, X } from "lucide-react";

/*
 * Phone-tier cart (viewport < md / 768px) — PRESENTATION ONLY.
 *
 * On phones the 350px fixed cart column cannot fit beside the product grid,
 * so the cart becomes a collapsed bottom summary bar (items + total + direct
 * PAYMENT shortcut) that expands into a bottom sheet holding the SAME sale
 * lines, quantities, customer row and totals as the desktop CartPanel.
 *
 * Every prop is the exact CartPanel contract — the same handlers, the same
 * line markup, the same data-testids — so no cart behaviour, state or API
 * flow changes. POS renders either <CartPanel/> (md+) or this component
 * (<md), never both, so ids/testids stay unique.
 */
export default function MobileCartSheet({
  basket,
  miscLines = [],
  onRemoveMiscLine,
  selectedCustomer,
  onCustomerClick,
  onCustomerRemove,
  saleError,
  saleMessage,
  onIncrease,
  onDecrease,
  onUpdateQuantity,
  onRemoveItem,
  subtotal,
  vat,
  total,
  onCheckout,
  itemCount = 0,
}) {
  const [open, setOpen] = useState(false);
  const nothingToPay = basket.length === 0 && miscLines.length === 0;

  const handleCheckout = () => {
    /* The payment modal is a fixed full-screen overlay rendered later in the
     * POS tree; closing the sheet first keeps the stack unambiguous. */
    setOpen(false);
    onCheckout();
  };

  return (
    <>
      {/* -------------------------------------------- collapsed summary bar */}
      <div className="md:hidden border-t border-slate-200 bg-white shrink-0">
        {saleError && (
          <div className="px-3 pt-2">
            <div className="px-2 py-1.5 bg-red-50 text-red-700 rounded text-xs truncate">{saleError}</div>
          </div>
        )}
        {saleMessage && (
          <div className="px-3 pt-2">
            <div className="px-2 py-1.5 bg-emerald-50 text-emerald-700 rounded text-xs truncate">{saleMessage}</div>
          </div>
        )}

        <div className="flex items-stretch">
          <button
            onClick={() => setOpen(true)}
            className="flex-1 min-w-0 h-14 px-4 flex items-center justify-between gap-3 text-left active:bg-slate-50"
            aria-label="Open current sale"
          >
            <span className="flex items-center gap-2 min-w-0 text-sm font-medium text-slate-800">
              <ShoppingCart size={18} className="text-slate-400 shrink-0" />
              <span className="truncate">
                {itemCount === 0 ? "Sale empty" : `${itemCount} item${itemCount === 1 ? "" : "s"}`}
              </span>
              <ChevronUp size={16} className="text-slate-400 shrink-0" />
            </span>
            <span className="font-bold text-base whitespace-nowrap">£{total.toFixed(2)}</span>
          </button>

          <button
            disabled={nothingToPay}
            onClick={handleCheckout}
            className="w-24 shrink-0 bg-blue-600 disabled:bg-slate-300 text-white font-bold text-sm flex items-center justify-center gap-1.5"
            data-testid="mobile-payment-button"
          >
            <CreditCard size={17} />
            PAYMENT
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------ sheet view */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 flex items-end"
          role="dialog"
          aria-modal="true"
          aria-label="Current sale"
        >
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />

          <div className="relative w-full bg-white rounded-t-2xl shadow-2xl flex flex-col" style={{ maxHeight: "85dvh" }}>
            {/* header: customer row + close */}
            <div className="h-[54px] shrink-0 border-b border-slate-200 flex items-center justify-between px-4">
              <div className="min-w-0">
                <div className="font-bold text-sm">Current Sale</div>
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={onCustomerClick}
                    className="text-xs text-slate-500 text-left hover:text-blue-600 truncate"
                  >
                    {selectedCustomer ? selectedCustomer.name : "Walk-in Customer"}
                  </button>
                  {selectedCustomer && (
                    <button onClick={onCustomerRemove} className="text-[11px] text-red-500 shrink-0">
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Receipt size={18} className="text-slate-400" />
                <button
                  onClick={() => setOpen(false)}
                  className="p-2 -mr-2 hover:bg-slate-100 rounded"
                  title="Close"
                  aria-label="Close current sale"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* lines: IDENTICAL markup to CartPanel so behaviour is unchanged */}
            <div className="flex-1 overflow-y-auto p-3">
              {basket.length === 0 && miscLines.length === 0 ? (
                <div className="h-full min-h-[180px] flex flex-col items-center justify-center text-slate-400">
                  <ShoppingCart size={42} strokeWidth={1.5} />
                  <div className="font-medium mt-3">No items</div>
                  <div className="text-xs mt-1">Scan a barcode or select a product</div>
                </div>
              ) : (
                <div>
                  {basket.map((item) => (
                    <div key={item.id} className="border-b border-slate-100 py-3">
                      <div className="flex justify-between gap-2">
                        <div className="font-medium text-sm">{item.name}</div>
                        <div className="font-semibold text-sm whitespace-nowrap">
                          £{(Number(item.price || 0) * item.quantity).toFixed(2)}
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center border border-slate-200 rounded">
                          <button onClick={() => onDecrease(item.id)} className="w-9 h-9 hover:bg-slate-100">
                            −
                          </button>
                          <span className="w-8 text-center text-sm font-medium" data-testid="cart-qty">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => onIncrease(item)}
                            className="w-9 h-9 hover:bg-slate-100"
                            title="Increase quantity"
                            aria-label={`Increase quantity of ${item.name}`}
                          >
                            +
                          </button>
                          <button
                            onClick={() => onRemoveItem(item.id)}
                            className="w-9 h-9 text-red-500 hover:bg-red-50"
                            title="Remove item"
                            aria-label={`Remove ${item.name}`}
                          >
                            ×
                          </button>
                        </div>

                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          £{Number(item.price || 0).toFixed(2)} each
                        </span>
                      </div>
                    </div>
                  ))}

                  {/* Till Misc Item lines: same contract as CartPanel. */}
                  {miscLines.map((line, index) => (
                    <div
                      key={`misc-${index}-${line.description}`}
                      className="border-b border-slate-100 py-3"
                      data-testid="misc-cart-line"
                    >
                      <div className="flex justify-between gap-2">
                        <div className="font-medium text-sm">
                          {line.description}
                          <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-400">Misc</span>
                        </div>
                        <div className="font-semibold text-sm whitespace-nowrap">
                          £{(Number(line.price || 0) * Number(line.quantity || 0)).toFixed(2)}
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center border border-slate-200 rounded">
                          <span className="w-8 text-center text-sm font-medium">{line.quantity}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">£{Number(line.price || 0).toFixed(2)} each</span>
                          <button
                            onClick={() => onRemoveMiscLine(index)}
                            className="w-8 h-8 text-red-500 hover:bg-red-50"
                            title="Remove misc item"
                            aria-label={`Remove ${line.description}`}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* totals + checkout: same maths source as CartPanel */}
            <div className="shrink-0 border-t border-slate-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-500">Subtotal</span>
                <span>£{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm mb-3">
                <span className="text-slate-500">VAT</span>
                <span>£{vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xl font-bold mb-4">
                <span>Total</span>
                <span>£{total.toFixed(2)}</span>
              </div>

              <button
                disabled={nothingToPay}
                onClick={handleCheckout}
                className="w-full h-14 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-md text-lg font-bold flex items-center justify-center gap-2"
              >
                <CreditCard size={21} />
                PAYMENT
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
