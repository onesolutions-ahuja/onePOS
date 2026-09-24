import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import { fmt } from "../../utils/formatters.js";

function TillSessionModal({ onClose, onUpdate }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openingCash, setOpeningCash] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [movements, setMovements] = useState([]);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest("/api/till/sessions/current");
      const s = data.success ? (data.data || null) : null;
      setSession(s);
      if (s) {
        const m = await apiRequest(`/api/till/sessions/${s.id}/cash-movements`);
        setMovements(m.success ? (m.data || []) : []);
      } else {
        setMovements([]);
      }
    } catch (err) {
      setError(err.message || "Unable to load till session");
      setSession(null);
      setMovements([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = () => {
    load();
    if (onUpdate) onUpdate();
  };

  const openTill = async () => {
    try {
      setError("");
      const data = await apiRequest("/api/till/sessions", {
        method: "POST",
        body: JSON.stringify({ openingCash: Number(openingCash) || 0 }),
      });
      if (!data.success) throw new Error(data.message);
      setOpeningCash("");
      refresh();
    } catch (err) {
      setError(err.message || "Unable to open till");
    }
  };

  const closeTill = async () => {
    if (!session) return;
    try {
      setError("");
      const data = await apiRequest(`/api/till/sessions/${session.id}/close`, {
        method: "POST",
        body: JSON.stringify({ countedCash: Number(countedCash) || 0 }),
      });
      if (!data.success) throw new Error(data.message);
      setSession(data.data);
      setCountedCash("");
      refresh();
    } catch (err) {
      setError(err.message || "Unable to close till");
    }
  };

  const addMovement = async (type) => {
    if (!session) return;
    const amount = Number(cashAmount);
    if (!amount || amount <= 0) return;
    try {
      setError("");
      const data = await apiRequest(`/api/till/sessions/${session.id}/cash-movements`, {
        method: "POST",
        body: JSON.stringify({ type, amount, reason: movementReason || null }),
      });
      if (!data.success) throw new Error(data.message);
      setCashAmount("");
      setMovementReason("");
      refresh();
    } catch (err) {
      setError(err.message || "Unable to record cash movement");
    }
  };

  /* T-TILL: the backend computes the cash position (current_cash) — the
   * client only displays it, it never guesses. Falls back to 0 while loading. */
  const expectedCash = session
    ? (Number(session.current_cash) ||
       (Number(session.opening_cash) || 0) +
       (Number(session.cash_in_total) || 0) -
       (Number(session.cash_out_total) || 0) +
       (Number(session.cash_sales) || 0) -
       (Number(session.cash_refunds) || 0))
    : 0;

  const isClosed = session ? session.status === "closed" : false;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl w-[560px] max-w-[95vw] max-h-[calc(100dvh-2rem)] shadow-2xl flex flex-col">
        <div className="p-5 border-b flex justify-between items-center shrink-0">
          <h2 className="font-bold text-xl">Till Session</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto min-h-0">
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-slate-500">Loading…</div>
          ) : session ? (
            <>
              {isClosed ? (
                <div className="space-y-2">
                  <div className="text-green-700 font-medium">
                    Till closed
                  </div>
                  <div className="text-sm text-slate-600">
                    Expected {fmt(session.expected_cash)} · Counted {fmt(session.closing_cash)} · Variance {fmt(session.cash_difference)}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-slate-50 p-3 rounded">
                    <span className="text-slate-500">Opening cash</span>
                    <div className="font-semibold">{fmt(session.opening_cash)}</div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded">
                    <span className="text-slate-500">Cash sales</span>
                    <div className="font-semibold">{fmt(session.cash_sales)}</div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded">
                    <span className="text-slate-500">Cash in</span>
                    <div className="font-semibold">{fmt(session.cash_in_total)}</div>
                  </div>
                  <div className="bg-slate-50 p-3 rounded">
                    <span className="text-slate-500">Cash out</span>
                    <div className="font-semibold">{fmt(session.cash_out_total)}</div>
                  </div>
                  <div className="bg-blue-50 p-3 rounded col-span-2">
                    <span className="text-slate-600">Expected cash</span>
                    <div className="font-semibold text-lg">{fmt(expectedCash)}</div>
                  </div>
                </div>
              )}

              {!isClosed && (
                <>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <input
                        type="number"
                        value={cashAmount}
                        onChange={(e) => setCashAmount(e.target.value)}
                        placeholder="Amount"
                        className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={movementReason}
                        onChange={(e) => setMovementReason(e.target.value)}
                        placeholder="Reason"
                        className="flex-1 h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => addMovement("cash_in")}
                        className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm"
                      >
                        In
                      </button>
                      <button
                        onClick={() => addMovement("cash_out")}
                        className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm"
                      >
                        Out
                      </button>
                    </div>
                  </div>

                  <div className="pt-2">
                    <label className="text-sm text-slate-600">
                      Counted cash (Close Till)
                    </label>
                    <input
                      type="number"
                      value={countedCash}
                      onChange={(e) => setCountedCash(e.target.value)}
                      placeholder="0.00"
                      className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button
                    onClick={closeTill}
                    className="w-full h-10 bg-red-600 hover:bg-red-700 text-white rounded font-semibold"
                  >
                    Close Till
                  </button>
                </>
              )}

              <div className="pt-2">
                <div className="text-xs font-bold text-slate-400 uppercase mb-2">
                  Recent cash movements
                </div>
                <div className="max-h-48 overflow-y-auto text-sm">
                  {movements.length === 0 ? (
                    <div className="text-slate-400">No cash movements.</div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-slate-400">
                          <th className="px-2 py-1">Time</th>
                          <th className="px-2 py-1">Type</th>
                          <th className="px-2 py-1">Amount</th>
                          <th className="px-2 py-1">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m) => (
                          <tr key={m.id} className="border-t">
                            <td className="px-2 py-1">
                              {new Date(m.created_at).toLocaleString()}
                            </td>
                            <td className="px-2 py-1 capitalize">
                              {m.type}
                            </td>
                            <td className="px-2 py-1">{fmt(m.amount)}</td>
                            <td className="px-2 py-1">{m.reason || ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <input
                type="number"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                placeholder="Opening cash (e.g. 100.00)"
                className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={openTill}
                className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white rounded font-semibold"
              >
                Open Till
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TillSessionModal;
