import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";

/*
 * Stock by Store/Location view.
 *
 * Reads the authoritative store-scoped positions from
 * GET /api/inventory/stock (own store) or ?allStores=true (multi-store,
 * served only when the backend access model allows it — a 403 silently
 * falls back to the caller's own store). The company-wide figure is never
 * the primary value: each store is its own column and the total is an
 * explicitly labelled final column.
 */

const fmt = (n) => `${Number(n || 0) % 1 === 0 ? Number(n || 0) : Number(n || 0).toFixed(3)}`;

export default function StockByStore() {
  const [matrix, setMatrix] = useState(null); // { stores: [names], rows: [{name, sku, cells, total}], singleStore }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      setError("");

      let rows = [];
      let singleStore = false;
      let allStores = await apiRequest("/api/inventory/stock?allStores=true");

      if (allStores.success) {
        rows = allStores.data || [];
      } else if (allStores.status === 403) {
        singleStore = true;
        const own = await apiRequest("/api/inventory/stock");
        if (!own.success) throw new Error(own.message || "Unable to load stock");
        rows = (own.data || []).map((r) => ({ ...r, store_name: null }));
      } else {
        throw new Error(allStores.message || "Unable to load stock");
      }

      /* Build the product × store matrix. apiRequest throws on non-2xx in
       * some call sites; handle both shapes defensively. */
      const storeNames = [...new Set(rows.map((r) => r.store_name).filter(Boolean))].sort();
      const byProduct = new Map();
      for (const r of rows) {
        const key = r.productId || r.product_id;
        if (!byProduct.has(key)) {
          byProduct.set(key, { name: r.name, sku: r.sku || "", cells: new Map(), total: 0 });
        }
        const entry = byProduct.get(key);
        const qty = Number(r.quantity) || 0;
        const storeKey = r.store_name || r.storeName || "";
        entry.cells.set(storeKey, (entry.cells.get(storeKey) || 0) + qty);
        entry.total += qty;
      }

      setMatrix({
        stores: singleStore ? [] : storeNames,
        rows: [...byProduct.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
        singleStore,
      });
    } catch (err) {
      setError(err.message || "Unable to load stock by store");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-400">
        <RefreshCw size={28} className="mx-auto mb-3 animate-spin" />
        Loading stock by store...
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-sm text-red-600">{error}</div>;
  }

  if (!matrix.rows.length) {
    return (
      <div className="p-12 text-center text-slate-400">
        <div className="font-medium text-slate-600">No stock records</div>
        <div className="text-sm mt-1">Stock appears here once products receive opening stock or adjustments.</div>
      </div>
    );
  }

  const columns = matrix.singleStore ? ["Stock"] : [...matrix.stores, "Total"];

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {["Product", "SKU", ...columns].map((heading) => (
              <th
                key={heading}
                className={`px-3 py-2 text-xs uppercase text-slate-500 ${heading === "Total" ? "text-right font-semibold" : "text-left"}`}
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row, index) => (
            <tr key={`${row.name}-${index}`} className="border-t border-slate-100">
              <td className="px-3 py-2 text-sm">{row.name}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{row.sku || "—"}</td>
              {matrix.singleStore ? (
                <td className="px-3 py-2 text-sm text-right">{fmt(row.total)}</td>
              ) : (
                <>
                  {matrix.stores.map((store) => (
                    <td key={store} className="px-3 py-2 text-sm text-right">
                      {row.cells.get(store) ? fmt(row.cells.get(store)) : "0"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-sm text-right font-semibold">{fmt(row.total)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {matrix.singleStore && (
        <div className="p-3 text-xs text-slate-500 border-t border-slate-100">
          Showing your store only. Multi-store access is required to see stock at other locations.
        </div>
      )}
    </div>
  );
}
