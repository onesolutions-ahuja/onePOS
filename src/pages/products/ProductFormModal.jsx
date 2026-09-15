import { useState } from "react";
import { X } from "lucide-react";

export default function ProductFormModal({ product, categories, saving, error, onClose, onSave }) {
  const [form, setForm] = useState({
    name: product?.name || "",
    sku: product?.sku || "",
    barcode: product?.barcode || "",
    categoryId: product?.categoryId || "",
    price: product?.price ?? 0,
    costPrice: product?.cost ?? 0,
    lowStockLevel: product?.lowStockLevel ?? 0,
    vatRate: product?.vatRate ?? 20,
    trackStock: product?.trackStock ?? true,
  });

  const updateField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = (event) => {
    event.preventDefault();
    onSave({ ...form, name: form.name.trim(), sku: form.sku.trim() || null, barcode: form.barcode.trim() || null, categoryId: form.categoryId || null, price: Number(form.price) || 0, costPrice: Number(form.costPrice) || 0, lowStockLevel: Number(form.lowStockLevel) || 0, vatRate: Number(form.vatRate) || 0 });
  };

  const fields = [
    ["name", "Name", "text", true],
    ["sku", "SKU", "text", false],
    ["barcode", "Barcode", "text", false],
    ["price", "Selling price", "number", true],
    ["costPrice", "Cost price", "number", false],
    ["lowStockLevel", "Low stock level", "number", false],
    ["vatRate", "VAT rate %", "number", false],
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[620px] max-w-full shadow-2xl">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div><h2 className="font-bold text-xl">{product ? "Edit Product" : "Add Product"}</h2><p className="text-sm text-slate-500 mt-1">Product details are saved to the onePOS database.</p></div>
          <button onClick={onClose} disabled={saving} className="p-2 hover:bg-slate-100 rounded" title="Close"><X size={20} /></button>
        </div>
        <form onSubmit={submit} className="p-5">
          {error && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            {fields.map(([field, label, type, required]) => (
              <label key={field} className="text-sm text-slate-600">
                <span className="block mb-1 font-medium">{label}</span>
                <input required={required} type={type} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.01" : undefined} value={form[field]} onChange={(event) => updateField(field, event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
            ))}
            <label className="text-sm text-slate-600">
              <span className="block mb-1 font-medium">Category</span>
              <select value={form.categoryId} onChange={(event) => updateField("categoryId", event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                <option value="">Uncategorised</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 pt-6">
              <input type="checkbox" checked={form.trackStock} onChange={(event) => updateField("trackStock", event.target.checked)} className="w-4 h-4 accent-blue-600" />
              Track stock for this product
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-200">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 px-4 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving || !form.name.trim()} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">{saving ? "Saving..." : product ? "Save changes" : "Create product"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
