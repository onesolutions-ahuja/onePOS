import { useCallback, useEffect, useState } from "react";
import { BookOpen, Clock, PoundSterling, RefreshCw, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import {
  Alert,
  Badge,
  Button,
  Input,
  Label,
  Toggle,
} from "../../components/ui.jsx";

/*
 * T10Y — Customer Credit modal.
 *
 * Company-scoped view over GET /api/customers/:id/credit. Lets an authorised
 * user: see the credit summary (enabled / limit / outstanding / available),
 * toggle credit + set the limit (PUT, company admin enforced server-side),
 * record a payment against the outstanding balance and open the date-range
 * statement (GET /customers/:id/credit/statement?from=&to=).
 *
 * Isolation is entirely server-side: every endpoint re-derives the customer
 * from :id + the caller's company token; a foreign id reads as 404.
 */

const TX_LABELS = {
  credit_sale: "Credit sale",
  payment: "Payment received",
  credit_note: "Credit note",
  debit_note: "Debit note",
  opening: "Opening balance",
};

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

function signedDisplay(type, amount) {
  const reduces = type === "payment" || type === "debit_note";
  const n = Number(amount || 0);
  return reduces ? `−${money(n)}` : `+${money(n)}`;
}

export default function CustomerCreditModal({ customer, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  /* config form */
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [limitInput, setLimitInput] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  /* payment form */
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [savingPayment, setSavingPayment] = useState(false);

  /* statement */
  const [showStatement, setShowStatement] = useState(false);
  const [statement, setStatement] = useState(null);
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");
  const [statementLoading, setStatementLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiRequest(`/api/customers/${customer.id}/credit`);
      if (!res.success) throw new Error(res.message || "Unable to load customer credit");
      setData(res.data);
      setCreditEnabled(!!res.data.credit?.enabled);
      setLimitInput(res.data.credit?.limit != null ? String(res.data.credit.limit) : "");
    } catch (err) {
      setError(err.message || "Unable to load customer credit");
    } finally {
      setLoading(false);
    }
  }, [customer.id]);

  useEffect(() => {
    load();
  }, [load]);

  const saveConfig = async () => {
    try {
      setSavingConfig(true);
      setError("");
      setMessage("");
      const body = { enabled: creditEnabled };
      if (limitInput.trim() !== "") body.limit = Number(limitInput);
      const res = await apiRequest(`/api/customers/${customer.id}/credit`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.success) throw new Error(res.message || "Unable to save credit settings");
      setMessage(res.message || "Credit settings saved");
      await load();
    } catch (err) {
      setError(err.message || "Unable to save credit settings");
    } finally {
      setSavingConfig(false);
    }
  };

  const recordPayment = async (event) => {
    event.preventDefault();
    try {
      setSavingPayment(true);
      setError("");
      setMessage("");
      const res = await apiRequest(`/api/customers/${customer.id}/credit/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: Number(paymentAmount),
          method: paymentMethod,
          notes: paymentNotes.trim() || undefined,
        }),
      });
      if (!res.success) throw new Error(res.message || "Unable to record payment");
      setMessage(res.message || "Payment recorded");
      setPaymentAmount("");
      setPaymentNotes("");
      await load();
    } catch (err) {
      setError(err.message || "Unable to record payment");
    } finally {
      setSavingPayment(false);
    }
  };

  const loadStatement = async (from = statementFrom, to = statementTo) => {
    try {
      setStatementLoading(true);
      setError("");
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      const res = await apiRequest(
        `/api/customers/${customer.id}/credit/statement${qs ? `?${qs}` : ""}`
      );
      if (!res.success) throw new Error(res.message || "Unable to build statement");
      setStatement(res.data.statement);
    } catch (err) {
      setError(err.message || "Unable to build statement");
    } finally {
      setStatementLoading(false);
    }
  };

  const fmtDate = (value) =>
    value
      ? new Date(value).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";

  const credit = data?.credit;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[680px] max-w-full max-h-[88vh] shadow-2xl flex flex-col">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h2 className="onepos-card-title flex items-center gap-2">
              <BookOpen size={17} className="text-teal-700" />
              Customer Credit
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{customer.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          {message && <Alert tone="success">{message}</Alert>}

          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Clock size={20} className="animate-spin mr-2" />
              Loading credit information…
            </div>
          ) : !data ? null : (
            <>
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Outstanding balance</div>
                  <div className="text-xl font-bold text-slate-800 mt-0.5">
                    {money(credit.balance)}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Credit limit</div>
                  <div className="text-xl font-bold text-slate-800 mt-0.5">
                    {money(credit.limit)}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Available credit</div>
                  <div className="text-xl font-bold text-teal-700 mt-0.5">
                    {money(credit.available)}
                  </div>
                </div>
              </div>

              {/* Configuration */}
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-700 mb-2">
                  Credit account settings
                </div>
                <div className="flex items-center gap-2 mb-3">
                  <Toggle
                    checked={creditEnabled}
                    onChange={(value) => setCreditEnabled(value)}
                    aria-label="Enable customer credit"
                  />
                  <span className="text-sm text-slate-600">
                    {creditEnabled ? "Credit enabled" : "Credit disabled"}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                  <div>
                    <Label htmlFor="cc-limit">Credit limit (£)</Label>
                    <Input
                      id="cc-limit"
                      type="number"
                      min="0"
                      step="0.01"
                      value={limitInput}
                      onChange={(event) => setLimitInput(event.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={saveConfig}
                    disabled={savingConfig}
                  >
                    {savingConfig ? "Saving…" : "Save settings"}
                  </Button>
                </div>
              </div>

              {/* Record payment */}
              <form
                onSubmit={recordPayment}
                className="rounded-lg border border-slate-200 p-3"
              >
                <div className="text-sm font-semibold text-slate-700 mb-2">
                  Record payment against balance
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <Label htmlFor="cc-pay-amount">Amount (£)</Label>
                    <Input
                      id="cc-pay-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label htmlFor="cc-pay-method">Method</Label>
                    <select
                      id="cc-pay-method"
                      className="onepos-input"
                      value={paymentMethod}
                      onChange={(event) => setPaymentMethod(event.target.value)}
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                  <div>
                    <Label htmlFor="cc-pay-notes">Reference / notes</Label>
                    <Input
                      id="cc-pay-notes"
                      value={paymentNotes}
                      onChange={(event) => setPaymentNotes(event.target.value)}
                      placeholder="Optional"
                      maxLength={500}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="submit"
                    disabled={savingPayment || !credit?.enabled}
                    title={credit?.enabled ? "Record payment" : "Enable credit first"}
                  >
                    <PoundSterling size={14} />
                    {savingPayment ? "Recording…" : "Record payment"}
                  </Button>
                </div>
                {credit && !credit.enabled && (
                  <p className="text-xs text-slate-400 mt-1.5">
                    Enable credit to record payments against this account.
                  </p>
                )}
              </form>

              {/* Statement */}
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold text-slate-700">
                    Statement
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const next = !showStatement;
                      setShowStatement(next);
                      if (next && !statement) loadStatement();
                    }}
                  >
                    {showStatement ? "Hide" : "View statement"}
                  </Button>
                </div>
                {showStatement && (
                  <>
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end mb-3">
                      <div>
                        <Label htmlFor="cc-from">From</Label>
                        <Input
                          id="cc-from"
                          type="date"
                          value={statementFrom}
                          onChange={(event) => setStatementFrom(event.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="cc-to">To</Label>
                        <Input
                          id="cc-to"
                          type="date"
                          value={statementTo}
                          onChange={(event) => setStatementTo(event.target.value)}
                        />
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => loadStatement()}
                        disabled={statementLoading}
                      >
                        <RefreshCw size={13} />
                        Apply
                      </Button>
                    </div>
                    {statementLoading ? (
                      <div className="text-sm text-slate-400 py-3">
                        Building statement…
                      </div>
                    ) : statement ? (
                      <>
                        <div className="flex items-center gap-4 text-xs text-slate-500 mb-2">
                          <span>
                            Opening balance:{" "}
                            <strong className="text-slate-700">
                              {money(statement.openingBalance)}
                            </strong>
                          </span>
                          <span>
                            Closing balance:{" "}
                            <strong className="text-slate-700">
                              {money(statement.closingBalance)}
                            </strong>
                          </span>
                        </div>
                        {statement.transactions.length === 0 ? (
                          <div className="text-xs text-slate-400 py-3 text-center">
                            No transactions in this period
                          </div>
                        ) : (
                          <table className="onepos-table text-xs">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Type</th>
                                <th className="text-right">Amount</th>
                                <th className="text-right">Balance</th>
                                <th>Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {statement.transactions.map((tx) => (
                                <tr key={tx.id || `${tx.created_at}-${tx.amount}`}>
                                  <td className="whitespace-nowrap">{fmtDate(tx.transaction_date)}</td>
                                  <td>{TX_LABELS[tx.transaction_type] || tx.transaction_type}</td>
                                  <td
                                    className={`text-right font-medium ${
                                      tx.amount_display < 0 ? "text-orange-600" : "text-emerald-700"
                                    }`}
                                  >
                                    {signedDisplay(tx.transaction_type, Math.abs(Number(tx.amount_display)))}
                                  </td>
                                  <td className="text-right font-mono">
                                    {money(tx.running_balance)}
                                  </td>
                                  <td className="text-slate-500">{tx.description || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </>
                    ) : null}
                  </>
                )}
              </div>

              {/* Recent ledger */}
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-700 mb-2">
                  Recent ledger activity
                </div>
                {data.ledger.length === 0 ? (
                  <div className="text-xs text-slate-400 py-3 text-center">
                    No credit activity yet
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {data.ledger.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between gap-2 text-xs border-b border-slate-100 pb-1.5 last:border-0"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              tone={
                                entry.transaction_type === "payment" ||
                                entry.transaction_type === "debit_note"
                                  ? "success"
                                  : "info"
                              }
                            >
                              {TX_LABELS[entry.transaction_type] || entry.transaction_type}
                            </Badge>
                            <span className="text-slate-400">{fmtDate(entry.created_at)}</span>
                          </div>
                          {entry.description && (
                            <div className="text-slate-500 mt-0.5 truncate">{entry.description}</div>
                          )}
                        </div>
                        <div className="font-semibold text-slate-700 whitespace-nowrap">
                          {signedDisplay(entry.transaction_type, entry.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-3 border-t border-slate-200 shrink-0">
          <Button variant="secondary" size="sm" onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
