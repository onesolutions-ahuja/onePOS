const roundCurrency = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function calculateExchangeSettlement(returnTotal, replacementTotal) {
  const returned = roundCurrency(returnTotal);
  const replacement = roundCurrency(replacementTotal);
  return {
    returnTotal: returned,
    replacementTotal: replacement,
    difference: roundCurrency(replacement - returned),
    exchangeCredit: Math.min(returned, replacement),
  };
}
