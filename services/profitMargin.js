/*
 * onePOS Profit / Margin calculation service (Reporting -> Profit / margin).
 *
 * THE single place where the Profit & Margin report turns raw onePOS sales,
 * return and product-cost data into money figures. It contains NO SQL and no
 * database access: routes/reports.js reads the existing sales, sale_items,
 * stock_returns/stock_return_items, products.cost_price and users rows and
 * hands the raw numbers here, which keeps the arithmetic unit-testable and
 * impossible to duplicate in a second place.
 *
 * BASES (deliberate, documented):
 *  - Revenue is calculated EXCLUDING VAT (sale line total minus its tax) so
 *    gross profit compares like with like against product cost prices, which
 *    are also stored VAT-free. The VAT-inclusive gross total is still
 *    reported separately, so the report stays reconcilable with
 *    /reports/summary and /reports/vat (which report VAT-inclusive sales).
 *  - Returns are reversed on the same basis as the sale that created them
 *    (the returned share of the original line's VAT-exclusive value), and the
 *    returned units also reverse their share of COGS — stock comes back, so
 *    its cost comes back too.
 *  - COGS uses the EXISTING product cost master (products.cost_price). No
 *    second cost system, no valuation method of its own.
 *
 * MISSING / ZERO COST:
 *  A product with no cost price (NULL, empty or 0) has an UNKNOWN cost, not a
 *  free one — the same rule services/inventoryValuation.js already applies to
 *  stock valuation ("missing cost does not invent a valuation"). Those lines
 *  are therefore excluded from COGS and from gross profit instead of being
 *  counted as pure profit, they are reported as `costKnown: false` in the
 *  breakdown rows, and the totals expose exactly how much quantity/revenue
 *  was left out via `excluded` + `costComplete`.
 */
import { roundCurrency } from "../src/utils/saleTotals.js";

/** Quantities are NUMERIC(12,3) in onePOS — keep 3 decimal places. */
export function roundQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 1000) / 1000;
}

const num = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

/**
 * Is a product cost price usable for profitability?
 * NULL / undefined / "" / non-numeric / 0 / negative all mean "unknown".
 */
export function isCostKnown(costPrice) {
  if (costPrice === null || costPrice === undefined || costPrice === "") return false;
  const value = Number(costPrice);
  return Number.isFinite(value) && value > 0;
}

/**
 * Cost of goods sold for one quantity at one cost price.
 * Returns null (never a fake 0) when the cost price is unknown.
 */
export function lineCogs(quantity, costPrice) {
  if (!isCostKnown(costPrice)) return null;
  return roundCurrency(num(quantity) * num(costPrice));
}

/** Gross margin percentage on the given revenue base (0 when there is no revenue). */
export function marginPercent(grossProfit, revenue) {
  const base = num(revenue);
  if (!base) return 0;
  return Math.round((num(grossProfit) / base) * 10000) / 100;
}

/**
 * Build the headline Profit & Margin figures from the aggregate SQL row.
 *
 * `raw` carries the sold totals and the (already reversed) returned totals on
 * the same VAT-exclusive basis. Everything is computed on the NET figures, so
 * a fully returned period reports zero revenue, zero COGS and a 0 margin
 * rather than a phantom profit.
 */
export function summariseProfit(raw = {}) {
  const grossSales = roundCurrency(num(raw.gross_sales));
  const vat = roundCurrency(num(raw.vat));
  const discounts = roundCurrency(num(raw.discounts));
  const transactions = Math.trunc(num(raw.transactions));

  const soldQuantity = roundQuantity(raw.sold_quantity);
  const returnedQuantity = roundQuantity(raw.returned_quantity);
  const quantitySold = roundQuantity(soldQuantity - returnedQuantity);

  const soldRevenue = roundCurrency(num(raw.sold_revenue));
  const returnedRevenue = roundCurrency(num(raw.returned_revenue));
  const returns = returnedRevenue;
  const netSales = roundCurrency(grossSales - vat - returns);

  const cogs = roundCurrency(num(raw.sold_cogs) - num(raw.returned_cogs));
  const costedNetSales = roundCurrency(num(raw.sold_costed_revenue) - num(raw.returned_costed_revenue));
  const grossProfit = roundCurrency(costedNetSales - cogs);

  const excludedQuantity = roundQuantity(num(raw.sold_uncosted_quantity) - num(raw.returned_uncosted_quantity));
  const excludedRevenue = roundCurrency(num(raw.sold_uncosted_revenue) - num(raw.returned_uncosted_revenue));
  const excludedLines = Math.trunc(num(raw.sold_uncosted_lines)) + Math.trunc(num(raw.returned_uncosted_lines));

  return {
    /* VAT-inclusive sales total — matches /reports/summary and /reports/vat. */
    grossSales,
    vat,
    discounts,
    transactions,
    /* Net sales EXCLUDING VAT and net of returns — the margin revenue base. */
    netSales,
    soldRevenue,
    returnedRevenue,
    returns,
    soldQuantity,
    returnedQuantity,
    quantitySold,
    cogs,
    costedNetSales,
    grossProfit,
    grossMargin: marginPercent(grossProfit, costedNetSales),
    /* true only when every figure above covers all sold/returned lines. */
    costComplete: excludedQuantity === 0 && excludedRevenue === 0,
    excluded: {
      lines: excludedLines,
      quantity: excludedQuantity,
      revenue: excludedRevenue,
    },
  };
}

/**
 * Assemble the complete API payload for the Profit & Margin report.
 *
 * Headline figures always come from the aggregate row (never from summing the
 * limited breakdown tables), so a truncated breakdown can never change the
 * reported totals.
 */
export function buildProfitReport({ filters = {}, aggregates = {}, products = [], operators = [], stores = [] } = {}) {
  const totals = summariseProfit(aggregates);
  return {
    filters: {
      dateFrom: filters.dateFrom ?? null,
      dateTo: filters.dateTo ?? null,
      storeId: filters.storeId ?? null,
      productId: filters.productId ?? null,
      userId: filters.userId ?? null,
    },
    ...totals,
    products: (Array.isArray(products) ? products : []).map(breakdownRow),
    operators: (Array.isArray(operators) ? operators : []).map(breakdownRow),
    stores: (Array.isArray(stores) ? stores : []).map((store) => ({ id: store.id, name: store.name })),
  };
}

/**
 * Shape one SQL breakdown row (per product or per operator) into a report row.
 *
 * The SQL already applies the cost guard, so `cogs`/`costed_revenue` cover
 * only the lines whose product has a known cost price, while `revenue` covers
 * every line. The difference is reported as the uncosted part instead of
 * being silently added to profit.
 */
export function breakdownRow(raw = {}) {
  const quantitySold = roundQuantity(raw.quantity_sold);
  const revenue = roundCurrency(num(raw.revenue));
  const costedRevenue = roundCurrency(num(raw.costed_revenue));
  const cogs = roundCurrency(num(raw.cogs));
  const uncostedQuantity = roundQuantity(raw.uncosted_quantity);
  const uncostedRevenue = roundCurrency(num(raw.uncosted_revenue));
  const grossProfit = roundCurrency(costedRevenue - cogs);
  const costKnown = isCostKnown(raw.cost_price);

  return {
    productId: raw.product_id ?? null,
    product: raw.product ?? null,
    sku: raw.sku ?? null,
    costPrice: costKnown ? roundCurrency(raw.cost_price) : null,
    costKnown,
    userId: raw.user_id ?? null,
    username: raw.username ?? null,
    quantitySold,
    revenue,
    cogs,
    costedRevenue,
    grossProfit,
    grossMargin: marginPercent(grossProfit, costedRevenue),
    uncostedQuantity,
    uncostedRevenue,
    costComplete: uncostedQuantity === 0 && uncostedRevenue === 0,
  };
}
