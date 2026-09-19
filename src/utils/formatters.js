export function normaliseProduct(product) {
  return {
    id: product.id,
    categoryId: product.category_id || product.categoryId || "",
    name: product.name || product.product_name || "Unnamed Product",
    sku: product.sku || product.code || "",
    barcode: product.barcode || product.ean || "",
    price: Number(product.price ?? product.selling_price ?? product.unit_price ?? 0),
    cost: Number(product.cost ?? product.cost_price ?? 0),
    vatRate: Number(product.vat_rate ?? product.vatRate ?? 20),
    vatApplicable: product.vat_applicable !== undefined ? product.vat_applicable !== false : product.vatApplicable !== false,
    ageRestricted: product.age_restricted === true || product.ageRestricted === true,
    lowStockLevel: Number(product.low_stock_level ?? product.lowStockLevel ?? 0),
    trackStock: product.track_stock !== false && product.trackStock !== false,
    availableOnUber: product.available_on_uber === true || product.availableOnUber === true,
    availableOnDeliveroo: product.available_on_deliveroo === true || product.availableOnDeliveroo === true,
    uberItemId: product.uber_item_id || product.uberItemId || "",
    deliverooItemId: product.deliveroo_item_id || product.deliverooItemId || "",
    imageUrl: product.image_url || product.imageUrl || "",
    category: product.category || product.category_name || "All",
    stock: Number(product.stock_quantity ?? product.stock ?? product.quantity ?? 0),
    active: product.active !== false && product.is_active !== false,
  };
}

export function getStockStatus(product) {
  if (product.stock <= 0) {
    return { label: "Out of Stock", className: "bg-red-50 text-red-700" };
  }
  const lowStockLevel = product.lowStockLevel > 0 ? product.lowStockLevel : 5;
  if (product.stock <= lowStockLevel) {
    return { label: "Low Stock", className: "bg-orange-50 text-orange-700" };
  }
  return { label: "In Stock", className: "bg-emerald-50 text-emerald-700" };
}

export function fmt(v) {
  return `£${Number(v || 0).toFixed(2)}`;
}
