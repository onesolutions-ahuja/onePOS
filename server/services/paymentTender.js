function cents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Payment amount must be a number');
  return Math.round(n * 100);
}

export function validateTenderLines({ payments = [], total = 0, allowedMethods = [], maxLines = 8 } = {}) {
  if (!Array.isArray(payments) || payments.length === 0) return null;
  if (payments.length > maxLines) throw new Error(`Too many payment lines (maximum ${maxLines})`);
  const allowed = new Set((allowedMethods || []).map(String));
  const seen = new Set();
  const lines = [];
  let sumCents = 0;
  for (const line of payments) {
    const method = String(line?.paymentMethod || line?.method || '').trim();
    const amountCents = cents(line?.amount);
    if (!allowed.has(method) || amountCents <= 0) throw new Error(`Invalid payment line: method must be one of ${[...allowed].join(', ')} and amount must be greater than 0`);
    if (seen.has(method)) throw new Error(`Duplicate payment method: ${method}`);
    seen.add(method); sumCents += amountCents; lines.push({ method, amount: amountCents / 100 });
  }
  const expected = cents(total);
  if (sumCents !== expected) throw new Error(`Payments total ${(sumCents/100).toFixed(2)} does not match the sale total ${(expected/100).toFixed(2)}`);
  if (seen.has('customer_credit') && seen.size > 1) throw new Error('Customer credit cannot be combined with other payment methods');
  if (seen.has('gift_card') && seen.size > 1) throw new Error('Gift card cannot be combined with other payment methods');
  return lines;
}
