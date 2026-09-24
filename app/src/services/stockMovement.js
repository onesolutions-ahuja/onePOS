/*
 * Stock Movement Calculation & Reporting Foundation (T9I). Part 1 of 2.
 * Pure service: opening + movements -> balances. No API/database calls.
 * PURCHASE/RETURN increase, SALE decreases, ADJUSTMENT signed, OPENING info.
 */

const SUPPORTED_TYPES = ['OPENING', 'PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT'];

export function round3(value) {
  const r = Math.round((value + Number.EPSILON) * 1000) / 1000;
  return r === 0 ? 0 : r;
}

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function toFiniteNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value.trim());
  return NaN;
}

export function normaliseType(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  return SUPPORTED_TYPES.includes(t) ? t : null;
}

export function parseMovementDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getMovementTotalsForDateRange(movements, fromOrOptions, to) {
  let from = null;
  let end = null;
  if (fromOrOptions && typeof fromOrOptions === 'object' && !(fromOrOptions instanceof Date) && !Array.isArray(fromOrOptions)) {
    from = fromOrOptions.from ?? fromOrOptions.fromDate ?? fromOrOptions.start ?? fromOrOptions.startDate ?? null;
    end = fromOrOptions.to ?? fromOrOptions.toDate ?? fromOrOptions.end ?? fromOrOptions.endDate ?? null;
  } else {
    from = fromOrOptions ?? null;
    end = to ?? null;
  }
  const fromDate = parseMovementDate(from);
  const toDate = parseMovementDate(end);
  const totals = { purchases: 0, sales: 0, returns: 0, adjustments: 0, netChange: 0, count: 0, errors: [] };
  if (!Array.isArray(movements)) {
    totals.errors.push({ index: null, message: 'movements must be an array.' });
    return totals;
  }
  movements.forEach((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const type = normaliseType(raw.type ?? raw.movementType);
    const q = toFiniteNumber(raw.quantity);
    if (!type || !isFiniteNumber(q) || (type !== 'ADJUSTMENT' && q < 0)) return;
    const at = parseMovementDate(raw.createdAt ?? raw.created_at);
    if (!at) return;
    if (fromDate && at < fromDate) return;
    if (toDate && at > toDate) return;
    const quantity = round3(q);
    totals.count += 1;
    if (type === 'PURCHASE') totals.purchases = round3(totals.purchases + quantity);
    else if (type === 'SALE') totals.sales = round3(totals.sales + quantity);
    else if (type === 'RETURN') totals.returns = round3(totals.returns + quantity);
    else if (type === 'ADJUSTMENT') totals.adjustments = round3(totals.adjustments + quantity);
  });
  totals.netChange = round3(totals.purchases + totals.returns - totals.sales + totals.adjustments);
  return totals;
}

export const calculateMovementTotalsForDateRange = getMovementTotalsForDateRange;

export default { calculateStockMovement, getMovementTotalsForDateRange, calculateMovementTotalsForDateRange };

/**
 * Derive balances from an opening quantity plus movement records.
 * @param {{openingQuantity?: number|string, movements?: Array}|null|undefined} input
 */
export function calculateStockMovement(input) {
  const empty = (errors) => ({
    opening: 0, purchases: 0, sales: 0, returns: 0,
    adjustments: 0, closing: 0, movements: [], errors,
  });
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return empty([{ index: null, message: 'Input must be an object.' }]);
  }
  const errors = [];
  let opening = 0;
  const rawOpening = input.openingQuantity;
  if (rawOpening === undefined || rawOpening === null || rawOpening === '') opening = 0;
  else {
    const v = toFiniteNumber(rawOpening);
    if (!isFiniteNumber(v)) {
      errors.push({ index: null, message: 'openingQuantity must be a number.' });
    } else opening = round3(v);
  }
  const rawList = input.movements === undefined || input.movements === null ? [] : input.movements;
  if (!Array.isArray(rawList)) {
    return {
      opening, purchases: 0, sales: 0, returns: 0, adjustments: 0,
      closing: opening, movements: [],
      errors: [...errors, { index: null, message: 'movements must be an array.' }],
    };
  }
  let purchases = 0;
  let sales = 0;
  let returns = 0;
  let adjustments = 0;
  let balance = opening;
  const movements = [];
  rawList.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push({ index, message: 'Movement must be an object.' });
      movements.push({ index, type: null, quantity: null, createdAt: null, effect: 0, balance, valid: false });
      return;
    }
    const type = normaliseType(raw.type ?? raw.movementType);
    const rawCreatedAt = raw.createdAt ?? raw.created_at ?? null;
    const bad = (message) => {
      errors.push({ index, message });
      movements.push({ index, type: type ?? raw.type ?? raw.movementType ?? null, quantity: raw.quantity ?? null, createdAt: rawCreatedAt, effect: 0, balance, valid: false });
    };
    if (!type) { bad('Unknown or missing movement type.'); return; }
    const q = toFiniteNumber(raw.quantity);
    if (!isFiniteNumber(q)) { bad('quantity must be a number.'); return; }
    if (type !== 'ADJUSTMENT' && q < 0) { bad(`${type} quantity must be 0 or greater.`); return; }
    const quantity = round3(q);
    let effect = 0;
    if (type === 'PURCHASE') { effect = quantity; purchases = round3(purchases + quantity); }
    else if (type === 'RETURN') { effect = quantity; returns = round3(returns + quantity); }
    else if (type === 'SALE') { effect = round3(-quantity); sales = round3(sales + quantity); }
    else if (type === 'ADJUSTMENT') { effect = quantity; adjustments = round3(adjustments + quantity); }
    balance = round3(balance + effect);
    movements.push({ index, type, quantity, createdAt: rawCreatedAt, effect, balance, valid: true });
  });
  return {
    opening, purchases, sales, returns, adjustments,
    closing: round3(opening + purchases + returns - sales + adjustments),
    movements, errors,
  };
}
