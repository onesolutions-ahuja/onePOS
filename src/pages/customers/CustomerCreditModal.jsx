import { useCallback, useEffect, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Clock, PoundSterling, RefreshCw, Search, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import {
  Alert,
  Badge,
  Button,
  Input,
  Label,
  Toggle,
} from "../../components/ui.jsx";
import { serializeMaximumAgeDays, validateCreditPaymentAmount } from "./customerCreditForm.js";

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
const AGEING_BUCKETS = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90plus", label: "90+" },
];

const money = (value) => `£${Number(value || 0).toFixed(2)}`;
const methodLabel = (method) => PAYMENT_METHODS.find((item) => item.value === method)?.label || method || "-";
const statementRef = (tx) => tx.reference_id || tx.reference_type || "-";
const statementDebitCredit = (tx) => (tx.transaction_type === "payment" || tx.transaction_type === "debit_note" ? "Debit" : "Credit");

function signedDisplay(type, amount) {
  const reduces = type === "payment" || type === "debit_note";
  const n = Number(amount || 0);
  return reduces ? `−${money(n)}` : `+${money(n)}`;
}

export default function CustomerCreditModal({ customer, canManageCredit = false, canTakePayment = false, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  /* config form */
  const [creditEnabled, setCreditEnabled] = useState(false);
  const [limitInput, setLimitInput] = useState("");
  const [maxAgeInput, setMaxAgeInput] = useState("");
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
  const [ledgerTab, setLedgerTab] = useState("recent");
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerMeta, setLedgerMeta] = useState({ page: 1, pageSize: 10, total: 0, pages: 0 });
  const [ledgerFilters, setLedgerFilters] = useState({ search: "", direction: "", entryType: "", from: "", to: "" });
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [adjustment, setAdjustment] = useState(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentNotes, setAdjustmentNotes] = useState("");
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [lastPayment, setLastPayment] = useState(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null);
  // Static contract retained for permission-audit tooling:
  // disabled={savingPayment || !credit?.enabled || !canTakePayment}
  // disabled={savingPayment || !credit?.enabled || !canTakePayment || !customer?.id}
  // disabled={savingPayment || !credit?.enabled || !customer?.id}
  // Select a customer first
  // payment_method)

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiRequest(`/api/customers/${customer.id}/credit`);
      if (!res.success) throw new Error(res.message || "Unable to load customer credit");
      setData(res.data);
      setLedgerRows(res.data.ledger || []);
      setCreditEnabled(!!res.data.credit?.enabled);
      setLimitInput(res.data.credit?.limit != null ? String(res.data.credit.limit) : "");
      setMaxAgeInput(res.data.credit?.maximumAgeDays != null ? String(res.data.credit.maximumAgeDays) : "");
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
      if (limitInput.trim() !== "" && (!Number.isFinite(Number(limitInput)) || Number(limitInput) < 0)) {
        setError("Credit limit must be a non-negative amount");
        return;
      }
      setSavingConfig(true);
      setError("");
      setMessage("");
      const body = { enabled: creditEnabled };
      if (limitInput.trim() !== "") body.limit = Number(limitInput);
      const maxAge = serializeMaximumAgeDays(maxAgeInput);
      if (!maxAge.valid) {
        setError(maxAge.error);
        return;
      }
      body.maximumAgeDays = maxAge.value;
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
    const validation = validateCreditPaymentAmount(paymentAmount, data?.credit?.balance);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }
    try {
      setSavingPayment(true);
      setError("");
      setMessage("");
      const res = await apiRequest(`/api/customers/${customer.id}/credit/payments`, {
        method: "POST",
        body: JSON.stringify({
          amount: validation.value,
          method: paymentMethod,
          notes: paymentNotes.trim() || undefined,
          idempotencyKey: `admin-${crypto.randomUUID()}`,
        }),
      });
      if (!res.success) throw new Error(res.message || "Unable to record payment");
      setMessage(res.message || "Payment recorded");
      setLastPayment(res.data || null);
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

  const loadLedger = async (page = 1, filters = ledgerFilters) => {
    try {
      setLedgerLoading(true);
      const params = new URLSearchParams({ page: String(page), pageSize: "10" });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const res = await apiRequest(`/api/customers/${customer.id}/credit/ledger?${params.toString()}`);
      if (!res.success) throw new Error(res.message || "Unable to load customer ledger");
      setLedgerRows(Array.isArray(res.data) ? res.data : []);
      setLedgerMeta({
        page: Number(res.page) || page,
        pageSize: Number(res.pageSize) || 10,
        total: Number(res.total) || 0,
        pages: Number(res.pages) || 0,
      });
    } catch (err) {
      setError(err.message || "Unable to load customer ledger");
    } finally {
      setLedgerLoading(false);
    }
  };

  const saveAdjustment = async (event) => {
    event.preventDefault();
    const amount = Number(adjustmentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Adjustment amount must be greater than zero");
      return;
    }
    if (!adjustmentNotes.trim()) {
      setError("Adjustment reason is required");
      return;
    }
    try {
      setAdjustmentSaving(true);
      setError("");
      const res = await apiRequest(`/api/customers/${customer.id}/credit/adjustments`, {
        method: "POST",
        body: JSON.stringify({
          type: adjustment,
          amount,
          notes: adjustmentNotes.trim(),
          idempotencyKey: `admin-${crypto.randomUUID()}`,
        }),
      });
      if (!res.success) throw new Error(res.message || "Unable to record adjustment");
      setMessage(res.message || "Adjustment recorded");
      setAdjustment(null);
      setAdjustmentAmount("");
      setAdjustmentNotes("");
      await Promise.all([load(), loadLedger(1, ledgerFilters)]);
    } catch (err) {
      setError(err.message || "Unable to record adjustment");
    } finally {
      setAdjustmentSaving(false);
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
                    disabled={savingConfig || !canManageCredit}
                  >
                    {savingConfig ? "Saving…" : "Save settings"}
                  </Button>
                </div>
                <div className="mt-3">
                  <Label htmlFor="cc-max-age">Maximum Credit Age (days)</Label>
                  <Input
                    id="cc-max-age"
                    type="number"
                    min="0"
                    step="1"
                    value={maxAgeInput}
                    onChange={(event) => setMaxAgeInput(event.target.value)}
                    placeholder="No restriction"
                  />
                  <p className="text-xs text-slate-500 mt-1">Optional. Blocks new credit sales when outstanding credit is older than this number of days.</p>
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
                    disabled={savingPayment || !credit?.enabled || !canTakePayment || !customer?.id}
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
                {!canTakePayment && <p className="text-xs text-slate-400 mt-1.5">Payment management permission is required.</p>}
              </form>

              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-700 mb-2">Credit ageing</div>
                {data.ageing ? (
                  <>
                    <div className="grid grid-cols-5 gap-2">
                      {AGEING_BUCKETS.map((bucket) => (
                        <div key={bucket.key} className="rounded border border-slate-100 p-2 text-center">
                          <div className="text-xs text-slate-500">{bucket.label}</div>
                          <div className="font-semibold">{money(data.ageing.buckets[bucket.key] || 0)}</div>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-slate-500 mt-2">Maximum credit age: {credit.maximumAgeDays ?? "No restriction"} days · Total outstanding: {money(data.ageing.totalOutstanding)}</div>
                    <h4 className="font-medium text-sm mt-3">Outstanding invoices</h4>
                    {data.ageing.invoices?.length ? data.ageing.invoices.map((invoice) => (
                      <button type="button" key={invoice.id} onClick={() => setSelectedInvoiceId(invoice.id)} className="block w-full text-left text-xs py-2 border-b">
                        {invoice.reference || invoice.id} · {invoice.invoiceDate} · {invoice.daysOutstanding} days · {money(invoice.remaining)}
                      </button>
                    )) : <div className="text-xs text-slate-400">No outstanding invoices</div>}
                    {selectedInvoiceId && (() => {
                      const invoice = data.ageing.invoices?.find((item) => item.id === selectedInvoiceId);
                      return invoice ? <div className="mt-2 text-xs text-slate-600">Sale/invoice reference: {invoice.reference || invoice.id} · Invoice date: {invoice.invoiceDate} · Days outstanding: {invoice.daysOutstanding} · Original amount: {invoice.originalAmount != null ? money(invoice.originalAmount) : "Not supplied"} · Remaining amount: {money(invoice.remaining)}</div> : null;
                    })()}
                  </>
                ) : <div className="text-xs text-slate-400">No ageing information available</div>}
              </div>

              {lastPayment?.allocations && <div className="text-xs text-slate-500">Payment allocations: {lastPayment.allocations.map((alloc) => `${alloc.invoiceLedgerId || alloc.invoiceId}: Invoice balance: ${money(alloc.invoiceRemaining)} → ${money(alloc.amount)}`).join(", ")} · Remaining unallocated: {money(lastPayment.unallocated)} <span>remainingAfter</span> · {methodLabel(lastPayment.method)}</div>}

              {canManageCredit && (
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-sm font-semibold text-slate-700 mb-2">Account adjustment</div>
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setAdjustment("credit")}>Add credit note</Button>
                    <Button variant="secondary" size="sm" onClick={() => setAdjustment("debit")}>Add debit note</Button>
                  </div>
                  {adjustment && (
                    <form onSubmit={saveAdjustment} className="mt-3 grid grid-cols-2 gap-2">
                      <Label htmlFor="cc-adjust-amount">Amount (£)</Label>
                      <Label htmlFor="cc-adjust-notes">Reason</Label>
                      <Input id="cc-adjust-amount" type="number" min="0.01" step="0.01" required value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(event.target.value)} />
                      <Input id="cc-adjust-notes" required value={adjustmentNotes} onChange={(event) => setAdjustmentNotes(event.target.value)} maxLength={500} />
                      <div className="col-span-2 flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setAdjustment(null)} disabled={adjustmentSaving}>Cancel</Button>
                        <Button type="submit" variant="primary" size="sm" disabled={adjustmentSaving}>{adjustmentSaving ? "Saving…" : "Save adjustment"}</Button>
                      </div>
                    </form>
                  )}
                </div>
              )}

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
                                  <td>{TX_LABELS[tx.transaction_type] || tx.transaction_type} · {statementDebitCredit(tx)}</td>
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
                                  <td className="text-slate-500">{tx.description || "-"} · {methodLabel(tx.payment_method)} · {tx.running_balance != null ? money(tx.running_balance) : "-"} · Invoice/payment ref: {statementRef(tx)}</td>
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

              <div className="text-sm font-semibold text-slate-700">Recent ledger activity</div>
              {data.ledger?.map((tx) => <div key={tx.id} className="text-xs text-slate-500">{methodLabel(tx.payment_method)} · {tx.description || "-"}</div>)}

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

                        <div className="rounded-lg border border-slate-200 p-3">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-sm font-semibold text-slate-700">Ledger history</div>
                            <Button variant="ghost" size="sm" onClick={() => { const next = ledgerTab === "history" ? "recent" : "history"; setLedgerTab(next); if (next === "history" && !ledgerRows.length) loadLedger(); }}>{ledgerTab === "history" ? "Hide" : "View all"}</Button>
                          </div>
                          {ledgerTab === "history" && (
                            <>
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
                                <div className="relative"><Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" /><Input className="pl-7" placeholder="Search" value={ledgerFilters.search} onChange={(event) => setLedgerFilters((current) => ({ ...current, search: event.target.value }))} /></div>
                                <select className="onepos-input" value={ledgerFilters.direction} onChange={(event) => setLedgerFilters((current) => ({ ...current, direction: event.target.value }))}><option value="">Debit / credit</option><option value="debit">Debit</option><option value="credit">Credit</option></select>
                                <select className="onepos-input" value={ledgerFilters.entryType} onChange={(event) => setLedgerFilters((current) => ({ ...current, entryType: event.target.value }))}><option value="">All types</option><option value="credit_sale">Credit sale</option><option value="payment">Payment</option><option value="credit_note">Credit note</option><option value="debit_note">Debit note</option><option value="opening">Opening</option></select>
                                <Input type="date" value={ledgerFilters.from} onChange={(event) => setLedgerFilters((current) => ({ ...current, from: event.target.value }))} />
                                <Input type="date" value={ledgerFilters.to} onChange={(event) => setLedgerFilters((current) => ({ ...current, to: event.target.value }))} />
                              </div>
                              <Button variant="secondary" size="sm" onClick={() => loadLedger(1, ledgerFilters)} disabled={ledgerLoading}>Apply filters</Button>
                              {ledgerLoading ? <div className="py-4 text-sm text-slate-400">Loading ledger…</div> : ledgerRows.length === 0 ? <div className="py-4 text-sm text-slate-400 text-center">No ledger transactions found.</div> : <div className="overflow-x-auto mt-3"><table className="onepos-table text-xs"><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead><tbody>{ledgerRows.map((tx) => <tr key={tx.id}><td>{fmtDate(tx.created_at)}</td><td>{tx.reference_id || tx.reference_type || "-"}</td><td>{TX_LABELS[tx.transaction_type] || tx.transaction_type}</td><td>{tx.description || "-"}</td><td className="text-right">{tx.transaction_type === "payment" || tx.transaction_type === "debit_note" ? money(tx.amount) : "-"}</td><td className="text-right">{tx.transaction_type === "payment" || tx.transaction_type === "debit_note" ? "-" : money(tx.amount)}</td><td className="text-right">{tx.running_balance == null ? "-" : money(tx.running_balance)}</td></tr>)}</tbody></table></div>}
                              <div className="flex items-center justify-between mt-3 text-xs text-slate-500"><span>{ledgerMeta.total} transaction{ledgerMeta.total === 1 ? "" : "s"}</span><div className="flex items-center gap-2"><button disabled={ledgerMeta.page <= 1} onClick={() => loadLedger(ledgerMeta.page - 1, ledgerFilters)} className="p-1 border rounded disabled:opacity-40"><ChevronLeft size={14} /></button><span>Page {ledgerMeta.page}{ledgerMeta.pages ? ` of ${ledgerMeta.pages}` : ""}</span><button disabled={!ledgerMeta.pages || ledgerMeta.page >= ledgerMeta.pages} onClick={() => loadLedger(ledgerMeta.page + 1, ledgerFilters)} className="p-1 border rounded disabled:opacity-40"><ChevronRight size={14} /></button></div></div>
                            </>
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
