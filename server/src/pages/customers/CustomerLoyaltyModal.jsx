import { useState, useEffect } from "react";
import { Clock, Gift, RotateCcw, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

export default function CustomerLoyaltyModal({ customer, onClose }) {
  const [loyaltyData, setLoyaltyData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (customer) {
      loadLoyalty();
    }
  }, [customer]);

  const loadLoyalty = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest(`/api/customers/${customer.id}/loyalty`);
      if (!data.success) {
        throw new Error(data.message || "Unable to load loyalty data");
      }
      setLoyaltyData(data.data);
    } catch (err) {
      console.error("Load loyalty error:", err);
      setError(err.message || "Unable to load loyalty data");
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getTransactionIcon = (type) => {
    switch (type) {
      case "EARN":
        return <Gift size={16} className="text-emerald-600" />;
      case "REVERSE":
        return <RotateCcw size={16} className="text-orange-600" />;
      default:
        return <Clock size={16} className="text-slate-500" />;
    }
  };

  const getTransactionLabel = (type) => {
    switch (type) {
      case "EARN":
        return "Earned";
      case "REVERSE":
        return "Reversed";
      default:
        return type;
    }
  };

  if (!customer) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[80vh] shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center shrink-0">
          <div>
            <h2 className="font-bold text-lg">Loyalty History</h2>
            <p className="text-sm text-slate-500">{customer.name}</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1 hover:bg-slate-100 rounded">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Clock size={24} className="animate-spin text-slate-400" />
              <span className="ml-2 text-slate-400">Loading loyalty data...</span>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <div className="text-red-600 font-medium">{error}</div>
              <button
                onClick={loadLoyalty}
                className="mt-3 h-9 px-4 bg-blue-600 text-white rounded-lg text-sm"
              >
                Try Again
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6 p-4 bg-slate-50 rounded-lg">
                <div className="text-sm text-slate-500 mb-1">Current Balance</div>
                <div className="text-3xl font-bold text-slate-800">
                  £{Number(loyaltyData.balance || 0).toFixed(2)}
                </div>
              </div>

              {loyaltyData.transactions.length === 0 ? (
                <div className="text-center py-8">
                  <Gift size={32} className="mx-auto mb-2 text-slate-300" />
                  <div className="text-slate-500 font-medium">No loyalty transactions</div>
                  <div className="text-sm text-slate-400 mt-1">
                    Loyalty transactions will appear here
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {loyaltyData.transactions.map((entry) => (
                    <div
                      key={entry.id}
                      className="border border-slate-200 rounded-lg p-3 bg-slate-50"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">{getTransactionIcon(entry.transaction_type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm">
                              {getTransactionLabel(entry.transaction_type)}
                            </span>
                            <span className={`text-sm font-medium ${
                              entry.amount >= 0 ? "text-emerald-600" : "text-orange-600"
                            }`}>
                              {entry.amount >= 0 ? "+" : ""}£{Number(entry.amount).toFixed(2)}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {formatDate(entry.created_at)}
                            {entry.full_name && ` • ${entry.full_name}`}
                          </div>
                          {entry.description && (
                            <div className="text-xs text-slate-600 mt-1">{entry.description}</div>
                          )}
                          <div className="text-xs text-slate-400 mt-1">
                            Balance after: £{Number(entry.balance_after).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t shrink-0">
          <button
            onClick={onClose}
            className="w-full h-9 px-4 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
