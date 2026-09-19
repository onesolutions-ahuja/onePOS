import { useState } from "react";
import { CreditCard, Wallet, X } from "lucide-react";

/* Payment is a step-by-step popup flow:
   1. Choose payment mode (Cash / Card / Split / Other)
   2. Cash -> ask for the cash received amount -> OK completes the sale.
   The change to return to the customer is shown by the till as a popup
   after the transaction completes. */
function PaymentModal({
  total,
  onClose,
  onComplete,
  onCard,
  offline = false,
}) {
  const [step, setStep] = useState("mode"); // "mode" | "cash"
  const [cashReceived, setCashReceived] = useState("");
  const [processing, setProcessing] = useState(false);

  const payCash = async () => {
    if (processing) return;
    setProcessing(true);
    try {
      await onComplete("cash", { cashReceived: Number(cashReceived) || 0 });
    } finally {
      setProcessing(false);
    }
  };

  const payCard = async () => {
    if (offline || processing) return;
    setProcessing(true);
    try { await onCard("card"); } finally { setProcessing(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-[420px] max-w-[95vw] shadow-2xl">
        <div className="p-5 border-b flex justify-between items-center">
          <div>
            <h2 className="font-bold text-xl">
              {step === "mode" ? "Payment" : "Cash Received"}
            </h2>

            <div className="text-sm text-slate-400">
              Total due
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
            <div className="text-4xl font-bold">
              £{total.toFixed(2)}
            </div>
          </div>

          {step === "mode" ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setStep("cash")}
                disabled={processing}
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

              <button
                disabled
                className="h-20 border-2 border-slate-200 rounded-xl opacity-50 cursor-not-allowed"
              >
                Split Payment
              </button>

              <button
                disabled
                className="h-20 border-2 border-slate-200 rounded-xl opacity-50 cursor-not-allowed"
              >
                Other
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <input
                autoFocus
                type="number"
                min={0}
                step="0.01"
                value={cashReceived}
                onChange={(event) => setCashReceived(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !processing) payCash();
                }}
                placeholder="Enter amount received"
                className="w-full h-14 border rounded px-4 text-xl text-center font-semibold"
              />

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("mode")}
                  disabled={processing}
                  className="flex-1 h-11 border border-slate-200 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Back
                </button>

                <button
                  onClick={payCash}
                  disabled={processing}
                  className="flex-1 h-11 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60"
                >
                  {processing ? "Completing..." : "OK"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PaymentModal;