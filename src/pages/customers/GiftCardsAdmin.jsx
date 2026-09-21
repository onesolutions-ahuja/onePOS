import { useEffect, useState } from "react";
import { Ban, Plus, RefreshCw, Search } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { Button, PageHeader } from "../../components/ui.jsx";

/*
 * Gift card administration: issue (physical + digital — one entity),
 * top up, block/unblock and view the ledger for any card. Company-scoped
 * server-side; permissions enforced by the API (giftcard.view / .issue /
 * .topup / .block / .adjust). Balance is derived from the immutable
 * gift_card_transactions ledger.
 */
function money(value) {
  return `£${(Number(value) || 0).toFixed(2)}`;
}

export default function GiftCardsAdmin() {
  const [cards, setCards] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showIssue, setShowIssue] = useState(false);
  const [detail, setDetail] = useState(null);

  const loadCards = async (value = search) => {
    try {
      setLoading(true);
      setError("");
      const suffix = value.trim() ? `?search=${encodeURIComponent(value.trim())}` : "";
      const data = await apiRequest(`/api/gift-cards${suffix}`);
      if (!data.success) throw new Error(data.message || "Unable to load gift cards");
      setCards(data.data || []);
    } catch (err) {
      setError(err.message || "Unable to load gift cards");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => loadCards(), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const openDetail = async (card) => {
    setError("");
    try {
      const data = await apiRequest(`/api/gift-cards/${card.id}`);
      if (!data.success) throw new Error(data.message || "Unable to load gift card");
      setDetail(data.data);
    } catch (err) {
      setError(err.message || "Unable to load gift card");
    }
  };

  const toggleBlock = async (card) => {
    setError("");
    setMessage("");
    try {
      const data = await apiRequest(`/api/gift-cards/${card.id}/block`, {
        method: "POST",
        body: JSON.stringify({ blocked: card.status !== "blocked" }),
      });
      if (!data.success) throw new Error(data.message || "Unable to update gift card");
      setMessage(data.message);
      await loadCards();
      if (detail && detail.id === card.id) await openDetail(card);
    } catch (err) {
      setError(err.message || "Unable to update gift card");
    }
  };

  const statusBadge = (card) => {
    if (card.status === "blocked") return "Blocked";
    if (card.status === "expired") return "Expired";
    if (Number(card.balance) <= 0) return "Depleted";
    return "Active";
  };

  return (
    <div className="admin-page">
      <PageHeader
        title="Gift Cards"
        subtitle="Issue, top up and manage physical and digital gift cards."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => loadCards()}>
              <RefreshCw size={15} /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowIssue(true)}>
              <Plus size={15} /> Issue gift card
            </Button>
          </>
        }
      />

      <div className="p-4 space-y-4">
        {error && <div role="alert" className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
        {message && <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm">{message}</div>}

        <div className="relative max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by card code or reference…"
            className="w-full h-10 pl-9 pr-3 border border-slate-200 rounded-lg text-sm"
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Issued</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
              ) : cards.length ? (
                cards.map((card) => (
                  <tr key={card.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs">{card.code}</td>
                    <td className="px-4 py-3 text-slate-500">{card.reference_number || "—"}</td>
                    <td className="px-4 py-3">{card.customer_name || <span className="text-slate-400">Bearer</span>}</td>
                    <td className="px-4 py-3 font-medium">{money(card.balance)}</td>
                    <td className="px-4 py-3">
                      <span className={card.status === "blocked" ? "text-red-600" : Number(card.balance) <= 0 ? "text-slate-500" : "text-emerald-700"}>
                        {statusBadge(card)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{card.issued_at ? new Date(card.issued_at).toLocaleDateString("en-GB") : "—"}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openDetail(card)} className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded">Ledger</button>
                      {card.status !== "expired" && (
                        <button onClick={() => toggleBlock(card)} className="ml-1 px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded inline-flex items-center gap-1">
                          <Ban size={12} /> {card.status === "blocked" ? "Unblock" : "Block"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No gift cards yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showIssue && (
        <IssueCardModal
          onClose={() => setShowIssue(false)}
          onIssued={async (msg) => {
            setShowIssue(false);
            setMessage(msg);
            await loadCards();
          }}
        />
      )}

      {detail && (
        <TopUpLedgerModal
          card={detail}
          onClose={() => setDetail(null)}
          onChanged={async (msg) => {
            setMessage(msg);
            await openDetail(detail);
            await loadCards();
          }}
        />
      )}
    </div>
  );
}

function IssueCardModal({ onClose, onIssued }) {
  const [form, setForm] = useState({ value: "", code: "", referenceNumber: "", customerId: "", expiresAt: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Value must be greater than zero.");
      return;
    }
    try {
      setSaving(true);
      const data = await apiRequest("/api/gift-cards", {
        method: "POST",
        body: JSON.stringify({
          value,
          code: form.code.trim() || undefined,
          referenceNumber: form.referenceNumber.trim() || undefined,
          customerId: form.customerId || undefined,
          expiresAt: form.expiresAt || undefined,
        }),
      });
      if (!data.success) throw new Error(data.message || "Unable to issue gift card");
      onIssued(`${data.message}: ${data.data.code} (${money(data.data.balance)})`);
    } catch (err) {
      setError(err.message || "Unable to issue gift card");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl w-full max-w-md shadow-2xl">
        <div className="p-4 border-b font-bold text-lg">Issue gift card</div>
        <div className="p-4 space-y-3">
          {error && <div role="alert" className="p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Initial value (£)</span>
            <input autoFocus type="number" step="0.01" min="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="w-full h-10 px-3 border border-slate-200 rounded-lg" required />
          </label>
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Card code (blank = auto-generate)</span>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. ABCD-1234-WXYZ" className="w-full h-10 px-3 border border-slate-200 rounded-lg font-mono" />
          </label>
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Printed / batch reference (optional)</span>
            <input value={form.referenceNumber} onChange={(e) => setForm({ ...form, referenceNumber: e.target.value })} className="w-full h-10 px-3 border border-slate-200 rounded-lg" />
          </label>
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Expiry (optional)</span>
            <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="w-full h-10 px-3 border border-slate-200 rounded-lg" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-10 px-4 border border-slate-200 rounded-lg text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? "Issuing…" : "Issue card"}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function TopUpLedgerModal({ card, onClose, onChanged }) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const topUp = async (event) => {
    event.preventDefault();
    setError("");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Top-up must be greater than zero.");
      return;
    }
    try {
      setSaving(true);
      const data = await apiRequest(`/api/gift-cards/${card.id}/topup`, {
        method: "POST",
        body: JSON.stringify({ amount: value }),
      });
      if (!data.success) throw new Error(data.message || "Unable to top up");
      setAmount("");
      onChanged(data.message);
    } catch (err) {
      setError(err.message || "Unable to top up");
    } finally {
      setSaving(false);
    }
  };

  const typeLabel = (t) => ({ issue: "Issued", topup: "Top-up", redeem: "Redeemed", adjustment: "Adjustment", refund: "Refund" }[t] || t);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center shrink-0">
          <div>
            <h2 className="font-bold text-lg font-mono">{card.code}</h2>
            <p className="text-sm text-slate-500">Balance: {money(card.balance)} · {card.status}</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1 hover:bg-slate-100 rounded">✕</button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {error && <div role="alert" className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          {card.status !== "blocked" && card.status !== "expired" && (
            <form onSubmit={topUp} className="mb-4 flex items-end gap-2">
              <label className="text-sm text-slate-600">
                <span className="block mb-1 font-medium">Top-up amount (£)</span>
                <input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-40 h-10 px-3 border border-slate-200 rounded-lg" />
              </label>
              <button type="submit" disabled={saving} className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? "Saving…" : "Top up"}</button>
            </form>
          )}
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">Balance after</th><th className="px-3 py-2">Description</th>
            </tr></thead>
            <tbody>
              {(card.transactions || []).map((tx) => (
                <tr key={tx.id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-xs text-slate-500">{new Date(tx.created_at).toLocaleString("en-GB")}</td>
                  <td className="px-3 py-1.5">{typeLabel(tx.transaction_type)}</td>
                  <td className={`px-3 py-1.5 ${tx.transaction_type === "redeem" ? "text-red-600" : "text-emerald-700"}`}>{tx.transaction_type === "redeem" ? "-" : ""}{money(Math.abs(tx.amount))}</td>
                  <td className="px-3 py-1.5">{money(tx.balance_after)}</td>
                  <td className="px-3 py-1.5 text-slate-500 text-xs">{tx.description || "—"}</td>
                </tr>
              ))}
              {!(card.transactions || []).length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No transactions.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
