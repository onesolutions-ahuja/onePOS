// T10H — automatic replenishment suggestions (planning layer only).
//
// Pure helpers shared by the replenishment API route and its regression
// tests. Everything derives from the EXISTING low-stock condition
// (stock_quantity + low_stock_level + track_stock); no second stock
// system, no forecasting, no writes of any kind.
//
// Suggested reorder = target - current stock
//   target = 2 x low-stock threshold ("par level")
// A product only appears on the replenishment list when:
//   - track_stock is ON, AND
//   - low_stock_level > 0 (reorder configuration present — otherwise the
//     row reports "No reorder quantity configured"), AND
//   - current stock <= threshold (the existing low-stock condition).
export function classifyReplenishment(product) {
  const stock = Number(product.stock_quantity ?? product.stock ?? 0);
  const threshold = Number(product.low_stock_level ?? product.lowStockLevel ?? 0);
  const tracked = (product.track_stock ?? product.trackStock) !== false;

  if (!tracked) {
    return { eligible: false, isLow: false, stock, threshold, reason: "track_stock OFF" };
  }
  if (!(threshold > 0)) {
    return {
      eligible: false,
      isLow: false,
      stock,
      threshold,
      suggested: null,
      target: null,
      reason: "No reorder quantity configured",
    };
  }
  const isLow = stock <= threshold;
  if (!isLow) {
    return { eligible: false, isLow: false, stock, threshold, reason: "above threshold" };
  }
  const target = threshold * 2;
  const suggested = Math.max(0, target - stock);
  return {
    eligible: true,
    isLow: true,
    stock,
    threshold,
    target,
    suggested,
    reason: stock <= 0 ? "out of stock" : "at or below threshold",
  };
}

export function replenishmentRow(product) {
  const result = classifyReplenishment(product);
  return {
    id: product.id,
    name: product.name || product.product_name || "Unnamed Product",
    sku: product.sku || product.code || "",
    barcode: product.barcode || product.ean || "",
    stock: result.stock,
    lowStockLevel: result.threshold,
    targetStockLevel: result.target ?? null,
    suggestedReorder: result.suggested ?? null,
    hasSuggestion: result.suggested != null,
    status: !result.isLow ? "OK" : result.stock <= 0 ? "Out of stock" : "Low stock",
    reason: result.reason,
    category: product.category || product.category_name || "All",
    categoryId: product.category_id || product.categoryId || null,
    trackStock: (product.track_stock ?? product.trackStock) !== false,
  };
}
