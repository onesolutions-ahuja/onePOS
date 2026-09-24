export function invoiceStatus(total, paid) {
  const balance = Math.max(0, Number(total) - Number(paid));
  if (balance <= 0.005) return "PAID";
  if (Number(paid) > 0) return "PARTIALLY_PAID";
  return "OPEN";
}

export function allocateSupplierPayment(amount, invoices) {
  let remaining = Number(amount);
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Payment amount must be positive");
  return (Array.isArray(invoices) ? invoices : []).map((invoice) => {
    const outstanding = Math.max(0, Number(invoice.total) - Number(invoice.paid || 0));
    const allocated = Math.min(remaining, outstanding);
    remaining = Math.round((remaining - allocated + Number.EPSILON) * 100) / 100;
    return { invoiceId: invoice.id, amount: allocated };
  }).filter((allocation) => allocation.amount > 0);
}
