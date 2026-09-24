/*
 * Purchase Import Preview Model (T9G).
 * Frontend-independent summary built on top of parsePurchaseImport().
 * No API calls, no mutations of the parser result.
 */

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function cloneItem(item) {
  const source = item && typeof item === 'object' ? item : {};
  return {
    ean: source.ean ?? null,
    sku: source.sku ?? null,
    productName: source.productName ?? null,
    quantity: source.quantity ?? null,
    unitCost: source.unitCost ?? null,
  };
}

function cloneRow(row) {
  const source = row && typeof row === 'object' ? row : {};
  const items = Array.isArray(source.items) ? source.items.map(cloneItem) : [];
  return {
    referenceNumber: source.referenceNumber ?? null,
    purchaseDate: source.purchaseDate ?? null,
    supplier: source.supplier ?? null,
    items,
  };
}

function clonePurchase(purchase) {
  return cloneRow(purchase);
}

/**
 * Build a preview summary from a parsePurchaseImport() result.
 * Invalid rows never contribute to totals. EANs are copied as-is.
 *
 * @param {{ validRows?: Array, errors?: Array, purchases?: Array }|null|undefined} result
 */
export function buildPurchaseImportPreview(result) {
  const source = result && typeof result === 'object' ? result : {};
  const validRows = Array.isArray(source.validRows) ? source.validRows : [];
  const errors = Array.isArray(source.errors) ? source.errors : [];
  const purchases = Array.isArray(source.purchases) ? source.purchases : [];

  const rowErrors = errors.filter(
    (e) => e && typeof e === 'object' && e.row !== null && e.row !== undefined
  );
  const fileErrors = errors
    .filter((e) => !e || typeof e !== 'object' || e.row === null || e.row === undefined)
    .flatMap((e) => {
      if (!e || typeof e !== 'object') return [];
      return Array.isArray(e.errors) ? e.errors.map(String) : [];
    });

  const errorsByRow = {};
  for (const entry of rowErrors) {
    const key = String(entry.row);
    const messages = Array.isArray(entry.errors) ? entry.errors.map(String) : [];
    if (!errorsByRow[key]) errorsByRow[key] = [];
    errorsByRow[key].push(...messages);
  }

  // Totals derive ONLY from valid rows.
  let totalItemLines = 0;
  let totalQuantity = 0;
  let totalValue = 0;
  for (const row of validRows) {
    if (!row || typeof row !== 'object' || !Array.isArray(row.items)) continue;
    for (const item of row.items) {
      if (!item || typeof item !== 'object') continue;
      totalItemLines += 1;
      if (isFiniteNumber(item.quantity)) totalQuantity += item.quantity;
      if (isFiniteNumber(item.quantity) && isFiniteNumber(item.unitCost)) {
        totalValue += item.quantity * item.unitCost;
      }
    }
  }

  // Round money-style totals to 2dp to avoid float artefacts (0.1*3 etc.).
  totalQuantity = Math.round((totalQuantity + Number.EPSILON) * 1000) / 1000;
  totalValue = Math.round((totalValue + Number.EPSILON) * 100) / 100;

  return {
    totalInputRows: validRows.length + rowErrors.length,
    validRows: validRows.length,
    invalidRows: rowErrors.length,
    totalPurchases: purchases.length,
    totalItemLines,
    totalQuantity,
    totalValue,
    errorsByRow,
    fileErrors,
    rows: validRows.map(cloneRow),
    purchases: purchases.map(clonePurchase),
  };
}

export default { buildPurchaseImportPreview };
