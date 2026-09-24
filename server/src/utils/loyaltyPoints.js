/*
 * onePOS — Loyalty points validation (shared by server + client).
 *
 * The authoritative redemption rule lives here so every redemption path
 * (sale engine today, future POS UI/self-checkout) enforces the same
 * business rules from the company's programme configuration.
 *
 * Programme config (company_settings, via /api/settings → data.loyalty):
 *   loyalty_enabled              programme master switch
 *   loyalty_redeem_value_per_point currency value of one point (e.g. 0.01)
 *   loyalty_min_points_redeem    minimum points required for redemption
 *
 * All rules throw Error with a user-presentable message; callers decide
 * whether that becomes an HTTP 400 or a disabled button.
 */

/** Config-only check: enabled + redemption economics configured. */
export function validateRedeemConfig(programme) {
  const enabled = programme ? programme.loyalty_enabled : undefined;
  if (enabled === false) {
    throw new Error("Loyalty programme is not enabled.");
  }
  if (!programme || programme.loyalty_redeem_value_per_point == null) {
    throw new Error("Points redemption is not configured for this company.");
  }
  const valuePerPoint = Number(programme.loyalty_redeem_value_per_point);
  if (!Number.isFinite(valuePerPoint) || valuePerPoint <= 0) {
    throw new Error("Points redemption is not configured for this company.");
  }
  if (!programme || programme.loyalty_min_points_redeem == null) {
    throw new Error("Points redemption is not configured for this company.");
  }
  const minPoints = Number(programme.loyalty_min_points_redeem);
  if (!Number.isFinite(minPoints) || minPoints < 0) {
    throw new Error("Points redemption is not configured for this company.");
  }
  return { valuePerPoint, minPoints };
}

/** Full check: config rules + balance cap + minimum-points rule. */
export function validateRedeemablePoints(currentBalance, requestedPoints, programme) {
  const { valuePerPoint, minPoints } = validateRedeemConfig(programme);

  const balance = Number(currentBalance);
  const requested = Number(requestedPoints);

  if (!Number.isFinite(balance) || balance <= 0) {
    throw new Error("No loyalty points available to redeem.");
  }
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error("A positive number of points is required to redeem.");
  }

  if (requested > balance) {
    throw new Error(
      `Requested redemption of ${requested} points exceeds the available balance of ${balance} points.`
    );
  }
  if (requested < minPoints) {
    throw new Error(
      `A minimum of ${minPoints} points is required for redemption.`
    );
  }

  return { points: requested, valuePerPoint };
}
