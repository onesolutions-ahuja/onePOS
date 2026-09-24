const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
export function calculateTax(amount, rate, { inclusive = false } = {}) {
  const gross = Math.max(0, Number(amount) || 0);
  const pct = Math.max(0, Number(rate) || 0);
  const tax = inclusive ? round2(gross - gross / (1 + pct / 100)) : round2(gross * pct / 100);
  return { net: inclusive ? round2(gross - tax) : gross, tax, gross: inclusive ? gross : round2(gross + tax), rate: pct };
}
