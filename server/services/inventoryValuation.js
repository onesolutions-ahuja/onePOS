export function inventoryValue(quantity, unitCost) {
  const stock = Number(quantity) || 0;
  const cost = Number(unitCost) || 0;
  return Math.round((stock * cost + Number.EPSILON) * 100) / 100;
}

export function valuationRow(row) {
  const quantity = Number(row.quantity ?? row.stock_quantity) || 0;
  const unitCost = row.cost_price == null ? null : Number(row.cost_price);
  return {
    ...row,
    quantity,
    unitCost,
    stockValue: unitCost == null ? null : inventoryValue(quantity, unitCost),
  };
}
