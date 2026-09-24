import { validateRedeemConfig, validateRedeemablePoints } from "../src/utils/loyaltyPoints.js";

const round4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export { validateRedeemConfig, validateRedeemablePoints };

export function calculateLoyaltyEarn(saleTotal, programme = {}) {
  if (programme.loyalty_enabled === false) return { points: 0, eligible: false };
  const total = Number(saleTotal) || 0;
  const min = programme.loyalty_min_sale_total == null ? null : Number(programme.loyalty_min_sale_total);
  if (min != null && total < min) return { points: 0, eligible: false };
  const rate = Number(programme.loyalty_earning_rate ?? 0.01);
  const points = round4(Math.max(0, total) * Math.max(0, rate));
  return { points, eligible: points > 0 };
}

export function calculateLoyaltyRedemption(balance, requestedPoints, programme = {}) {
  const { points, valuePerPoint } = validateRedeemablePoints(balance, requestedPoints, programme);
  return { points, valuePerPoint, value: round2(points * valuePerPoint) };
}

export function calculateLoyaltyReversal(refundAmount, currentBalance, programme = {}) {
  if (programme.loyalty_enabled === false) return { points: 0 };
  const rate = Number(programme.loyalty_earning_rate ?? 0.01);
  const requested = round4(Math.max(0, Number(refundAmount) || 0) * Math.max(0, rate));
  return { points: Math.min(requested, Math.max(0, Number(currentBalance) || 0)) };
}
