export function planReceipt(lines, requestedItems = null) {
  const requestedByLine = new Map(
    Array.isArray(requestedItems)
      ? requestedItems.map((item) => [String(item.purchaseItemId), Number(item.quantity)])
      : []
  );
  return lines.map((line) => {
    const remaining = Number(line.quantity) - Number(line.received_quantity || 0);
    const quantity = requestedByLine.size
      ? Number(requestedByLine.get(String(line.purchase_item_id)) || 0)
      : remaining;
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Invalid received quantity");
    if (quantity > remaining) throw new Error(`Cannot receive more than the remaining quantity for product ${line.product_id}`);
    return { ...line, quantity, remaining };
  }).filter((line) => line.quantity > 0);
}
