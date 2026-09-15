import { Grid3X3, Package, RefreshCw, Search } from "lucide-react";

const categories = [
  "All",
  "Food",
  "Drinks",
  "Snacks",
  "Hot Drinks",
  "Desserts",
];

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
  children,
}) {
  return (
    <>
      <aside className="w-[150px] bg-white border-r border-slate-200 p-2 shrink-0 overflow-y-auto">
        <div className="text-[10px] font-bold text-slate-400 px-2 py-2">
          CATEGORIES
        </div>

        {categories.map((item) => (
          <button
            key={item}
            onClick={() =>
              onCategoryChange(item)
            }
            className={`w-full text-left px-3 py-3 rounded-md mb-1 text-sm font-medium ${
              category === item
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {item}
          </button>
        ))}
      </aside>

      <section className="flex-1 flex flex-col min-w-0 p-3">
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

          <button className="w-12 h-12 bg-white border border-slate-200 rounded-md flex items-center justify-center">
            <Grid3X3 size={20} />
          </button>

          <button
            onClick={onRetry}
            className="px-4 h-12 bg-white border border-slate-200 rounded-md text-sm hover:bg-slate-50 flex items-center gap-2"
          >
            <RefreshCw size={16} />
            Refresh
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
          ) : filtered.length === 0 ? (
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
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {filtered.map(
                (product) => (
                  <button
                    key={product.id}
                    onClick={() =>
                      onAddProduct(product)
                    }
                    className="bg-white border border-slate-200 rounded-md p-3 text-left hover:border-blue-500 hover:shadow-sm active:scale-[0.98] transition"
                  >
                    <div className="h-20 bg-slate-100 rounded flex items-center justify-center">
                      <Package
                        size={28}
                        className="text-slate-300"
                      />
                    </div>

                    <div className="font-semibold text-sm mt-2 line-clamp-2">
                      {product.name}
                    </div>

                    <div className="text-xs text-slate-400 mt-1">
                      {product.category}
                    </div>

                    {product.sku && (
                      <div className="text-xs text-slate-400 mt-1">
                        SKU:{" "}
                        {product.sku}
                      </div>
                    )}

                    <div className="font-bold text-lg mt-2">
                      £
                      {Number(
                        product.price || 0
                      ).toFixed(2)}
                    </div>

                    <div className="text-xs text-slate-400 mt-1">
                      Stock:{" "}
                      {product.stock}
                    </div>
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {children}
      </section>
    </>
  );
}

export default ProductGrid;