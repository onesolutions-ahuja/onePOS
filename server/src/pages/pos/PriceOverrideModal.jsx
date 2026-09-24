import { useEffect, useRef, useState } from "react";

function PriceOverrideModal({ item, onClose, onApply }) {
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  const confirm = (e) => {
    e.preventDefault();
    const numeric = Number(price);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return;
    }
    onApply(numeric, reason.trim() || null);
  };

  const originalPrice = Number(item.price) || 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={confirm}
        className="bg-white rounded-xl w-[360px] p-5"
        data-testid="price-override-modal"
      >
        <div className="flex justify-between mb-4">
          <h2 className="font-bold text-lg">Change Price</h2>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="text-sm text-slate-600 mb-3">
          <span className="font-medium">{item.name}</span>
          <div>Original: £{originalPrice.toFixed(2)} each</div>
        </div>

        <label className="text-sm">
          New unit price (£)
          <input
            ref={inputRef}
            required
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="block w-full h-10 mt-1 border rounded px-2"
            data-testid="price-override-input"
          />
        </label>

        <label className="text-sm mt-3 block">
          Reason (optional)
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 255))}
            placeholder="e.g. damaged, negotiated, comp"
            className="block w-full h-10 mt-1 border rounded px-2"
            data-testid="price-override-reason"
          />
        </label>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 border border-slate-200 rounded text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="h-10 px-4 bg-blue-600 text-white rounded text-sm"
            data-testid="price-override-confirm"
          >
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}

export default PriceOverrideModal;
