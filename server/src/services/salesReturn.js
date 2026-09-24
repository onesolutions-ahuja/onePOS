/*
 * Sales Return Validation & Calculation Service (T9H).
 * Standalone, backend-independent: validates a return request against the
 * originally sold items and calculates refund totals. No API/database calls.
 */

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toFiniteNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value.trim());
  return NaN;
}

function getOriginalId(item) {
  if (!item || typeof item !== 'object') return null;
  const v = item.saleItemId ?? item.sale_item_id ?? item.id ?? null;
  return v === null || v === undefined ? null : String(v);
}

function getOriginalSoldQty(item) {
  const v = toFiniteNumber(item.quantity ?? item.qty ?? item.soldQuantity);
  return isFiniteNumber(v) ? v : NaN;
}

function getAlreadyReturned(item) {
  const raw = item.returnedQuantity ?? item.alreadyReturned
    ?? item.returned_quantity ?? item.refundedQuantity ?? 0;
  if (raw === null || raw === undefined || raw === '') return 0;
  const v = toFiniteNumber(raw);
  return isFiniteNumber(v) && v > 0 ? v : 0;
}

/**
 * Validate and calculate a sales return.
 * @param {{saleId?: string, items?: Array}} returnRequest
 * @param {Array} saleItems - originally sold lines with ids + quantities.
 */
export function validateSalesReturn(returnRequest, saleItems) {
  const errors = [];
  const fail = (saleItemId, message) => errors.push({ saleItemId, message });

  if (!returnRequest || typeof returnRequest !== 'object' || Array.isArray(returnRequest)) {
    return { valid: false, errors: [{ saleItemId: null, message: 'Return request must be an object.' }], items: [], subtotal: 0, tax: 0, discount: 0, total: 0 };
  }
  if (returnRequest.saleId === null || returnRequest.saleId === undefined || String(returnRequest.saleId).trim() === '') {
    fail(null, 'saleId is required.');
  }
  const reqItems = returnRequest.items;
  if (!Array.isArray(reqItems) || reqItems.length === 0) {
    fail(null, 'Return must include at least one item.');
    return { valid: false, errors, items: [], subtotal: 0, tax: 0, discount: 0, total: 0 };
  }
  const originals = Array.isArray(saleItems) ? saleItems : [];
  const byId = new Map();
  for (const o of originals) {
    const id = getOriginalId(o);
    if (id !== null && !byId.has(id)) byId.set(id, o);
  }

  const seen = new Set();
  const lines = [];
  let subtotal = 0;
  let taxTotal = 0;
  let discountTotal = 0;

  for (const raw of reqItems) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      fail(null, 'Each return item must be an object.');
      continue;
    }
    const saleItemId = raw.saleItemId ?? raw.sale_item_id ?? raw.id ?? null;
    const key = saleItemId === null || saleItemId === undefined ? null : String(saleItemId);
    if (key === null || key === '') {
      fail(null, 'Each return item requires saleItemId.');
      continue;
    }
    if (seen.has(key)) {
      fail(key, 'Duplicate saleItemId in return request.');
      continue;
    }
    seen.add(key);
    const original = byId.get(key);
    if (!original) {
      fail(key, 'Unknown saleItemId for this sale.');
      continue;
    }
    if (raw.productId !== undefined && raw.productId !== null && String(raw.productId).trim() !== '') {
      const origPid = original.productId ?? original.product_id ?? null;
      if (origPid !== null && origPid !== undefined && String(origPid) !== String(raw.productId)) {
        fail(key, 'productId does not match the original sale item.');
        continue;
      }
    }
    const qty = toFiniteNumber(raw.quantity);
    if (!isFiniteNumber(qty)) {
      fail(key, 'quantity must be a number.');
      continue;
    }
    if (qty <= 0) {
      fail(key, 'quantity must be greater than 0.');
      continue;
    }
    const soldQty = getOriginalSoldQty(original);
    if (!isFiniteNumber(soldQty) || soldQty <= 0) {
      fail(key, 'Original sale quantity is invalid.');
      continue;
    }
    const remaining = round2(soldQty - getAlreadyReturned(original));
    if (remaining <= 0) {
      fail(key, 'Item has already been fully returned.');
      continue;
    }
    if (round2(qty) - remaining > 1e-9) {
      fail(key, `quantity ${qty} exceeds remaining returnable quantity ${remaining}.`);
      continue;
    }
    const priceRaw = raw.unitPrice ?? raw.unit_price ?? original.unitPrice ?? original.unit_price;
    const up = toFiniteNumber(priceRaw);
    if (!isFiniteNumber(up) || up < 0) {
      fail(key, 'unitPrice must be 0 or greater.');
      continue;
    }
    const taxV = toFiniteNumber(raw.tax ?? 0);
    const discV = toFiniteNumber(raw.discount ?? 0);
    if (!isFiniteNumber(taxV) || taxV < 0) {
      fail(key, 'tax must be 0 or greater.');
      continue;
    }
    if (!isFiniteNumber(discV) || discV < 0) {
      fail(key, 'discount must be 0 or greater.');
      continue;
    }
    const lineSubtotal = round2(qty * up);
    const lineTax = round2(taxV);
    const lineDiscount = round2(discV);
    if (lineDiscount - (lineSubtotal + lineTax) > 1e-9) {
      fail(key, 'discount cannot exceed line subtotal plus tax.');
      continue;
    }
    const lineTotal = round2(lineSubtotal + lineTax - lineDiscount);
    subtotal = round2(subtotal + lineSubtotal);
    taxTotal = round2(taxTotal + lineTax);
    discountTotal = round2(discountTotal + lineDiscount);
    const pid = original.productId ?? original.product_id ?? null;
    lines.push({
      saleItemId: key,
      productId: raw.productId !== undefined && raw.productId !== null
        ? String(raw.productId) : (pid === null ? null : String(pid)),
      quantity: qty,
      unitPrice: round2(up),
      tax: lineTax,
      discount: lineDiscount,
      lineSubtotal,
      lineTotal,
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors, items: [], subtotal: 0, tax: 0, discount: 0, total: 0 };
  }
  return { valid: true, errors: [], items: lines, subtotal, tax: taxTotal, discount: discountTotal, total: round2(subtotal + taxTotal - discountTotal) };
}

export default { validateSalesReturn };
