const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export function calculateLayawayBalance(total, paidAmount = 0) {
  const totalValue = money(total);
  const paid = money(paidAmount);
  if (totalValue < 0 || paid < 0) throw new Error("Layaway totals cannot be negative");
  if (paid > totalValue) throw new Error("Payment exceeds outstanding balance");
  return { total: totalValue, paidAmount: paid, balance: money(totalValue - paid) };
}

export function validateLayawayDeposit(total, deposit = 0) {
  const state = calculateLayawayBalance(total, deposit);
  return { deposit: state.paidAmount, balance: state.balance };
}

export function validateLayawayPayment(balance, amount) {
  const outstanding = money(balance);
  const payment = money(amount);
  if (!(payment > 0)) throw new Error("Payment amount must be positive");
  if (payment > outstanding) throw new Error("Payment exceeds outstanding balance");
  return { amount: payment, remainingBalance: money(outstanding - payment) };
}

export function canCompleteLayaway(layaway = {}) {
  return String(layaway.status || "").toUpperCase() === "OPEN" && money(layaway.balance) === 0;
}
