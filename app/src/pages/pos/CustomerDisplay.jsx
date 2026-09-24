import { useEffect, useState } from "react";

/*
 * Customer Display (second monitor) — /customer-display
 *
 * A standalone read-only page showing the till's current bill. The cashier
 * till (the ONLY source of truth) broadcasts its live basket/totals over a
 * BroadcastChannel; this page only listens — there is no basket state, no
 * totals logic and no API access here.
 *
 * Behaviour:
 *  - Nothing broadcast (till closed the window, or the company switch is
 *    off) → OnePOS welcome/standby screen.
 *  - Bill active → items, quantities, prices, subtotal, VAT, discounts and
 *    the final total, in the existing onePOS design.
 *
 * Open it on the second monitor: log in isn't required (nothing sensitive
 * is shown beyond the current bill), but the till only broadcasts while the
 * cashier has Customer Display switched on in Settings → Store & Till.
 */

export default function CustomerDisplay() {
  const [bill, setBill] = useState(null);

  useEffect(() => {
    if (typeof BroadcastChannel !== "function") return undefined;
    const channel = new BroadcastChannel("onepos-customer-display");
    channel.onmessage = (event) => {
      const data = event.data || {};
      setBill(data.type === "BILL" ? data : null);
    };
    return () => {
      try { channel.close(); } catch { /* already closed */ }
    };
  }, []);

  const hasItems = Array.isArray(bill?.basket) && bill.basket.length > 0;

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-slate-800 flex flex-col">
      {/* Branding header */}
      <header
        className="h-[72px] text-white flex items-center px-8 shrink-0"
        style={{ background: "linear-gradient(90deg, #104744 0%, #176F6A 100%)" }}
      >
        <div className="font-bold text-3xl tracking-tight">onePOS</div>
        <div className="ml-4 text-emerald-100/80 text-lg font-medium truncate">
          {bill?.storeName || "Welcome"}
        </div>
      </header>

      {!hasItems ? (
        /* Welcome / standby */
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
          <div
            className="w-24 h-24 rounded-3xl flex items-center justify-center text-4xl font-bold text-white"
            style={{ background: "linear-gradient(135deg,#1a817b 0%,#176F6A 55%,#0e5f5a 100%)" }}
          >
            one
          </div>
          <h1 className="text-4xl font-bold mt-8 text-slate-800">Welcome to onePOS</h1>
          <p className="text-xl text-slate-500 mt-3 max-w-md">
            Your bill will appear here while you shop.
          </p>
        </div>
      ) : (
        /* Current bill — read-only mirror of the cashier's basket */
        <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-8 py-6">
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Your bill</h2>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
            {bill.basket.map((item, index) => (
              <div key={`${item.id}-${index}`} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 min-w-0">
                  <div className="text-xl font-semibold text-slate-800 truncate">{item.name}</div>
                  <div className="text-base text-slate-500">
                    {item.quantity} × £{Number(item.price || 0).toFixed(2)}
                  </div>
                </div>
                <div className="text-xl font-bold text-slate-800 tabular-nums">
                  £{(Number(item.price || 0) * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm mt-6 px-6 py-5 text-xl">
            {bill.hasCustomer ? (
              <div className="text-base text-emerald-700 pb-2">Loyalty customer applied to this sale</div>
            ) : null}
            <div className="flex justify-between text-slate-600 py-1">
              <span>Subtotal</span>
              <span className="tabular-nums">£{Number(bill.subtotal || 0).toFixed(2)}</span>
            </div>
            {bill.hasDiscount ? (
              <div className="flex justify-between text-emerald-700 py-1">
                <span>Discount</span>
                <span className="tabular-nums">−£{Number(bill.discountAmount || 0).toFixed(2)}</span>
              </div>
            ) : null}
            {Number(bill.vat || 0) > 0 ? (
              <div className="flex justify-between text-slate-600 py-1">
                <span>VAT</span>
                <span className="tabular-nums">£{Number(bill.vat || 0).toFixed(2)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-bold text-3xl text-slate-900 border-t border-slate-200 mt-3 pt-4">
              <span>Total</span>
              <span className="tabular-nums">£{Number(bill.total || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
