/*
 * onePOS basket totals — THE single sale-total/VAT engine used by the staff
 * POS and Self-Checkout alike (T10D). Extracted verbatim from POS.jsx so
 * Self-Checkout provably uses the same calculation (per-product VAT
 * applicability, proportional discount allocation, global VAT master switch)
 * instead of a second implementation.
 */
export function computeBasketTotals(
  basket,
  { vatEnabled = true, vatRate = 0, discountType = null, discountValue = 0 } = {}
) {
  const grossSubtotal = basket.reduce(
    (total, item) => total + Number(item.price || 0) * item.quantity,
    0
  );
  const discountAmount = discountType === "percent"
    ? Math.min(grossSubtotal, grossSubtotal * (Number(discountValue) / 100))
    : Math.min(grossSubtotal, Math.max(0, Number(discountValue) || 0));
  const subtotal = Math.max(0, grossSubtotal - discountAmount);
  /*
   * VAT: global VAT enabled + rate, refined by per-product applicability —
   * a product with vatApplicable=false never attracts VAT on its lines,
   * whatever its vatRate. No second VAT engine.
   */
  const vatApplicableSubtotal = basket.reduce(
    (sum, item) =>
      item.vatApplicable === false
        ? sum
        : sum + Number(item.price || 0) * item.quantity,
    0
  );
  const discountedVatSubtotal = grossSubtotal > 0
    ? vatApplicableSubtotal * (subtotal / grossSubtotal)
    : vatApplicableSubtotal;
  const vat = vatEnabled ? discountedVatSubtotal * vatRate : 0;
  return { grossSubtotal, discountAmount, subtotal, vat, total: subtotal + vat };
}
