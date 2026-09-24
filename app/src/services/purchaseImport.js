/*
 * --------------------------------------------------------------------------
 * Purchase Import Parser & Validation (T9F)
 * --------------------------------------------------------------------------
 * Standalone, dependency-free: validates/normalises bulk purchase rows.
 * No API/database calls, no product-ID invention.
 * Accepts row objects OR a header-first matrix (first row = headers).
 * Reported row numbers are 1-based CSV lines (header = line 1).
 * Blank rows are skipped silently.
 */

const HEADER_ALIASES = {
  ean: ['ean', 'barcode', 'bar code', 'ean code', 'ean/code', 'gtin'],
  sku: ['sku', 'sku code'],
  productName: ['product', 'product name', 'productname', 'item', 'item name', 'description'],
  quantity: ['qty', 'quantity'],
  unitCost: ['cost', 'unit cost', 'unitcost', 'unit price', 'price'],
  supplier: ['supplier', 'supplier name', 'vendor'],
  referenceNumber: ['reference', 'invoice number', 'invoice', 'invoice no', 'reference number', 'ref', 'po number', 'order number'],
  purchaseDate: ['date', 'purchase date', 'purchasedate', 'invoice date'],
};

function normaliseHeader(header) {
  return String(header ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normaliseText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function mapRowKeys(rawRow) {
  const mapped = {};
  for (const [rawKey, rawValue] of Object.entries(rawRow)) {
    const header = normaliseHeader(rawKey);
    if (!header) continue;
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(header) && !(canonical in mapped)) {
        mapped[canonical] = rawValue;
        break;
      }
    }
  }
  return mapped;
}

function toRowsOfObjects(input) {
  if (input.length === 0) return [];
  if (Array.isArray(input[0])) {
    const headers = input[0];
    const lines = input.slice(1);
    return lines.map((line) => {
      const row = {};
      const cells = Array.isArray(line) ? line : [];
      for (let i = 0; i < headers.length; i += 1) row[String(headers[i] ?? '')] = cells[i] ?? null;
      return row;
    });
  }
  return input.slice();
}

function parseNumber(value) {
  if (value === null || value === undefined) return { present: false, value: NaN };
  if (typeof value === 'string' && value.trim() === '') return { present: false, value: NaN };
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  return { present: true, value: num };
}

function isBlankValue(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * Validate and normalise bulk purchase import rows.
 * @returns {{ validRows: Array, errors: Array<{row: number|null, errors: string[]}>, purchases: Array }}
 */
export function parsePurchaseImport(input) {
  if (!Array.isArray(input)) {
    return {
      validRows: [],
      errors: [{ row: null, errors: ['Import data must be an array of rows.'] }],
      purchases: [],
    };
  }

  const rawRows = toRowsOfObjects(input);
  const validRows = [];
  const errors = [];

  const nonBlank = rawRows.filter(
    (row) => row && typeof row === 'object' && !Array.isArray(row)
      && Object.values(row).some((v) => !isBlankValue(v))
  );
  if (nonBlank.length === 0) return { validRows, errors, purchases: [] };

  const seen = new Set();
  for (const row of nonBlank) {
    for (const key of Object.keys(mapRowKeys(row))) seen.add(key);
  }
  const missing = [];
  if (!seen.has('quantity')) missing.push('Quantity (Qty / Quantity)');
  if (!seen.has('unitCost')) missing.push('Unit Cost (Cost / Unit Cost)');
  // Identity (EAN/SKU/Product) is validated per row so each row reports its
  // line number; only quantity/cost absence is a file-level column error.
  if (missing.length > 0) {
    return {
      validRows,
      errors: [{ row: null, errors: missing.map((c) => `Missing required column: ${c}.`) }],
      purchases: [],
    };
  }

  rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
      errors.push({ row: rowNumber, errors: ['Row must be an object of header/value pairs.'] });
      return;
    }
    if (Object.values(rawRow).every((v) => isBlankValue(v))) return;

    const mapped = mapRowKeys(rawRow);
    const rowErrors = [];
    // EAN stays a trimmed string so leading zeroes are preserved.
    const ean = normaliseText(mapped.ean);
    const sku = normaliseText(mapped.sku);
    const productName = normaliseText(mapped.productName);
    if (!ean && !sku && !productName) {
      rowErrors.push('Product identification is required (EAN, SKU or Product Name).');
    }
    const qty = parseNumber(mapped.quantity);
    if (!qty.present) rowErrors.push('Quantity is required.');
    else if (!Number.isFinite(qty.value)) rowErrors.push('Quantity must be a number.');
    else if (qty.value <= 0) rowErrors.push('Quantity must be greater than 0.');

    const cost = parseNumber(mapped.unitCost);
    if (!cost.present) rowErrors.push('Unit Cost is required.');
    else if (!Number.isFinite(cost.value)) rowErrors.push('Unit Cost must be a number.');
    else if (cost.value < 0) rowErrors.push('Unit Cost must be 0 or greater.');

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, errors: rowErrors });
      return;
    }

    validRows.push({
      referenceNumber: normaliseText(mapped.referenceNumber),
      purchaseDate: normaliseText(mapped.purchaseDate),
      supplier: normaliseText(mapped.supplier),
      items: [{ ean, sku, productName, quantity: qty.value, unitCost: cost.value }],
    });
  });

  const groups = new Map();
  for (const row of validRows) {
    const key = `${row.referenceNumber ?? ''}\u0000${row.supplier ?? ''}\u0000${row.purchaseDate ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, {
        referenceNumber: row.referenceNumber,
        purchaseDate: row.purchaseDate,
        supplier: row.supplier,
        items: [],
      });
    }
    groups.get(key).items.push(...row.items);
  }

  return { validRows, errors, purchases: [...groups.values()] };
}

export default { parsePurchaseImport };
