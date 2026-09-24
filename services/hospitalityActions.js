export function buildKitchenPrintPayload(ticket = {}) {
  const items = Array.isArray(ticket.items) ? ticket.items : [];
  return {
    title: "KITCHEN ORDER",
    orderNumber: ticket.order_number || "Order",
    tableNumber: ticket.table_number || null,
    station: ticket.station || null,
    notes: ticket.notes || null,
    createdAt: ticket.created_at || new Date().toISOString(),
    items: items.map((item) => ({
      name: item.name || item.product_name || "Item",
      quantity: Number(item.quantity || 1),
      notes: item.notes || null,
    })),
  };
}

export function validateQrOrderItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("At least one item is required");
  return items.map((item) => {
    const quantity = Number(item.quantity || 0);
    if (!item.productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Invalid order item");
    return { productId: String(item.productId), quantity, notes: item.notes ? String(item.notes).slice(0, 500) : null };
  });
}
