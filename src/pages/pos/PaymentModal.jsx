import { useState } from "react";
import { CreditCard, Wallet, X } from "lucide-react";

function PaymentModal({
  total,
  onClose,
  onComplete,
  onCard,
  offline = false,
}) {
  const [cashReceived, setCashReceived] = useState("");
  const [processing, setProcessing] = useState(false);
  const change = Math.max(0, Number(cashReceived || 0) - total);

  const payCash = async () => {
    if (processing || !Number.isFinite(Number(cashReceived)) || Number(cashReceived) < total) return;
    setProcessing(true);
    try { await onComplete("cash"); } finally { setProcessing(false); }
  };

  const payCard = async () => {
    if (offline || processing) return;
    setProcessing(true);
    try { await onCard("card"); } finally { setProcessing(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-[520px] max-w-[95vw] shadow-2xl">
        <div className="p-5 border-b flex justify-between items-center">
          <div>
            <h2 className="font-bold text-xl">
              Payment
            </h2>

            <div className="text-sm text-slate-400">
              Amount due
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6">
          {offline && (
            <p role="status" className="mb-4 rounded bg-amber-50 p-3 text-sm text-amber-800">
              Offline — cash only. Cash sales are saved locally as Pending sync.
              Stock is adjusted after backend synchronization. Card payment is unavailable offline.
            </p>
          )}
          <div className="text-center mb-6">
            <div className="text-sm text-slate-500">
              Total
            </div>

            <div className="text-4xl font-bold mt-1">
              £{total.toFixed(2)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={payCash}
              disabled={processing || Number(cashReceived) < total}
              className="h-24 border-2 border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50"
            >
              <Wallet
                className="mx-auto"
                size={27}
              />

              <div className="font-semibold mt-2">
                Cash
              </div>
            </button>

            <div className="col-span-2">
              <input
                type="number"
                min={total}
                step="0.01"
                value={cashReceived}
                onChange={(event) => setCashReceived(event.target.value)}
                placeholder="Cash received"
                className="w-full h-10 border rounded px-3 text-sm"
              />
              <div className="text-sm text-slate-500 mt-1">Change: £{change.toFixed(2)}</div>
            </div>

            <button
              onClick={payCard}
              disabled={processing || offline}
              className="h-24 border-2 border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50"
            >
              <CreditCard
                className="mx-auto"
                size={27}
              />

              <div className="font-semibold mt-2">
                Card
              </div>
            </button>

            <button className="h-20 border-2 border-slate-200 rounded-xl">
              Split Payment
            </button>

            <button className="h-20 border-2 border-slate-200 rounded-xl">
              Other
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PaymentModal;