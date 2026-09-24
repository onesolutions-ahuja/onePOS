import { Receipt, ShoppingCart, UserRound } from "lucide-react";

/*
 * T10F — Customer-facing Current Bill Display.
 *
 * A read-only mirror of the staff POS right-hand bill panel (CartPanel).
 * It owns NO basket, NO totals and NO calculation logic: it renders the
 * exact same `basket` array and the exact same totals object the staff POS
 * computes via computeBasketTotals (utils/saleTotals.js — the single engine).
 * Any cashier change (add/remove/quantity/discount/clear) re-renders here
 * immediately because it is the same React state.
 *
 * Strictly read-only: no product search, no payment, no hold/retrieve,
 * no till controls, no admin/settings, no editable inputs of any kind.
 * Customer private details (phone/email) are intentionally not shown —
 * only a non-identifying "Account" label when a customer is attached.
 */

function money(value) {
  return `£${Number(value || 0).toFixed(2)}`;
}

export default function CustomerBillDisplay({
  basket = [],
  subtotal = 0,
  vat = 0,
  total = 0,
  discountAmount = 0,
  hasDiscount = false,
  hasCustomer = false,
  storeName = "",
}) {
  const empty = basket.length === 0;

  return (
    <div
      data-testid="customer-bill-display"
      className="relative h-full w-full flex flex-col bg-white"
    >
      {/* Branding header — same gradient language as the POS header */}
      <header
        className="h-[88px] shrink-0 text-white flex items-center justify-between px-8"
        style={{
          background: "linear-gradient(90deg, #104744 0%, #176F6A 100%)",
        }}
      >
        <div>
          <div className="text-2xl font-bold tracking-tight">
            onePOS
          </div>

          {storeName
            ? (
              <div className="text-sm text-emerald-100/90 mt-0.5">
                {storeName}
              </div>
            )
            : null}
        </div>

        <div className="text-right">
          <div className="text-lg font-semibold flex items-center gap-2 justify-end">
            <Receipt size={20} />

            Your Bill
          </div>

          <div className="text-xs text-emerald-100/80 mt-0.5">
            Thank you for shopping with us
          </div>
        </div>
      </header>

      {empty
        ? (
          /* Welcome / empty state — shown whenever the bill is cleared */
          <div
            data-testid="customer-bill-empty"
            className="flex-1 flex flex-col items-center justify-center text-slate-400 px-8"
          >
            <ShoppingCart
              size={64}
              strokeWidth={1.25}
              className="text-slate-300"
            />

            <div className="text-xl font-medium text-slate-500 mt-5">
              Welcome
            </div>

            <div className="text-sm mt-1 text-slate-400">
              Your bill will appear here as items are added
            </div>
          </div>
        )
        : (
          <>
            {/* Bill lines — name / qty / unit price / line total (read-only) */}
            <div
              data-testid="customer-bill-lines"
              className="flex-1 overflow-y-auto px-8 py-4"
            >
              <div className="grid grid-cols-[1fr_auto] gap-x-6 text-[11px] font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-200 pb-2">
                <span>
                  Item
                </span>

                <span>
                  Amount
                </span>
              </div>

              {basket.map((item) => (
                <div
                  key={item.id}
                  data-testid="customer-bill-line"
                  className="py-3 border-b border-slate-100"
                >
                  <div className="flex justify-between gap-6">
                    <div className="font-medium text-[15px] text-slate-800">
                      {item.name}
                    </div>

                    <div className="font-semibold text-[15px] text-slate-900">
                      {money(
                        Number(item.price || 0) * item.quantity
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between mt-1 text-xs text-slate-500">
                    <span>
                      {item.quantity} × {money(item.price)}
                    </span>

                    {item.vatApplicable === false
                      ? (
                        <span className="text-slate-400">
                          Zero-rated
                        </span>
                      )
                      : null}
                  </div>
                </div>
              ))}
            </div>

            {/* Totals — the SAME numbers the cashier sees, nothing else */}
            <div className="shrink-0 border-t-2 border-slate-200 px-8 py-5 bg-slate-50">
              {hasDiscount
                ? (
                  <div
                    data-testid="customer-bill-discount"
                    className="flex justify-between text-sm mb-2 text-emerald-700"
                  >
                    <span>
                      Discount
                    </span>

                    <span>
                      −{money(discountAmount)}
                    </span>
                  </div>
                )
                : null}

              <div className="flex justify-between text-base mb-2">
                <span className="text-slate-500">
                  Subtotal
                </span>

                <span className="font-medium">
                  {money(subtotal)}
                </span>
              </div>

              <div className="flex justify-between text-base mb-4">
                <span className="text-slate-500">
                  VAT
                </span>

                <span className="font-medium">
                  {money(vat)}
                </span>
              </div>

              <div className="flex justify-between items-baseline border-t border-slate-300 pt-3">
                <span className="text-lg font-semibold">
                  Total
                </span>

                <span
                  data-testid="customer-bill-total"
                  className="text-3xl font-bold text-[#176F6A]"
                >
                  {money(total)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-3">
                <UserRound size={13} />

                {hasCustomer
                  ? "Billed to a customer account"
                  : "Walk-in customer"}
              </div>
            </div>
          </>
        )}
    </div>
  );
}
