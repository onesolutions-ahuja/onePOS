export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function activeAt(row, at = new Date()) {
  const time = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (row.active === false) return false;
  if (row.starts_at && time < new Date(row.starts_at).getTime()) return false;
  if (row.ends_at && time >= new Date(row.ends_at).getTime()) return false;
  return true;
}

export function applyDiscount(price, promotion) {
  if (!promotion) return roundMoney(price);
  if (promotion.discount_type === "percent") {
    return roundMoney(Math.max(0, price - price * Number(promotion.discount_value) / 100));
  }
  return roundMoney(Math.max(0, price - Number(promotion.discount_value)));
}

export function applyQuantityOffer(quantity, price, offer) {
  if (!offer || quantity < Number(offer.buy_quantity)) {
    return { total: roundMoney(quantity * price), paidQuantity: quantity, freeQuantity: 0 };
  }
  const buy = Number(offer.buy_quantity);
  const get = Number(offer.get_quantity || 0);
  const sets = Math.floor(quantity / (buy + get));
  const remainder = quantity % (buy + get);
  const paidQuantity = sets * buy + Math.min(remainder, buy);
  const total = offer.offer_type === "fixed_set"
    ? sets * Number(offer.set_price) + Math.min(remainder, buy) * price
    : paidQuantity * price * (1 - Number(offer.discount_percent || 0) / 100);
  return {
    total: roundMoney(Math.max(0, total)),
    paidQuantity,
    freeQuantity: Math.max(0, quantity - paidQuantity),
  };
}

export function resolvePrice({
  basePrice,
  scheduledPrices = [],
  customerPrice = null,
  groupPrice = null,
  priceListPrice = null,
  promotions = [],
  quantityOffer = null,
  quantity = 1,
  at = new Date(),
}) {
  const scheduled = scheduledPrices
    .filter((row) => activeAt(row, at))
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))[0];
  const source = customerPrice ?? groupPrice ?? priceListPrice ?? scheduled?.price ?? basePrice;
  const activePromotions = promotions.filter((row) => activeAt(row, at));
  const resolvedQuantityOffer = quantityOffer || activePromotions
    .filter((row) => Number(row.buy_quantity) > 0 && Number(row.get_quantity) >= 0)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] || null;
  const eligiblePromotions = activePromotions
    .filter((row) => !resolvedQuantityOffer || row.id !== resolvedQuantityOffer.id)
    .map((row) => ({ ...row, resulting_price: applyDiscount(source, row) }))
    .sort((a, b) => a.resulting_price - b.resulting_price || String(a.id).localeCompare(String(b.id)));
  const promotion = eligiblePromotions[0] || null;
  const unitPrice = promotion ? promotion.resulting_price : roundMoney(source);
  const quantityResult = applyQuantityOffer(quantity, unitPrice, resolvedQuantityOffer);
  return {
    unitPrice,
    total: quantityResult.total,
    paidQuantity: quantityResult.paidQuantity,
    freeQuantity: quantityResult.freeQuantity,
    pricingSource: customerPrice != null ? "customer" : groupPrice != null ? "group" : priceListPrice != null ? "price_list" : scheduled ? "scheduled" : "base",
    promotionId: promotion?.id || null,
    quantityOfferId: resolvedQuantityOffer?.id || null,
  };
}
