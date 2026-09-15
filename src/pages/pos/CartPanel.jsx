import { CreditCard, Receipt, ShoppingCart } from "lucide-react";

function CartPanel({
  basket,
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
}) {
  return (
    <aside className="w-[350px] bg-white border-l border-slate-200 flex flex-col shrink-0">
      <div className="h-[58px] border-b border-slate-200 flex items-center justify-between px-4">
        <div>
          <div className="font-bold">
            Current Sale
          </div>
          <button onClick={onCustomerClick} className="text-xs text-slate-500 text-left hover:text-blue-600">
            {selectedCustomer ? selectedCustomer.name : "Walk-in Customer"}
          </button>
          {selectedCustomer && <div className="flex gap-2 mt-1"><span className="text-[11px] text-slate-400">{selectedCustomer.phone || selectedCustomer.email || ""}</span><button onClick={onCustomerRemove} className="text-[11px] text-red-500">Remove</button></div>}
        </div>

        <Receipt
          size={20}
          className="text-slate-400"
        />
      </div>

      {saleError && <div className="mx-3 mb-2 px-3 py-2 bg-red-50 text-red-700 rounded text-xs">{saleError}</div>}
      {saleMessage && <div className="mx-3 mb-2 px-3 py-2 bg-emerald-50 text-emerald-700 rounded text-xs">{saleMessage}</div>}

      <div className="flex-1 overflow-y-auto p-3">
        {basket.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <ShoppingCart
              size={42}
              strokeWidth={1.5}
            />

            <div className="font-medium mt-3">
              No items
            </div>

            <div className="text-xs mt-1">
              Scan a barcode or select a
              product
            </div>
          </div>
        ) : (
          <div>
            {basket.map((item) => (
              <div
                key={item.id}
                className="border-b border-slate-100 py-3"
              >
                <div className="flex justify-between gap-2">
                  <div className="font-medium text-sm">
                    {item.name}
                  </div>

                  <div className="font-semibold text-sm">
                    £
                    {(
                      Number(
                        item.price || 0
                      ) *
                      item.quantity
                    ).toFixed(2)}
                  </div>
                </div>

                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center border border-slate-200 rounded">
                    <button
                      onClick={() =>
                        onDecrease(
                          item.id
                        )
                      }
                      className="w-8 h-8 hover:bg-slate-100"
                    >
                      −
                    </button>

                    <span className="w-8 text-center text-sm">
                      {item.quantity}
                    </span>

                    <button
                      onClick={() =>
                        onIncrease(item)
                      }
                      className="w-8 h-8 hover:bg-slate-100"
                    >
                      +
                    </button>
                    <input
                      aria-label={`Quantity for ${item.name}`}
                      type="number"
                      min="1"
                      step="1"
                      value={item.quantity}
                      onChange={(event) => onUpdateQuantity(item.id, event.target.value)}
                      className="w-12 h-8 border-l border-slate-200 text-center text-sm"
                    />
                    <button
                      onClick={() => onRemoveItem(item.id)}
                      className="w-8 h-8 text-red-500 hover:bg-red-50"
                      title="Remove item"
                    >
                      ×
                    </button>
                  </div>

                  <span className="text-xs text-slate-400">
                    £
                    {Number(
                      item.price || 0
                    ).toFixed(2)}{" "}
                    each
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-500">
            Subtotal
          </span>

          <span>
            £{subtotal.toFixed(2)}
          </span>
        </div>

        <div className="flex justify-between text-sm mb-3">
          <span className="text-slate-500">
            VAT
          </span>

          <span>
            £{vat.toFixed(2)}
          </span>
        </div>

        <div className="flex justify-between text-xl font-bold mb-4">
          <span>Total</span>

          <span>
            £{total.toFixed(2)}
          </span>
        </div>

        <button
          disabled={
            basket.length === 0
          }
          onClick={onCheckout}
          className="w-full h-14 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-md text-lg font-bold flex items-center justify-center gap-2"
        >
          <CreditCard size={21} />
          PAYMENT
        </button>
      </div>
    </aside>
  );
}

export default CartPanel;