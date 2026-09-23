import { useMemo, useRef, useState } from "react";
import { ImagePlus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import PlatformExtensionFields from "../../components/platform/PlatformExtensionFields.jsx";

/*
 * Shared Product Master creation / edit form.
 *
 * Three entry modes:
 *   1. product = { ... }      → Edit an existing product.
 *   2. product = null + preset = null → Blank create form (original behaviour).
 *   3. product = null + preset = { name, ean, category, brand, imageUrl, ... }
 *      → Create form with reference fields pre-populated from the GLOBAL
 *        PRODUCT DATABASE.  Pricing, stock, VAT and store-specific settings
 *        always stay at their normal user-entered / default values — they
 *        are NEVER copied from the global catalogue.
 *
 * Duplicate / EAN validation is the responsibility of the existing
 * POST /api/products handler, which returns 409 "A product with this
 * barcode already exists" for within-company duplicates.
 *
 * Layout: wide (1170px) two-column body — image picker + EAN lookup live in
 * a left rail, all fields in one right-hand column — so the entire form fits
 * a 15" till screen without scrolling.
 */
export default function ProductFormModal({ product, categories, preset = null, saving, error, onClose, onSave }) {
  const [platform, setPlatform] = useState(null);
  const [platformReady, setPlatformReady] = useState(false);
  const presetCategoryId = useMemo(() => {
    if (!preset || !preset.category) return "";
    const candidates = [preset.category, preset.subcategory].filter(Boolean).map((s) => String(s).toLowerCase());
    const match = categories.find((category) => {
      const name = String(category.name).toLowerCase();
      return candidates.includes(name) || candidates.some((c) => name.includes(c));
    });
    return match ? match.id : "";
  }, [preset, categories]);

  const [form, setForm] = useState(() => ({
    name: product?.name || preset?.name || "",
    sku: product?.sku || "",
    barcode: product?.barcode || preset?.ean || preset?.barcode || "",
    categoryId: product?.categoryId || presetCategoryId || "",
    price: product?.price ?? 0,
    costPrice: product?.cost ?? 0,
    lowStockLevel: product?.lowStockLevel ?? 0,
    vatRate: product?.vatRate ?? 20,
    vatApplicable:
      product === null || product === undefined
        ? preset?.vatApplicable !== undefined
          ? preset.vatApplicable !== false
          : true
        : product.vatApplicable !== false,
    openingStock: 0,
    openingBatchNumber: "",
    openingManufacturingDate: "",
    openingExpiryDate: "",
    trackStock: product?.trackStock ?? true,
    batchTracking: product?.batchTracking ?? product?.batch_tracking ?? false,
    ageRestricted: product?.ageRestricted === true,
    imageUrl: product?.imageUrl || preset?.imageUrl || "",
    availableOnUber: product?.availableOnUber ?? false,
    availableOnDeliveroo: product?.availableOnDeliveroo ?? false,
    uberItemId: product?.uberItemId || "",
    deliverooItemId: product?.deliverooItemId || "",
  }));

  const imageInputRef = useRef(null);

  /*
   * Product image: chosen from a local file, downscaled to a compact data
   * URL (same approach as the Settings company logo uploader, but 400px for
   * product shots). Also accepts a pasted/typed remote URL via the small
   * "Use URL" input. Stored in products.image_url.
   */
  const handleImageFile = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const img = new Image();
    img.onload = () => {
      const maxSize = 400;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
      } else {
        if (height > maxSize) { width = Math.round((width * maxSize) / height); height = maxSize; }
      }
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      updateField("imageUrl", dataUrl);
    };
    img.src = URL.createObjectURL(file);
  };

  const updateField = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  /*
   * EAN / barcode lookup (create mode only).  Calls the EXISTING read-only
   * GET /api/ean-lookup/:ean and fills ONLY reference fields — pricing,
   * stock and supplier stay user-entered.  Scanners behave like keyboards:
   * Enter triggers the lookup.
   */
  const [eanInput, setEanInput] = useState(form.barcode);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState(
    !product && preset
      ? { type: "found", message: "Pre-filled from global product catalogue." }
      : null
  );

  const runEanLookup = async () => {
    if (lookingUp || saving) return;

    const ean = eanInput.trim();
    if (!/^([0-9]{8}|[0-9]{12,14})$/.test(ean)) {
      setLookupResult({ type: "invalid", message: "EAN must be 8, 12, 13 or 14 digits — nothing was looked up." });
      return;
    }

    setLookingUp(true);
    setLookupResult(null);
    try {
      const response = await apiRequest(`/api/ean-lookup/${ean}`);
      const ref = response?.data || null;

      const referenceNames = [ref?.category, ref?.subcategory]
        .filter(Boolean)
        .map((name) => String(name).toLowerCase());
      const categoryMatch = referenceNames.length
        ? categories.find(
            (category) =>
              referenceNames.includes(String(category.name).toLowerCase()) ||
              referenceNames.some((name) =>
                String(category.name).toLowerCase().includes(name)
              )
          )
        : null;

      setForm((current) => ({
        ...current,
        name: ref?.product_name || current.name,
        barcode: ean,
        categoryId: categoryMatch ? categoryMatch.id : current.categoryId,
      }));
      setLookupResult({
        type: "found",
        ref,
        message: "Reference details added below — enter your own pricing and stock.",
      });
    } catch (err) {
      if (err?.status === 404) {
        setForm((current) => ({ ...current, barcode: current.barcode || ean }));
        setLookupResult({
          type: "not-found",
          message: "EAN not found in the product master — continue creating the product manually.",
        });
      } else if (err?.status === 400) {
        setLookupResult({
          type: "invalid",
          message: err?.message || "EAN must be 8, 12, 13 or 14 digits.",
        });
      } else {
        setLookupResult({
          type: "error",
          message: "Lookup unavailable — you can still create the product manually.",
        });
      }
    } finally {
      setLookingUp(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (!platformReady) return;

    const payload = {
      ...form,
      platform,
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      categoryId: form.categoryId || null,
      price: Number(form.price) || 0,
      costPrice: Number(form.costPrice) || 0,
      lowStockLevel: Number(form.lowStockLevel) || 0,
      vatRate: Number(form.vatRate) || 0,
      vatApplicable: form.vatApplicable !== false,
      ageRestricted: form.ageRestricted === true,
      batchTracking: form.batchTracking === true,
      availableOnUber: Boolean(form.availableOnUber),
      availableOnDeliveroo: Boolean(form.availableOnDeliveroo),
      uberItemId: form.uberItemId.trim() || null,
      deliverooItemId: form.deliverooItemId.trim() || null,
      imageUrl: form.imageUrl || null,
    };

    if (!product) {
      payload.stockQuantity = Math.max(0, Number(form.openingStock) || 0);
      payload.openingBatchNumber = form.openingBatchNumber.trim() || null;
      payload.openingManufacturingDate = form.openingManufacturingDate || null;
      payload.openingExpiryDate = form.openingExpiryDate || null;
    }

    onSave(payload);
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
      <div className="bg-white rounded-xl w-[1170px] max-w-[95vw] shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">
              {product ? "Edit Product" : "Add Product"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Product details are saved to the onePOS database.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1.5 hover:bg-slate-100 rounded"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 pt-3">
          {/* EAN / barcode lookup (create mode only) — top strip */}
          {!product && (
            <div className="mb-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    value={eanInput}
                    onChange={(event) => setEanInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        runEanLookup();
                      }
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="EAN / barcode lookup — scan or type, then press Enter (8, 12–14 digits)"
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={runEanLookup}
                  disabled={lookingUp || saving}
                  className="onepos-btn onepos-btn-primary shrink-0"
                >
                  {lookingUp ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <Search size={14} />
                  )}
                  {lookingUp ? "Looking up…" : "Lookup"}
                </button>
              </div>
              {lookupResult && (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-2 text-xs rounded px-2.5 py-1.5 ${
                    lookupResult.type === "found"
                      ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                      : lookupResult.type === "not-found"
                        ? "bg-slate-100 border border-slate-200 text-slate-600"
                        : "bg-amber-50 border border-amber-200 text-amber-700"
                  }`}
                >
                  {lookupResult.type === "found" && (
                    <>
                      <span className="font-medium">
                        {lookupResult.ref?.product_name || form.name || "Global product"}
                      </span>
                      {[lookupResult.ref?.brand, lookupResult.ref?.category, lookupResult.ref?.subcategory, lookupResult.ref?.unit_description]
                        .filter(Boolean)
                        .join(" · ") && (
                        <span>
                          {" — "}
                          {[lookupResult.ref?.brand, lookupResult.ref?.category, lookupResult.ref?.subcategory, lookupResult.ref?.unit_description]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                      {" — "}
                      {lookupResult.message}
                    </>
                  )}
                  {lookupResult.type !== "found" && lookupResult.message}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          <div className="flex items-start gap-4">
            {/* ------------------------------------------------ left rail */}
            <div className="w-[260px] shrink-0 flex flex-col gap-3">
              {/* Product image picker (create + edit) */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col items-center gap-2">
                {form.imageUrl ? (
                  <img
                    src={form.imageUrl}
                    alt="Product"
                    className="w-24 h-24 rounded-lg object-cover border border-slate-200 bg-white"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-lg border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-300">
                    <ImagePlus size={28} />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={saving}
                    className="h-8 px-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {form.imageUrl ? "Change image" : "Add image"}
                  </button>
                  {form.imageUrl && (
                    <button
                      type="button"
                      onClick={() => updateField("imageUrl", "")}
                      disabled={saving}
                      className="h-8 px-2.5 text-red-600 hover:bg-red-50 rounded-lg text-sm flex items-center gap-1"
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  )}
                </div>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    handleImageFile(event.target.files[0]);
                    event.target.value = "";
                  }}
                />
                <p className="text-xs text-slate-400 text-center">
                  JPG/PNG — resized automatically. Shown on product lists.
                </p>
              </div>
            </div>

            {/* ----------------------------------------------- right column */}
            <div className="flex-1 min-w-0 flex flex-col gap-3">
              <div className="grid grid-cols-4 gap-x-3 gap-y-2.5">
                {fields.map(([field, label, type, required]) => (
                  <label key={field} className="text-sm text-slate-600">
                    <span className="block mb-1 font-medium">{label}</span>
                    <input
                      required={required}
                      type={type}
                      min={type === "number" ? "0" : undefined}
                      step={type === "number" ? "0.01" : undefined}
                      value={form[field]}
                      onChange={(event) => updateField(field, event.target.value)}
                      className="w-full h-9 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </label>
                ))}

                <label className="text-sm text-slate-600">
                  <span className="block mb-1 font-medium">Category</span>
                  <select
                    value={form.categoryId}
                    onChange={(event) => updateField("categoryId", event.target.value)}
                    className="w-full h-9 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    <option value="">Uncategorised</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="text-sm text-slate-600">
                  <span className="block mb-1 font-medium">Stock tracking</span>
                  <div className="flex items-center gap-2 h-9">
                    <label className="flex items-center gap-1.5 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={form.trackStock}
                        onChange={(event) => updateField("trackStock", event.target.checked)}
                        className="w-4 h-4 accent-blue-600"
                      />
                      Track stock
                    </label>
                    {!product && (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        disabled={!form.trackStock}
                        value={form.openingStock}
                        onChange={(event) => updateField("openingStock", event.target.value)}
                        placeholder="Opening stock"
                        title={
                          form.trackStock
                            ? "Starting quantity for your store — recorded as an OPENING stock movement."
                            : "Enable stock tracking to set an opening stock."
                        }
                        className="w-28 h-9 px-3 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:bg-slate-50"
                      />
                    )}
                  </div>
                  <label className="flex items-center gap-1.5 mt-2 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={form.batchTracking}
                      onChange={(event) => updateField("batchTracking", event.target.checked)}
                      disabled={!form.trackStock}
                      className="w-4 h-4 accent-blue-600 disabled:opacity-50"
                    />
                    Track batches and expiry dates
                  </label>
                  {!product && form.trackStock && form.batchTracking && (
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <input value={form.openingBatchNumber} onChange={(e) => updateField("openingBatchNumber", e.target.value)} placeholder="Opening batch" className="h-9 px-2 border rounded-lg text-xs" />
                      <input type="date" value={form.openingManufacturingDate} onChange={(e) => updateField("openingManufacturingDate", e.target.value)} className="h-9 px-2 border rounded-lg text-xs" />
                      <input type="date" value={form.openingExpiryDate} onChange={(e) => updateField("openingExpiryDate", e.target.value)} className="h-9 px-2 border rounded-lg text-xs" />
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 col-span-2">
                  <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={form.vatApplicable}
                      onChange={(event) => updateField("vatApplicable", event.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    VAT applicable
                  </label>
                  <p className="text-xs text-slate-400 text-right">
                    {form.vatApplicable
                      ? `Charged at ${form.vatRate || 0}% (rate above).`
                      : "No VAT — zero-rated/exempt."}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 col-span-2">
                  <label className="flex items-center gap-2 text-sm text-slate-600 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={form.ageRestricted}
                      onChange={(event) => updateField("ageRestricted", event.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    Age restricted (18+)
                  </label>
                  <p className="text-xs text-slate-400 text-right">
                    {form.ageRestricted
                      ? "Age check required before sale."
                      : "Sells without an age check."}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 flex-wrap bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">
                  Online platforms
                </span>
                <label className="flex items-center gap-1.5 text-sm text-slate-600 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={form.availableOnUber}
                    onChange={(event) => updateField("availableOnUber", event.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  Uber Eats
                </label>
                {form.availableOnUber && (
                  <input
                    placeholder="Uber item ID (optional)"
                    value={form.uberItemId}
                    onChange={(event) => updateField("uberItemId", event.target.value)}
                    className="w-44 h-8 px-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                )}
                <label className="flex items-center gap-1.5 text-sm text-slate-600 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={form.availableOnDeliveroo}
                    onChange={(event) => updateField("availableOnDeliveroo", event.target.checked)}
                    className="w-4 h-4 accent-blue-600"
                  />
                  Deliveroo
                </label>
                {form.availableOnDeliveroo && (
                  <input
                    placeholder="Deliveroo item ID (optional)"
                    value={form.deliverooItemId}
                    onChange={(event) => updateField("deliverooItemId", event.target.value)}
                    className="w-44 h-8 px-2.5 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                )}
              </div>
            </div>
          </div>

          <PlatformExtensionFields objectKey="product" recordId={product?.id} coreValues={form} onChange={setPlatform} onReady={setPlatformReady} />
          <div className="flex justify-end gap-2 mt-3 pt-2.5 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="h-9 px-4 border border-slate-200 rounded-lg text-sm hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !platformReady || !form.name.trim()}
              className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              {saving ? "Saving..." : product ? "Save changes" : "Create product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
