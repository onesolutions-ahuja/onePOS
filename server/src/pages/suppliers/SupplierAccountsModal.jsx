import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

export default function SupplierAccountsModal({ supplier, suppliers = [], canManage = false, canManagePayments = false, onClose }) {
  const [tab, setTab] = useState("invoices");
  const [invoices, setInvoices] = useState([]);
  const [statement, setStatement] = useState([]);
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [ledgerMeta, setLedgerMeta] = useState({ page: 1, pageSize: 10, total: 0, pages: 0 });
  const [ledgerFilters, setLedgerFilters] = useState({ search: "", entryType: "", debit: "" });
  const [ledgerPage, setLedgerPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(null);

  const loadAccounts = async (requestedPage = ledgerPage, filters = ledgerFilters) => {
    try {
      setLoading(true);
      setError("");
      const query = new URLSearchParams({ page: String(requestedPage), pageSize: "10" });
      if (filters.search.trim()) query.set("search", filters.search.trim());
      if (filters.entryType) query.set("entryType", filters.entryType);
      if (filters.debit !== "") query.set("debit", filters.debit);
      const [invoiceResult, statementResult, summaryResult, ledgerResult] = await Promise.all([
        apiRequest(`/api/supplier-invoices?supplierId=${encodeURIComponent(supplier.id)}`),
        apiRequest(`/api/suppliers/${supplier.id}/statement`),
        apiRequest(`/api/suppliers/${supplier.id}/summary`),
        apiRequest(`/api/suppliers/${supplier.id}/ledger?${query.toString()}`),
      ]);
      if (!invoiceResult.success) throw new Error(invoiceResult.message || "Unable to load supplier invoices");
      if (!statementResult.success) throw new Error(statementResult.message || "Unable to load supplier statement");
      if (!summaryResult.success) throw new Error(summaryResult.message || "Unable to load supplier account summary");
      if (!ledgerResult.success) throw new Error(ledgerResult.message || "Unable to load supplier ledger");
      setInvoices(Array.isArray(invoiceResult.data) ? invoiceResult.data : []);
      setStatement(Array.isArray(statementResult.data) ? statementResult.data : []);
      setSummary(summaryResult.data || null);
      setLedger(Array.isArray(ledgerResult.data) ? ledgerResult.data : []);
      setLedgerMeta({
        page: Number(ledgerResult.page) || requestedPage,
        pageSize: Number(ledgerResult.pageSize) || 10,
        total: Number(ledgerResult.total) || 0,
        pages: Number(ledgerResult.pages) || 0,
      });
      setLedgerPage(Number(ledgerResult.page) || requestedPage);
    } catch (err) {
      setError(err.message || "Unable to load supplier accounting");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAccounts(1, ledgerFilters); }, [supplier.id]);

  const submitInvoice = async (form) => {
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest("/api/supplier-invoices", { method: "POST", body: JSON.stringify({ ...form, supplierId: supplier.id }) });
      if (!result.success) throw new Error(result.message || "Unable to create supplier invoice");
      setShowInvoiceForm(false);
      setMessage("Supplier invoice created.");
      await loadAccounts();
    } catch (err) {
      setError(err.message || "Unable to create supplier invoice");
    } finally {
      setSaving(false);
    }
  };

  const submitPayment = async (form) => {
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest("/api/supplier-payments", {
        method: "POST",
        body: JSON.stringify({ ...form, supplierId: supplier.id, idempotencyKey: `web-${crypto.randomUUID()}` }),
      });
      if (!result.success) throw new Error(result.message || "Unable to record supplier payment");
      setShowPaymentForm(false);
      setMessage("Supplier payment recorded.");
      await loadAccounts();
    } catch (err) {
      setError(err.message || "Unable to record supplier payment");
    } finally {
      setSaving(false);
    }
  };

  const submitAdjustment = async (form) => {
    setSaving(true);
    setError("");
    try {
      const endpoint = form.kind === "CREDIT"
        ? (form.creditNote ? "/api/supplier-credit-notes" : "/api/supplier-credits")
        : "/api/supplier-debits";
      const result = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.id,
          amount: Number(form.amount),
          debit: form.kind === "DEBIT",
          storeId: form.storeId || undefined,
          reference: form.reference.trim() || undefined,
          description: form.description.trim() || undefined,
          idempotencyKey: `web-${crypto.randomUUID()}`,
        }),
      });
      if (!result.success) throw new Error(result.message || "Unable to save supplier adjustment");
      setShowAdjustmentForm(null);
      setMessage(form.creditNote ? "Supplier credit note recorded." : `Supplier ${form.kind.toLowerCase()} recorded.`);
      await loadAccounts(1, ledgerFilters);
    } catch (err) {
      setError(err.message || "Unable to save supplier adjustment");
    } finally {
      setSaving(false);
    }
  };

  const applyLedgerFilters = () => {
    setLedgerPage(1);
    loadAccounts(1, ledgerFilters);
  };

  const changeLedgerPage = (page) => {
    if (page < 1 || (ledgerMeta.pages && page > ledgerMeta.pages)) return;
    setLedgerPage(page);
    loadAccounts(page, ledgerFilters);
  };

  const outstanding = summary?.outstanding_balance ?? invoices.reduce(
    (total, invoice) => total + Number(invoice.outstanding_amount || 0), 0
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[1100px] max-w-full max-h-[90vh] shadow-2xl flex flex-col">
        <div className="p-5 border-b flex items-center justify-between">
          <div><h2 className="font-bold text-xl">{supplier.name} accounts</h2><p className="text-sm text-slate-500 mt-1">Invoices, payments and supplier statement</p></div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={20} /></button>
        </div>
        <div className="px-5 pt-4 border-b flex gap-2">
          {[
            ["invoices", "Invoices"],
            ["payments", "Payments"],
            ["statement", "Statement"],
            ["ledger", "Ledger"],
          ].map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`px-4 py-2 text-sm border-b-2 ${tab === key ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-slate-500"}`}>{label}</button>)}
        </div>
        <div className="p-5 overflow-auto">
          {message && <div className="mb-4 px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded text-sm">{message}</div>}
          {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}
          {summary && <AccountSummary summary={summary} />}
          {canManage && <div className="mb-5 flex flex-wrap gap-2">
            <button onClick={() => setShowAdjustmentForm({ kind: "CREDIT", creditNote: false })} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm flex items-center gap-2"><Plus size={15} /> Add Credit</button>
            <button onClick={() => setShowAdjustmentForm({ kind: "DEBIT", creditNote: false })} className="px-3 py-2 bg-amber-600 text-white rounded-lg text-sm flex items-center gap-2"><Plus size={15} /> Add Debit</button>
            <button onClick={() => setShowAdjustmentForm({ kind: "CREDIT", creditNote: true })} className="px-3 py-2 border border-emerald-600 text-emerald-700 rounded-lg text-sm">Credit Note</button>
          </div>}
          {loading ? <div className="p-12 text-center text-slate-400">Loading supplier accounts...</div> : (
            <>
              {tab === "invoices" && <InvoiceList invoices={invoices} canManage={canManage} onCreate={() => setShowInvoiceForm(true)} onRefresh={loadAccounts} />}
              {tab === "payments" && <PaymentPanel invoices={invoices} outstanding={outstanding} canManage={canManagePayments} onCreate={() => setShowPaymentForm(true)} onRefresh={loadAccounts} />}
              {tab === "statement" && <StatementTable statement={statement} outstanding={outstanding} />}
              {tab === "ledger" && <LedgerPanel ledger={ledger} meta={ledgerMeta} filters={ledgerFilters} setFilters={setLedgerFilters} onFilter={applyLedgerFilters} onPage={changeLedgerPage} />}
            </>
          )}
        </div>
      </div>
      {showInvoiceForm && <InvoiceForm saving={saving} onClose={() => setShowInvoiceForm(false)} onSubmit={submitInvoice} />}
      {showPaymentForm && <PaymentForm invoices={invoices} saving={saving} onClose={() => setShowPaymentForm(false)} onSubmit={submitPayment} />}
      {showAdjustmentForm && <AdjustmentForm config={showAdjustmentForm} saving={saving} onClose={() => setShowAdjustmentForm(null)} onSubmit={submitAdjustment} />}
    </div>
  );
}

function InvoiceList({ invoices, canManage, onCreate, onRefresh }) {
  return <section>
    <div className="flex items-center justify-between mb-4"><div><h3 className="font-semibold">Supplier invoices</h3><p className="text-sm text-slate-500">Outstanding balances are calculated by the server.</p></div><div className="flex gap-2"><button onClick={onRefresh} className="px-3 py-2 border rounded-lg text-sm flex gap-2 items-center"><RefreshCw size={15} /> Refresh</button>{canManage && <button onClick={onCreate} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">Add invoice</button>}</div></div>
    {invoices.length === 0 ? <div className="p-10 text-center text-slate-500 border rounded-lg">No supplier invoices recorded.</div> : <table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Invoice", "Invoice date", "Due date", "Total", "Outstanding", "Status"].map((heading) => <th key={heading} className="text-left px-3 py-2">{heading}</th>)}</tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-t"><td className="px-3 py-3 font-medium">{invoice.invoice_number}</td><td className="px-3 py-3">{invoice.invoice_date || "-"}</td><td className="px-3 py-3">{invoice.due_date || "-"}</td><td className="px-3 py-3 font-semibold">{money(invoice.total)}</td><td className="px-3 py-3">{money(invoice.outstanding_amount)}</td><td className="px-3 py-3"><span className={`px-2 py-1 rounded-full text-xs ${invoice.status === "PAID" ? "bg-emerald-50 text-emerald-700" : invoice.status === "PARTIALLY_PAID" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{invoice.status}</span></td></tr>)}</tbody></table>}
  </section>;
}

function PaymentPanel({ invoices, outstanding, canManage, onCreate, onRefresh }) {
  return <section>
    <div className="flex items-center justify-between mb-4"><div><h3 className="font-semibold">Supplier payments</h3><p className="text-sm text-slate-500">Outstanding supplier balance: <strong>{money(outstanding)}</strong></p></div><div className="flex gap-2"><button onClick={onRefresh} className="px-3 py-2 border rounded-lg text-sm flex gap-2 items-center"><RefreshCw size={15} /> Refresh</button>{canManage && <button onClick={onCreate} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">Record payment</button>}</div></div>
    {invoices.length === 0 ? <div className="p-10 text-center text-slate-500 border rounded-lg">Create an invoice before allocating a payment.</div> : <table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Invoice", "Total", "Paid", "Outstanding", "Status"].map((heading) => <th key={heading} className="text-left px-3 py-2">{heading}</th>)}</tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} className="border-t"><td className="px-3 py-3">{invoice.invoice_number}</td><td className="px-3 py-3">{money(invoice.total)}</td><td className="px-3 py-3">{money(invoice.paid_amount)}</td><td className="px-3 py-3 font-semibold">{money(invoice.outstanding_amount)}</td><td className="px-3 py-3">{invoice.status}</td></tr>)}</tbody></table>}
  </section>;
}

function StatementTable({ statement, outstanding }) {
  return <section><div className="flex items-center justify-between mb-4"><div><h3 className="font-semibold">Supplier statement</h3><p className="text-sm text-slate-500">Outstanding balance: <strong>{money(outstanding)}</strong></p></div></div>{statement.length === 0 ? <div className="p-10 text-center text-slate-500 border rounded-lg">No supplier ledger entries.</div> : <table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Date", "Reference", "Type", "Debit", "Credit", "Balance"].map((heading) => <th key={heading} className="text-left px-3 py-2">{heading}</th>)}</tr></thead><tbody>{statement.map((entry) => <tr key={entry.id} className="border-t"><td className="px-3 py-3 whitespace-nowrap">{new Date(entry.created_at).toLocaleDateString()}</td><td className="px-3 py-3">{entry.description || entry.reference_id || "-"}</td><td className="px-3 py-3">{entry.entry_type}</td><td className="px-3 py-3">{entry.debit ? money(entry.amount) : "-"}</td><td className="px-3 py-3">{entry.debit ? "-" : money(entry.amount)}</td><td className="px-3 py-3 font-semibold">{money(entry.running_balance)}</td></tr>)}</tbody></table>}</section>;
}

function AccountSummary({ summary }) {
  const cards = [
    ["Current balance", summary.ledger_balance],
    ["Total outstanding", summary.outstanding_balance],
    ["Total invoiced", summary.total_invoice_amount],
    ["Total paid", summary.total_paid],
    ["Credits", summary.total_credits],
    ["Debits", summary.total_debits],
  ];
  return <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
    {cards.map(([label, value]) => <div key={label} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
      <div className="text-xs uppercase font-semibold text-slate-500">{label}</div>
      <div className="text-lg font-bold text-slate-800 mt-1">{money(value)}</div>
    </div>)}
  </div>;
}

function LedgerPanel({ ledger, meta, filters, setFilters, onFilter, onPage }) {
  return <section>
    <div className="flex flex-wrap items-end gap-2 mb-4">
      <label className="text-sm text-slate-600 flex-1 min-w-[180px]"><span className="block mb-1 font-medium">Search</span><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") onFilter(); }} className="input pl-9" placeholder="Reference or description" /></div></label>
      <Field label="Type"><select value={filters.entryType} onChange={(event) => setFilters((current) => ({ ...current, entryType: event.target.value }))} className="input"><option value="">All types</option><option value="INVOICE">Invoice</option><option value="PAYMENT">Payment</option><option value="RETURN_CREDIT">Credit</option><option value="OPENING">Debit / Opening</option></select></Field>
      <Field label="Direction"><select value={filters.debit} onChange={(event) => setFilters((current) => ({ ...current, debit: event.target.value }))} className="input"><option value="">All</option><option value="true">Debit</option><option value="false">Credit</option></select></Field>
      <button onClick={onFilter} className="h-10 px-3 border rounded-lg text-sm">Apply</button>
    </div>
    {ledger.length === 0 ? <div className="p-10 text-center text-slate-500 border rounded-lg">No ledger activity found.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr>{["Date", "Reference", "Type", "Description", "Store", "Debit", "Credit", "Balance"].map((heading) => <th key={heading} className="text-left px-3 py-2">{heading}</th>)}</tr></thead><tbody>{ledger.map((entry) => <tr key={entry.id} className="border-t"><td className="px-3 py-3 whitespace-nowrap">{entry.created_at ? new Date(entry.created_at).toLocaleDateString() : "-"}</td><td className="px-3 py-3">{entry.reference || entry.reference_id || "-"}</td><td className="px-3 py-3">{entry.entry_type || "-"}</td><td className="px-3 py-3 max-w-[220px] truncate" title={entry.description || ""}>{entry.description || "-"}</td><td className="px-3 py-3">{entry.store_id || "-"}</td><td className="px-3 py-3">{entry.debit ? money(entry.amount) : "-"}</td><td className="px-3 py-3">{entry.debit ? "-" : money(entry.amount)}</td><td className="px-3 py-3 font-semibold">{entry.running_balance == null ? "-" : money(entry.running_balance)}</td></tr>)}</tbody></table></div>}
    <div className="flex items-center justify-between mt-4 text-sm text-slate-500"><span>{meta.total} entr{meta.total === 1 ? "y" : "ies"}</span><div className="flex items-center gap-2"><button disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} className="p-2 border rounded disabled:opacity-40" title="Previous page"><ChevronLeft size={16} /></button><span>Page {meta.page}{meta.pages ? ` of ${meta.pages}` : ""}</span><button disabled={!meta.pages || meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)} className="p-2 border rounded disabled:opacity-40" title="Next page"><ChevronRight size={16} /></button></div></div>
  </section>;
}

function AdjustmentForm({ config, saving, onClose, onSubmit }) {
  const [form, setForm] = useState({ amount: "", storeId: "", reference: "", description: "" });
  const [error, setError] = useState("");
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a positive amount.");
      return;
    }
    if (config.creditNote && !form.reference.trim()) {
      setError("A credit note reference is required.");
      return;
    }
    onSubmit({ ...form, amount, kind: config.kind, creditNote: config.creditNote });
  };
  const title = config.creditNote ? "Add supplier credit note" : `Add supplier ${config.kind.toLowerCase()}`;
  return <FormShell title={title} saving={saving} onClose={onClose} onSubmit={submit}>
    {error && <div className="col-span-2 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}
    <Field label="Amount *"><input autoFocus required type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => update("amount", event.target.value)} className="input" /></Field>
    <Field label={config.creditNote ? "Credit note number *" : "Reference"}><input required={config.creditNote} value={form.reference} onChange={(event) => update("reference", event.target.value)} className="input" /></Field>
    <Field label="Store ID (optional)"><input value={form.storeId} onChange={(event) => update("storeId", event.target.value)} className="input" placeholder="Leave blank for current store scope" /></Field>
    <Field label="Reason / notes"><textarea rows="2" value={form.description} onChange={(event) => update("description", event.target.value)} className="input" /></Field>
  </FormShell>;
}

function Field({ label, children }) { return <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">{label}</span>{children}</label>; }

function InvoiceForm({ saving, onClose, onSubmit }) {
  const [form, setForm] = useState({ invoiceNumber: "", invoiceDate: new Date().toISOString().slice(0, 10), dueDate: "", subtotal: "", tax: "0", total: "", purchaseId: "", notes: "" });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <FormShell title="Add supplier invoice" saving={saving} onClose={onClose} onSubmit={(event) => { event.preventDefault(); onSubmit({ ...form, subtotal: Number(form.subtotal || form.total), tax: Number(form.tax || 0), total: Number(form.total) }); }}>
    <Field label="Invoice number *"><input required value={form.invoiceNumber} onChange={(event) => update("invoiceNumber", event.target.value)} className="input" /></Field>
    <Field label="Invoice date"><input type="date" value={form.invoiceDate} onChange={(event) => update("invoiceDate", event.target.value)} className="input" /></Field>
    <Field label="Due date"><input type="date" value={form.dueDate} onChange={(event) => update("dueDate", event.target.value)} className="input" /></Field>
    <Field label="Subtotal"><input type="number" min="0" step="0.01" value={form.subtotal} onChange={(event) => update("subtotal", event.target.value)} className="input" /></Field>
    <Field label="Tax / VAT"><input type="number" min="0" step="0.01" value={form.tax} onChange={(event) => update("tax", event.target.value)} className="input" /></Field>
    <Field label="Total *"><input required type="number" min="0" step="0.01" value={form.total} onChange={(event) => update("total", event.target.value)} className="input" /></Field>
    <Field label="Purchase reference"><input value={form.purchaseId} onChange={(event) => update("purchaseId", event.target.value)} className="input" placeholder="Optional purchase ID" /></Field>
    <Field label="Notes"><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} className="input" rows="2" /></Field>
  </FormShell>;
}

function PaymentForm({ invoices, saving, onClose, onSubmit }) {
  const [form, setForm] = useState({ amount: "", paymentDate: new Date().toISOString().slice(0, 10), paymentMethod: "BANK_TRANSFER", reference: "", allocations: {} });
  const amount = Number(form.amount || 0);
  const updateAllocation = (id, value) => setForm((current) => ({ ...current, allocations: { ...current.allocations, [id]: value } }));
  const allocations = Object.entries(form.allocations).filter(([, value]) => Number(value) > 0).map(([invoiceId, value]) => ({ invoiceId, amount: Number(value) }));
  return <FormShell title="Record supplier payment" saving={saving} onClose={onClose} onSubmit={(event) => { event.preventDefault(); onSubmit({ amount, paymentDate: form.paymentDate, paymentMethod: form.paymentMethod, reference: form.reference, allocations }); }}>
    <Field label="Amount *"><input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} className="input" /></Field>
    <Field label="Payment date"><input type="date" value={form.paymentDate} onChange={(event) => setForm((current) => ({ ...current, paymentDate: event.target.value }))} className="input" /></Field>
    <Field label="Payment method"><select value={form.paymentMethod} onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))} className="input"><option>BANK_TRANSFER</option><option>CARD</option><option>CASH</option><option>CHEQUE</option></select></Field>
    <Field label="Reference"><input value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} className="input" /></Field>
    <div className="col-span-2"><div className="font-medium text-sm mb-2">Invoice allocations</div>{invoices.filter((invoice) => Number(invoice.outstanding_amount) > 0).map((invoice) => <label key={invoice.id} className="grid grid-cols-[1fr_150px] gap-3 items-center text-sm mb-2"><span>{invoice.invoice_number} — {money(invoice.outstanding_amount)} outstanding</span><input type="number" min="0" max={invoice.outstanding_amount} step="0.01" value={form.allocations[invoice.id] || ""} onChange={(event) => updateAllocation(invoice.id, event.target.value)} className="input" /></label>)}<div className="text-sm text-slate-500 mt-2">Allocated: {money(allocations.reduce((total, item) => total + item.amount, 0))} of {money(amount)}</div></div>
  </FormShell>;
}

function FormShell({ title, saving, onClose, onSubmit, children }) {
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"><form onSubmit={onSubmit} className="bg-white rounded-xl w-[680px] max-w-full shadow-2xl"><div className="p-5 border-b flex items-center justify-between"><h2 className="font-bold text-xl">{title}</h2><button type="button" onClick={onClose} disabled={saving} className="p-2 hover:bg-slate-100 rounded"><X size={20} /></button></div><div className="p-5 grid grid-cols-2 gap-4">{children}</div><div className="p-5 border-t flex justify-end gap-2"><button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 border rounded-lg">Cancel</button><button disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg">{saving ? "Saving..." : "Save"}</button></div></form></div>;
}
