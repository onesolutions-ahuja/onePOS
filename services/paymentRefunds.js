function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function refundedAmount(refundedByMethod, method) {
  if (refundedByMethod instanceof Map) return Number(refundedByMethod.get(method)) || 0;
  return Number(refundedByMethod?.[method]) || 0;
}

export function remainingRefundable(payments = [], refundedByMethod = new Map()) {
  return roundMoney(payments.reduce((sum, payment) => {
    const paid = Number(payment?.amount) || 0;
    const refunded = refundedAmount(refundedByMethod, payment?.method);
    return sum + Math.max(0, roundMoney(paid - refunded));
  }, 0));
}

export function allocateRefund(payments = [], refundAmount, refundedByMethod = new Map()) {
  const allocation = [];
  let remaining = roundMoney(refundAmount);
  for (const payment of payments) {
    if (remaining <= 0) break;
    const paid = Number(payment?.amount) || 0;
    const alreadyRefunded = refundedAmount(refundedByMethod, payment?.method);
    const take = roundMoney(Math.min(remaining, Math.max(0, roundMoney(paid - alreadyRefunded))));
    if (take > 0) allocation.push({ method: payment.method, amount: take });
    remaining = roundMoney(remaining - take);
  }
  return { allocation, unallocated: remaining };
}
