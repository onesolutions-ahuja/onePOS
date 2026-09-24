import StandardObjectFormModal from "../../components/platform/StandardObjectFormModal.jsx";

/**
 * Product create/edit is a Platform Object form.  Keep this tiny adapter only
 * for the operational Products page's legacy camelCase API contract; fields,
 * layout, validation and presentation all come from Platform metadata.
 */
export default function ProductFormModal({ product, categories = [], preset = null, onClose, onSaved }) {
  const record = {
    ...product,
    name: product?.name || preset?.name || "",
    barcode: product?.barcode || preset?.ean || preset?.barcode || "",
    category_id: product?.categoryId || product?.category_id || "",
    cost_price: product?.costPrice ?? product?.cost_price ?? product?.cost ?? 0,
    low_stock_level: product?.lowStockLevel ?? product?.low_stock_level ?? 0,
    vat_rate: product?.vatRate ?? product?.vat_rate ?? 0,
    vat_applicable: product?.vatApplicable ?? product?.vat_applicable ?? true,
    track_stock: product?.trackStock ?? product?.track_stock ?? true,
    age_restricted: product?.ageRestricted ?? product?.age_restricted ?? false,
    image_url: product?.imageUrl ?? product?.image_url ?? "",
    available_on_uber: product?.availableOnUber ?? product?.available_on_uber ?? false,
    available_on_deliveroo: product?.availableOnDeliveroo ?? product?.available_on_deliveroo ?? false,
  };

  return (
    <StandardObjectFormModal
      objectKey="product"
      record={record}
      mode={product?.id ? "edit" : "create"}
      title={product?.id ? "Edit Product" : "New Product"}
      fieldOptions={{
        category_id: categories.map((category) => ({ value: category.id, label: category.name })),
      }}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
