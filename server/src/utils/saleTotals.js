/*
 * onePOS basket totals — THE single sale-total/VAT engine used by the staff
 * POS and Self-Checkout alike (T10D). Extracted verbatim from POS.jsx so
 * Self-Checkout provably uses the same calculation (per-product VAT
 * applicability, proportional discount allocation, global VAT master switch)
 * instead of a second implementation.
 *
 * Discounts supported:
 *  - per-line (item) discount: passed on each basket line as
 *    { discountType: "percent"|"fixed", discountValue: number } and applied
 *    before the order discount. A line with no discount field is unchanged
 *    (backwards compatible).
 *  - order discount: passed in computeBasketTotals opts as
 *    { discountType, discountValue } and applied across the discounted basket.
 */

function roundCurrency(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/*
 * T10-PRICE: resolve the effective selling price for a sale line.
 *
 * The catalogue price is the default. A manual override is applied ONLY when
 * the operator holds sale.price_override (`canOverridePrice`) AND proposes a
 * positive `priceOverride`. Without the permission the catalogue price wins
 * regardless of what the client submits, so a user cannot alter the selling
 * price via a crafted request. Returns { price, overridden, originalPrice }.
 */
export function resolveEffectivePrice({
  cataloguePrice,
  priceOverride,
  canOverridePrice,
}) {
  const cp = Number(cataloguePrice) || 0;
  const po = Number(priceOverride) || 0;
  if (canOverridePrice && po > 0) {
    return { price: roundCurrency(po), overridden: true, originalPrice: cp };
  }
  return { price: cp, overridden: false, originalPrice: cp };
}

const lineDiscount = (item) => {
  const type = item.discountType;
  if (type !== "percent" && type !== "fixed") return 0;
  const val = Number(item.discountValue) || 0;
  if (!val) return 0;
  const gross = Number(item.price || 0) * item.quantity;
  const amt = type === "percent"
    ? Math.min(gross, gross * (val / 100))
    : Math.min(gross, Math.max(0, val));
  return roundCurrency(amt);
};

export { roundCurrency };

export function lineTaxFor(line, { vatEnabled = true, vatRate = 0 } = {}) {
  if (!vatEnabled || line.vatApplicable === false) return 0;
  const ownRate = line.vatRate == null ? null : Number(line.vatRate) / 100;
  const rate = ownRate !== null && Number.isFinite(ownRate) ? ownRate : Number(vatRate) || 0;
  return roundCurrency((Number(line.price) || 0) * (Number(line.quantity) || 0) * rate);
}

export function computeBasketTotals(
  basket,
  { vatEnabled = true, vatRate = 0, discountType = null, discountValue = 0 } = {}
) {
  const lineDiscounts = basket.map((item) => ({
    line: item,
    lineDiscount: lineDiscount(item),
  }));

  const grossSubtotal = basket.reduce(
    (total, item) => total + Number(item.price || 0) * item.quantity,
    0
  );
  const totalLineDiscount = lineDiscounts.reduce(
    (sum, ld) => sum + ld.lineDiscount,
    0
  );

  const netSubtotal = Math.max(0, grossSubtotal - totalLineDiscount);

  const orderDiscountAmount = discountType === "percent"
    ? Math.min(netSubtotal, netSubtotal * (Number(discountValue) / 100))
    : Math.min(netSubtotal, Math.max(0, Number(discountValue) || 0));

  const discountAmount = roundCurrency(totalLineDiscount + orderDiscountAmount);
  const subtotal = Math.max(0, grossSubtotal - discountAmount);

  /*
   * VAT: global VAT enabled + rate, refined by per-product applicability —
   * a product with vatApplicable=false never attracts VAT on its lines,
   * whatever its vatRate. The order discount is allocated proportionally
   * across each VAT-applicable line (or its exemption) by scaling its net
   * value against the net basket, matching the original single-engine rule.
   */
  const vatApplicableGross = basket.reduce(
    (sum, item) =>
      item.vatApplicable === false
        ? sum
        : sum + Number(item.price || 0) * item.quantity,
    0
  );
  const vat = lineDiscounts.reduce(
    (sum, { line, lineDiscount }) => {
      if (!vatEnabled || line.vatApplicable === false) return sum;
      const lineGross = Number(line.price || 0) * line.quantity;
      const lineNet = Math.max(0, lineGross - lineDiscount);
      const orderShare = netSubtotal > 0
        ? lineNet / netSubtotal
        : lineNet / vatApplicableGross;
      const discountedLine = Math.max(0, lineNet - orderDiscountAmount * orderShare);
      return sum + lineTaxFor({ ...line, price: discountedLine, quantity: 1 }, { vatEnabled, vatRate });
    },
    0
  );
  const roundedVat = roundCurrency(vat);

  return {
    grossSubtotal: roundCurrency(grossSubtotal),
    lineDiscounts: lineDiscounts.map((ld, i) => ({
      index: i,
      discountType: ld.line.discountType || null,
      discountValue: ld.line.discountValue || 0,
      amount: ld.lineDiscount,
    })),
    orderDiscount: roundCurrency(orderDiscountAmount),
    discountAmount,
    subtotal: roundCurrency(subtotal),
    vat: roundedVat,
    total: roundCurrency(subtotal + roundedVat),
  };
}
