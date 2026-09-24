function amount(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.round(n * 100) / 100;
}
export function calculateTillCash({ openingCash=0, cashIn=0, cashOut=0, cashSales=0, cashRefunds=0 }={}) {
  return Math.round((amount(openingCash,'openingCash') + amount(cashIn,'cashIn') + amount(cashSales,'cashSales') - amount(cashOut,'cashOut') - amount(cashRefunds,'cashRefunds')) * 100) / 100;
}
export function calculateTillClose(input={}) {
  const expectedCash = calculateTillCash(input);
  const countedCash = amount(input.countedCash, 'countedCash');
  return { expectedCash, countedCash, cashDifference: Math.round((countedCash - expectedCash) * 100) / 100 };
}
export function validateCashMovement({ type, amount: value, availableCash=null }={}) {
  if (!['cash_in','cash_out'].includes(type)) throw new Error('Cash movement type must be cash_in or cash_out');
  const movementAmount = amount(value, 'amount');
  if (movementAmount <= 0) throw new Error('Cash movement amount must be greater than zero');
  if (type === 'cash_out' && availableCash != null && movementAmount > amount(availableCash,'availableCash')) throw new Error('Insufficient cash in drawer');
  return { type, amount: movementAmount };
}
