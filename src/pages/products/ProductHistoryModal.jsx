import { useState, useEffect } from "react";
import { Clock, X, Package, Edit, Trash2 } from "lucide-react";
import { apiRequest } from "../../services/api.js";

export default function ProductHistoryModal({ product, onClose }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (product) {
      loadHistory();
    }
  }, [product]);

  const loadHistory = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest(`/api/products/${product.id}/history`);
      if (!data.success) {
        throw new Error(data.message || "Unable to load history");
      }
      setHistory(data.data || []);
    } catch (err) {
      console.error("Load history error:", err);
      setError(err.message || "Unable to load history");
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

  const getActionIcon = (action) => {
    switch (action) {
      case "product.created":
        return <Package size={16} className="text-emerald-600" />;
      case "product.updated":
        return <Edit size={16} className="text-blue-600" />;
      case "product.deleted":
        return <Trash2 size={16} className="text-red-600" />;
      default:
        return <Clock size={16} className="text-slate-500" />;
    }
  };

  const getActionLabel = (action) => {
    switch (action) {
      case "product.created":
        return "Product created";
      case "product.updated":
        return "Product updated";
      case "product.deleted":
        return "Product deactivated";
      default:
        return action;
    }
  };

  const renderChangeDetails = (details) => {
    if (!details || !details.changes || !Array.isArray(details.changes)) {
      return null;
    }

    return (
      <div className="mt-2 space-y-1">
        {details.changes.map((change, idx) => (
          <div key={idx} className="text-xs text-slate-600">
            <span className="font-medium">{change.field}:</span>
            <span className="ml-1">
              {change.previous !== null && change.previous !== undefined ? (
                <span className="line-through text-slate-400">{formatValue(change.field, change.previous)}</span>
              ) : (
                <span className="text-slate-400 italic">none</span>
              )}
            </span>
            <span className="mx-1">→</span>
            <span className="text-slate-700">{formatValue(change.field, change.new)}</span>
          </div>
        ))}
      </div>
    );
  };

  const formatValue = (field, value) => {
    if (value === null || value === undefined) return "—";
    if (field === "price" || field === "vat_rate") {
      return `£${Number(value).toFixed(2)}`;
    }
    if (field === "active") {
      return value ? "Active" : "Inactive";
    }
    if (field === "age_restricted") {
      return value ? "Yes" : "No";
    }
    return String(value);
  };

  if (!product) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[80vh] shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center shrink-0">
          <div>
            <h2 className="font-bold text-lg">Product History</h2>
            <p className="text-sm text-slate-500">{product.name}</p>
          </div>
          <button onClick={onClose} title="Close" className="p-1 hover:bg-slate-100 rounded">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Clock size={24} className="animate-spin text-slate-400" />
              <span className="ml-2 text-slate-400">Loading history...</span>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <div className="text-red-600 font-medium">{error}</div>
              <button
                onClick={loadHistory}
                className="mt-3 h-9 px-4 bg-blue-600 text-white rounded-lg text-sm"
              >
                Try Again
              </button>
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-8">
              <Clock size={32} className="mx-auto mb-2 text-slate-300" />
              <div className="text-slate-500 font-medium">No history available</div>
              <div className="text-sm text-slate-400 mt-1">
                Product changes will appear here
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="border border-slate-200 rounded-lg p-3 bg-slate-50"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getActionIcon(entry.action)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">
                          {getActionLabel(entry.action)}
                        </span>
                        <span className="text-xs text-slate-400 shrink-0">
                          {formatDate(entry.created_at)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        by {entry.full_name || entry.username || "Unknown"}
                      </div>
                      {renderChangeDetails(entry.details)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
