import { useEffect, useMemo, useState } from "react";
import { Flame, Grid3X3, Package, RefreshCw, Search } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { loadCatalogueCache } from "../../services/catalogueCache.js";
import { getTenantFromToken } from "../../services/offlineStore.js";
import CodeScannerModal from "./CodeScannerModal.jsx";

/*
 * Till product browser (image + compact views).
 *
 * Categories are loaded from the database via GET /api/categories
 * (company-scoped, display_order preserved) — NOT hardcoded. A "Most
 * Selling" pseudo-category at the top ranks products by transaction
 * frequency (COUNT(DISTINCT sale_id), see routes/products.js), not by
 * quantity. Presentation (image/compact) is driven by the company
 * product_view setting; both views render the same product objects and
 * call the same onAddProduct → existing basket flow.
 */

const MOST_SELLING = "__most_selling__";

function ProductGrid({
  category,
  onCategoryChange,
  search,
  onSearchChange,
  loadingProducts,
  productError,
  onRetry,
  filtered,
  onAddProduct,
  productView = "image",
  children,
}) {
  /* ------------------------------------------------ database categories */
  const [dbCategories, setDbCategories] = useState([]);
  const [mostSellingIds, setMostSellingIds] = useState(null); // null = not loaded / not selected
  const [scannerOpen, setScannerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tenant = getTenantFromToken();
    if (tenant) {
      loadCatalogueCache(tenant).then((catalogue) => {
        if (!cancelled && Array.isArray(catalogue?.categories)) {
          const categories = catalogue.categories
            .filter((category) => category.active !== false)
            .map((category) => category.name)
            .filter(Boolean);
          setDbCategories(categories);
          if (categories.length) return;
        }
        if (!cancelled) loadCategoriesFromServer();
      }).catch(() => {
        if (!cancelled) loadCategoriesFromServer();
      });
    } else {
      loadCategoriesFromServer();
    }
    function loadCategoriesFromServer() {
      apiRequest("/api/categories", { signal: AbortSignal.timeout(10000) })
      .then((data) => {
        if (!cancelled && data.success && Array.isArray(data.data)) {
          setDbCategories(data.data.map((c) => c.name).filter(Boolean));
        }
      })
      .catch(() => {
        /* Non-fatal: the pane still shows "All"/"Most Selling"; product
           filtering by category name still works against product data. */
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  /* --------------------------------------------- most-selling frequency */
  useEffect(() => {
    if (category !== MOST_SELLING || mostSellingIds !== null) return;
    let cancelled = false;
    apiRequest("/api/products/most-selling", { signal: AbortSignal.timeout(10000) })
      .then((data) => {
        if (cancelled) return;
        if (data.success && Array.isArray(data.data)) {
          // Server order = the frequency ranking. Search still narrows on top.
          setMostSellingIds(data.data.map((p) => p.id));
        } else {
          setMostSellingIds([]);
        }
      })
      .catch(() => {
        if (!cancelled) setMostSellingIds([]);
      });
    return () => {
      cancelled = true;
    };
  }, [category, mostSellingIds]);

  /* Reset the cached ranking when leaving Most Selling so re-entry
     refetches fresh frequency data. */
  useEffect(() => {
    if (category !== MOST_SELLING) setMostSellingIds(null);
  }, [category]);

  const categoryItems = useMemo(
    () => ["All", MOST_SELLING, ...dbCategories],
    [dbCategories]
  );

  /* Most Selling: present products in ranked order (the filtered list keeps
     search/active behaviour; ordering comes from the frequency ranking). */
  const displayProducts = useMemo(() => {
    if (category !== MOST_SELLING || !Array.isArray(mostSellingIds)) return filtered;
    const rank = new Map(mostSellingIds.map((id, index) => [id, index]));
    return [...filtered].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
  }, [category, mostSellingIds, filtered]);

  return (
    <>
      <aside className="hidden md:flex md:flex-col md:w-[120px] xl:w-[150px] bg-white border-r border-slate-200 p-2 shrink-0 overflow-y-auto md:overflow-x-hidden">
        <div className="text-[10px] font-bold text-slate-400 px-2 py-2">
          CATEGORIES
        </div>

        {categoryItems.map((item) => {
          const label = item === MOST_SELLING ? "Most Selling" : item;
          return (
            <button
              key={item}
              onClick={() => onCategoryChange(item)}
              className={`w-full text-left px-3 py-3 rounded-md mb-1 text-sm font-medium flex items-center gap-1.5 ${
                category === item
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item === MOST_SELLING && <Flame size={14} className="shrink-0" />}
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </aside>

      <section className="flex-1 flex flex-col min-w-0 p-3">
        {/* Phone tier (<md): the 150px fixed category rail becomes a
            horizontally scrollable chip row — same onCategoryChange
            contract, purely presentational. Hidden at md+, where the
            vertical rail above takes over. */}
        <div className="md:hidden -mx-1 mb-2 flex items-center gap-1.5 overflow-x-auto pb-1">
          {categoryItems.map((item) => {
            const label = item === MOST_SELLING ? "Most Selling" : item;
            return (
              <button
                key={item}
                onClick={() => onCategoryChange(item)}
                className={`shrink-0 whitespace-nowrap px-3 py-2 rounded-full text-xs font-medium border ${
                  category === item
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-600 border-slate-200"
                }`}
              >
                {item === MOST_SELLING && <Flame size={12} className="inline mr-1 -mt-0.5" />}
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search
              size={19}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />

            <input
              value={search}
              onChange={(e) =>
                onSearchChange(
                  e.target.value
                )
              }
              placeholder="Search product, SKU or barcode..."
              className="w-full h-12 bg-white border border-slate-200 rounded-md pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="button"
            data-testid="pos-search-code-button"
            onClick={() => setScannerOpen(true)}
            className="shrink-0 px-3 h-12 bg-white border border-slate-200 rounded-md text-sm hover:bg-slate-50"
          >
            Search Code
          </button>

          <button className="w-12 h-12 bg-white border border-slate-200 rounded-md flex items-center justify-center">
            <Grid3X3 size={20} />
          </button>

          <button
            onClick={onRetry}
            className="shrink-0 px-3 sm:px-4 h-12 bg-white border border-slate-200 rounded-md text-sm hover:bg-slate-50 flex items-center gap-2"
          >
            <RefreshCw size={16} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingProducts ? (
            <div className="h-full flex items-center justify-center text-slate-400">
              Loading products...
            </div>
          ) : productError ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-red-600 font-medium">
                  {productError}
                </div>

                <button
                  onClick={onRetry}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md text-sm"
                >
                  Try Again
                </button>
              </div>
            </div>
          ) : displayProducts.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-400">
              <div className="text-center">
                <Package
                  size={42}
                  className="mx-auto mb-3"
                />

                <div className="font-medium">
                  No products found
                </div>

                <div className="text-xs mt-1">
                  Try another search.
                </div>
              </div>
            </div>
          ) : productView === "compact" ? (
            /* ---------------------------------------- COMPACT VIEW */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
              {displayProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => onAddProduct(product)}
                  className="bg-white border border-slate-200 rounded-md px-3 h-11 flex items-center justify-between gap-2 text-left hover:border-blue-500 active:scale-[0.99] transition"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-sm truncate leading-tight">
                      {product.name}
                    </span>
                    {product.sku ? (
                      <span className="block text-[11px] text-slate-400 truncate leading-tight">
                        {product.sku}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-bold text-sm whitespace-nowrap">
                    £{Number(product.price || 0).toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            /* ------------------------------------------ IMAGE VIEW
               Portrait-ish cards: narrower (5 columns on the till) with a
               taller image box; images use object-contain so the WHOLE
               photo compresses into the fixed box (never stretches the
               box or gets cropped). */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {displayProducts.map(
                (product) => (
                  <button
                    key={product.id}
                    onClick={() =>
                      onAddProduct(product)
                    }
                    className="bg-white border border-slate-200 rounded-md p-2 text-left hover:border-blue-500 hover:shadow-sm active:scale-[0.98] transition"
                  >
                    <div className="h-44 bg-slate-100 rounded flex items-center justify-center overflow-hidden">
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt={product.name}
                          className="w-full h-full object-contain"
                          loading="lazy"
                          onError={(event) => {
                            /* Broken/missing image: fall back to the placeholder. */
                            event.currentTarget.style.display = "none";
                            if (event.currentTarget.nextElementSibling) {
                              event.currentTarget.nextElementSibling.style.display = "flex";
                            }
                          }}
                        />
                      ) : null}
                      <Package
                        size={34}
                        className="text-slate-300"
                        style={product.imageUrl ? { display: "none" } : undefined}
                      />
                    </div>

                    <div className="font-semibold text-sm mt-2 line-clamp-2 leading-snug">
                      {product.name}
                    </div>

                    <div className="font-bold text-lg mt-1">
                      £
                      {Number(
                        product.price || 0
                      ).toFixed(2)}
                    </div>
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {children}
      </section>
      {scannerOpen && (
        <CodeScannerModal
          onClose={() => setScannerOpen(false)}
          onDetected={(code) => onSearchChange(code)}
        />
      )}
    </>
  );
}

export default ProductGrid;
