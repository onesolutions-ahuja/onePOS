import { useState } from "react";
import { CreditCard, Landmark, Layers, Wallet, X } from "lucide-react";

/* Payment is a step-by-step popup flow:
   1. Choose payment mode (Cash / Card / Split / Other)
   2. Cash -> ask for the cash received amount -> OK completes the sale.
   3. Split / Other -> one amount per tender; the lines must add up to the
      sale total exactly (the backend re-validates and rejects over/under).
   The change to return to the customer is shown by the till as a popup
   after the transaction completes. */
const OTHER_TENDERS = [
  { method: "voucher", label: "Voucher" },
  { method: "cheque", label: "Cheque" },
  { method: "bank_transfer", label: "Bank Transfer" },
];

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

function PaymentModal({
  total,
  onClose,
  onComplete,
  onCard,
  offline = false,
}) {
  const [step, setStep] = useState("mode"); // "mode" | "cash" | "split" | "other"
  const [cashReceived, setCashReceived] = useState("");
  const [processing, setProcessing] = useState(false);
  /* Split tender: one editable amount per method; blank = not used. */
  const [splitLines, setSplitLines] = useState([
    { method: "cash", label: "Cash", amount: "" },
    { method: "card", label: "Card", amount: "" },
  ]);
  const [otherMethod, setOtherMethod] = useState("voucher");

  const splitTotal = splitLines.reduce(
    (sum, line) => sum + (Number(line.amount) > 0 ? Math.round(Number(line.amount) * 100) / 100 : 0),
    0,
  );
  const splitRemaining = Math.round((total - splitTotal) * 100) / 100;

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

  const paySplit = async () => {
    if (processing) return;
    const lines = splitLines
      .map((line) => ({
        paymentMethod: line.method,
        amount: Math.round((Number(line.amount) || 0) * 100) / 100,
      }))
      .filter((line) => line.amount > 0);
    if (!lines.length) return;
    setProcessing(true);
    try {
      await onComplete("split", { payments: lines });
    } finally {
      setProcessing(false);
    }
  };

  const payOther = async () => {
    if (processing) return;
    setProcessing(true);
    try {
      await onComplete(otherMethod, {});
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-[420px] max-w-[95vw] shadow-2xl">
        <div className="p-5 border-b flex justify-between items-center">
          <div>
            <h2 className="font-bold text-xl">
              {step === "mode" ? "Payment"
                : step === "cash" ? "Cash Received"
                : step === "split" ? "Split Payment"
                : "Other Tender"}
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
                onClick={() => !offline && setStep("split")}
                disabled={offline || processing}
                className="h-20 border-2 border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Layers
                  className="mx-auto"
                  size={22}
                />

                <div className="font-semibold mt-1">
                  Split Payment
                </div>
              </button>

              <button
                onClick={() => !offline && setStep("other")}
                disabled={offline || processing}
                className="h-20 border-2 border-slate-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Landmark
                  className="mx-auto"
                  size={22}
                />

                <div className="font-semibold mt-1">
                  Other
                </div>
              </button>
            </div>
          ) : step === "split" ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Enter the amount paid by each method. The lines must add up to
                the total exactly — over and under payments are rejected.
              </p>

              {splitLines.map((line, index) => (
                <div key={line.method} className="flex items-center gap-3">
                  <span className="w-16 text-sm font-medium">{line.label}</span>

                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.amount}
                    onChange={(event) =>
                      setSplitLines((lines) =>
                        lines.map((l, i) => (i === index ? { ...l, amount: event.target.value } : l)),
                      )
                    }
                    placeholder="0.00"
                    className="flex-1 h-11 border rounded px-3 text-right font-semibold"
                  />
                </div>
              ))}

              <div className="flex justify-between text-sm border-t pt-3">
                <span className="text-slate-500">Remaining</span>
                <span
                  className={`font-semibold ${splitRemaining === 0 ? "text-green-700" : "text-red-600"}`}
                >
                  {money(splitRemaining)}
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("mode")}
                  disabled={processing}
                  className="flex-1 h-11 border border-slate-200 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Back
                </button>

                <button
                  onClick={paySplit}
                  disabled={processing || splitRemaining !== 0}
                  className="flex-1 h-11 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60"
                >
                  {processing ? "Completing..." : "OK"}
                </button>
              </div>
            </div>
          ) : step === "other" ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Record the sale against another tender type. The full total is
                settled by the selected method.
              </p>

              <select
                value={otherMethod}
                onChange={(event) => setOtherMethod(event.target.value)}
                className="w-full h-12 border rounded px-3 font-medium"
              >
                {OTHER_TENDERS.map((tender) => (
                  <option key={tender.method} value={tender.method}>
                    {tender.label}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("mode")}
                  disabled={processing}
                  className="flex-1 h-11 border border-slate-200 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Back
                </button>

                <button
                  onClick={payOther}
                  disabled={processing}
                  className="flex-1 h-11 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-60"
                >
                  {processing ? "Completing..." : "OK"}
                </button>
              </div>
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