/*
 * T10Q - Supplier Integration Foundation (provider-neutral feed adapter).
 *
 * Pure service: no API/database calls, no auto-creation, no stock movement.
 * A "supplier feed" is any generic list of supplier product/order rows (a
 * future supplier API response, CSV import, webhook payload...). It is
 * normalised into one canonical shape so future supplier integrations can
 * plug in without a duplicate product or purchasing system.
 */
import { validGtin } from "./globalProductMasterImport.js";

export const SUPPLIER_FEED_FIELDS = [
  "supplierCode", "ean", "name", "brand", "category",
  "supplierPrice", "vatRate", "vatApplicable", "availableQty",
  "supplierRef", "updatedAt",
];

export const SUPPLIER_FEED_LIMIT = 500;

function text(value) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out ? out : null;
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function normKey(value) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim().toLowerCase();
  return out ? out : null;
}

/* Zero-padded identity so 13-digit and 14-digit GTIN spellings match. */
export function gtinIdentity(ean) {
  return String(ean).padStart(14, "0");
}

function parseVatApplicable(raw, index, vatRate) {
  if (raw === null || raw === undefined || raw === "") {
    return { value: vatRate !== null ? true : null, error: null };
  }
  if (typeof raw === "boolean") return { value: raw, error: null };
  if (typeof raw === "number") return { value: raw !== 0, error: null };
  if (typeof raw === "string") {
    const lowered = raw.trim().toLowerCase();
    if (["false", "0", "no", "n", "off"].includes(lowered)) return { value: false, error: null };
    if (["true", "1", "yes", "y", "on"].includes(lowered)) return { value: true, error: null };
  }
  return { value: null, error: `Row ${index}: vatApplicable must be a boolean.` };
}
/**
 * Normalise one raw supplier row. Accepts camelCase plus the snake_case
 * aliases suppliers commonly send. Returns { row } or { error } - never
 * throws for bad data and never invents missing values.
 */
export function normaliseSupplierRow(raw, index = 0) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: `Row ${index}: row must be an object.` };
  }
  const get = (...keys) => {
    for (const key of keys) {
      const v = raw[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return null;
  };
  const supplierCode = text(get("supplierCode", "supplier_code", "code", "sku"));
  const rawEan = text(get("ean", "barcode", "gtin", "ean13"));
  const name = text(get("name", "product_name", "productName", "title"));
  const brand = text(get("brand", "manufacturer"));
  const category = text(get("category", "category_name", "categoryName"));
  const supplierPrice = num(get("supplierPrice", "supplier_price", "unit_price", "unitPrice", "price", "cost"));
  const vatRate = num(get("vatRate", "vat_rate", "vat", "tax_rate", "taxRate"));
  const availableQty = num(get("availableQty", "available_qty", "quantity", "qty", "stock"));
  const supplierRef = text(get("supplierRef", "supplier_ref", "reference", "referenceNumber"));
  const updatedAtRaw = get("updatedAt", "updated_at", "last_updated", "lastUpdated");
  if (!name) return { error: `Row ${index}: product name is required.` };
  if (name.length > 255) return { error: `Row ${index}: product name exceeds 255 characters.` };
  if (brand && brand.length > 200) return { error: `Row ${index}: brand exceeds 200 characters.` };
  if (category && category.length > 200) return { error: `Row ${index}: category exceeds 200 characters.` };
  let ean = null;
  if (rawEan) {
    const digits = rawEan.replace(/[\s-]/g, "");
    if (!validGtin(digits)) return { error: `Row ${index}: invalid EAN/barcode.` };
    ean = digits;
  }
  if (supplierPrice !== null && supplierPrice < 0) {
    return { error: `Row ${index}: supplier price must be 0 or greater.` };
  }
  if (vatRate !== null && (vatRate < 0 || vatRate > 100)) {
    return { error: `Row ${index}: VAT rate must be between 0 and 100.` };
  }
  if (availableQty !== null && availableQty < 0) {
    return { error: `Row ${index}: available quantity must be 0 or greater.` };
  }
  const vat = parseVatApplicable(get("vatApplicable", "vat_applicable"), index, vatRate);
  if (vat.error) return { error: vat.error };
  let updatedAt = null;
  if (updatedAtRaw !== null) {
    const date = updatedAtRaw instanceof Date ? updatedAtRaw : new Date(updatedAtRaw);
    if (Number.isNaN(date.getTime())) {
      return { error: `Row ${index}: last updated timestamp is not a valid date.` };
    }
    updatedAt = date.toISOString();
  }
  return {
    row: {
      supplierCode, ean, name, brand, category, supplierPrice,
      vatRate, vatApplicable: vat.value, availableQty, supplierRef, updatedAt,
    },
  };
}

/** Normalise a whole feed. Duplicate EANs are reported (first wins). */
export function normaliseSupplierFeed(input) {
  const list = Array.isArray(input) ? input : [];
  if (list.length > SUPPLIER_FEED_LIMIT) {
    return { rows: [], errors: [`Feed exceeds the ${SUPPLIER_FEED_LIMIT}-row preview limit.`] };
  }
  const rows = [];
  const errors = [];
  const seenEan = new Set();
  list.forEach((raw, i) => {
    const index = raw && Number.isFinite(raw.row) ? raw.row : i + 1;
    const { row, error } = normaliseSupplierRow(raw, index);
    if (error) {
      errors.push({ row: index, errors: [error] });
      return;
    }
    if (row.ean) {
      const identity = gtinIdentity(row.ean);
      if (seenEan.has(identity)) {
        errors.push({ row: index, errors: ["Duplicate EAN in feed - first occurrence kept."] });
        return;
      }
      seenEan.add(identity);
    }
    rows.push({ ...row, row: index });
  });
  return { rows, errors };
}

