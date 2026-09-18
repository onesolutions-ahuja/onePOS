// Lightweight inventory helpers built on the existing product table and
// inventory_movement architecture. This is not a second stock system.
export function classifyLowStock(product) {
  const stock = Number(product.stock_quantity ?? 0);
  if (!product.track_stock) {
    return { isLow: false, level: 0, reason: "track_stock OFF" };
  }
  const level = Number(product.low_stock_level ?? 0);
  if (level <= 0) {
    return { isLow: false, level, reason: "no threshold" };
  }
  return {
    isLow: stock <= level,
    level,
    stock,
    reason: stock <= 0 ? "out of stock" : "at or below threshold",
  };
}

export function lowStockRow(product) {
  const status = classifyLowStock(product);
  return {
    id: product.id,
    name: product.name || product.product_name || "Unnamed Product",
    sku: product.sku || product.code || "",
    barcode: product.barcode || product.ean || "",
    stock: status.stock,
    lowStockLevel: status.level,
    isLow: status.isLow,
    reason: status.reason,
    category: product.category || product.category_name || "All",
    trackStock: product.track_stock !== false && product.trackStock !== false,
  };
}
