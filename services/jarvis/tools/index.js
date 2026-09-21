/*
 * JARVES read-only data tools - phase 1: TODAY'S SALES.
 *
 * A "tool" is a server-side function the JARVES service MAY run BEFORE asking
 * the AI provider. The AI never gets database access: the tool executes here,
 * inside the existing authentication/permission/store-scope model, and only a
 * small formatted summary of its result is injected into the prompt.
 *
 * Guarantees, enforced by design and pinned by tests:
 *   - the caller identity comes ONLY from the verified JWT context
 *     (companyId/storeId/roleId claims) - never from the request body, so a
 *     caller can never aim JARVES at another company or store;
 *   - permissions are the EXISTING onePOS codes that guard the reports API
 *     (`reports.summary.view` / `reports.sales.view`) plus the EXISTING
 *     Administrator/Owner bypass helper (canViewCompanyCustomers) - no second
 *     permission system is created;
 *   - "today" uses the EXISTING reporting timezone convention
 *     (`(s.created_at AT TIME ZONE c.timezone)::date`, companies.timezone) -
 *     never the AI server's clock or the model's opinion of the date;
 *   - every tool is strictly READ-ONLY (SELECT queries only, never writes);
 *   - tool results are formatted into a compact non-secret grounding block -
 *     no raw rows, no identifiers, no API keys, no provider configuration.
 */
import { JarvisError, JARVIS_ERROR_CODES } from "../errors.js";

/** Permission codes that legitimately grant Sales report visibility (existing onePOS codes). */
export const SALES_REPORT_PERMISSIONS = Object.freeze(["reports.summary.view", "reports.sales.view"]);

export const SALES_TODAY_TOOL_NAME = "todays_sales";

/*
 * Conservative trigger phrases, evaluated SERVER-SIDE (Gemini is never asked
 * to choose tools). A miss simply falls back to the general assistant - a
 * false negative is safe; a false positive only grounds the model with data
 * the caller is already entitled to see.
 */
const SALES_TODAY_PATTERN =
  /(today'?s? sales|sales (for |so far )?today|how much did we sell|how many sales|today'?s? (sales )?(summary|total|totals|figures|numbers|turnover)|daily sales|sales summary)/i;

/** Resolve Sales visibility via the EXISTING permission model + admin bypass. */
async function canViewSales(context, { canViewCompanyCustomers } = {}) {
  const permissions = Array.isArray(context?.permissions) ? context.permissions : [];
  if (SALES_REPORT_PERMISSIONS.some((code) => permissions.includes(code))) return true;
  if (typeof canViewCompanyCustomers === "function") {
    try {
      if (await canViewCompanyCustomers(context)) return true;
    } catch (error) {
      console.error("JARVES admin-bypass check failed:", (error && error.message) || error);
    }
  }
  return false;
}

/** Today's date in the COMPANY's timezone - the same convention reports use. */
async function companyToday(db, companyId) {
  const result = await db(`SELECT timezone FROM companies WHERE id = $1`, [companyId]);
  const timezone = result.rows[0]?.timezone;
  if (!timezone) {
    throw new JarvisError(JARVIS_ERROR_CODES.TOOL_UNAVAILABLE, {
      detail: `company timezone not found for tool 'todays_sales'`,
    });
  }
  const todayResult = await db(`SELECT (NOW() AT TIME ZONE $1)::date AS today`, [timezone]);
  return { timezone, today: todayResult.rows[0]?.today ?? null };
}

/**
 * Today's Sales summary. Reuses the EXISTING onePOS report definitions from
 * routes/reports.js (`GET /api/reports/summary`): completed sales for the
 * caller's company + store, gross sales / transactions / VAT / discounts,
 * plus CUSTOMER stock returns valued at the original sale-item price, and
 * net = gross - returns. "Today" is the company-timezone date. No new
 * accounting definitions are introduced.
 */
async function todaysSales(context, { db, canViewCompanyCustomers }) {
  if (!context?.companyId || !context?.storeId) {
    throw new JarvisError(JARVIS_ERROR_CODES.TOOL_UNAVAILABLE, {
      detail: "session has no company/store scope; todays_sales is unavailable",
    });
  }
  if (!(await canViewSales(context, { canViewCompanyCustomers }))) {
    throw new JarvisError(JARVIS_ERROR_CODES.TOOL_PERMISSION_DENIED, {
      detail: `user ${context.userId ?? "unknown"} lacks Sales report permission; no data was read`,
    });
  }

  const { timezone, today } = await companyToday(db, context.companyId);
  if (!today) {
    throw new JarvisError(JARVIS_ERROR_CODES.TOOL_UNAVAILABLE, {
      detail: "could not resolve today's company-timezone date",
    });
  }

  const result = await db(
    `
    WITH sales_total AS (
      SELECT COALESCE(SUM(s.total),0) gross_sales, COUNT(*)::int transactions,
        COALESCE(SUM(s.tax),0) vat, COALESCE(SUM(s.discount),0) discounts
      FROM sales s INNER JOIN companies c ON c.id=s.company_id
      WHERE s.company_id=$1 AND s.store_id=$2 AND s.status='completed'
        AND (s.created_at AT TIME ZONE c.timezone)::date = $3::date
    ), returns_total AS (
      SELECT COALESCE(SUM(sri.quantity * si.unit_price),0) returned_value
      FROM stock_returns sr
      INNER JOIN stock_return_items sri ON sri.return_id=sr.id
      INNER JOIN sale_items si ON si.id=sri.sale_item_id
      WHERE sr.company_id=$1 AND sr.store_id=$2 AND sr.return_type='CUSTOMER'
        AND sr.created_at::date = $3::date
    ) SELECT sales_total.*, returns_total.returned_value FROM sales_total, returns_total
    `,
    [context.companyId, context.storeId, today]
  );

  const row = result.rows[0] || {};
  const gross = Number(row.gross_sales || 0);
  const returned = Number(row.returned_value || 0);
  const transactions = Number(row.transactions || 0);

  return {
    tool: SALES_TODAY_TOOL_NAME,
    date: String(today),
    timezone,
    summary: {
      grossSales: gross,
      transactions,
      averageTransaction: transactions ? gross / transactions : 0,
      vat: Number(row.vat || 0),
      discounts: Number(row.discounts || 0),
      returns: returned,
      netSales: gross - returned,
    },
  };
}

/** Tool registry handed to the JARVES service (per request, by the route). */
export function createJarvisTools({ db, canViewCompanyCustomers = null } = {}) {
  if (typeof db !== "function") {
    throw new Error("createJarvisTools requires the existing db helper");
  }

  /**
   * Decide (server-side, before any AI call) whether a tool should run for
   * this question. Returns { name } or null. Gemini is never asked to decide.
   */
  function matchTool(question) {
    const text = String(question || "");
    if (SALES_TODAY_PATTERN.test(text)) return { name: SALES_TODAY_TOOL_NAME };
    return null;
  }

  /** Execute a matched tool. Throws a JarvisError on permission/unavailability. */
  async function executeTool(name, context) {
    if (name !== SALES_TODAY_TOOL_NAME) {
      throw new JarvisError(JARVIS_ERROR_CODES.TOOL_UNAVAILABLE, {
        detail: `unknown tool '${name}'`,
      });
    }
    return todaysSales(context, { db, canViewCompanyCustomers });
  }

  return { matchTool, executeTool };
}

/** Format a tool result as the non-secret grounding block for the prompt. */
export function formatToolResultBlock(result) {
  if (!result || result.tool !== SALES_TODAY_TOOL_NAME) return "";
  const s = result.summary;
  const money = (value) => Number(value || 0).toFixed(2);
  return [
    "TOOL RESULT (server-computed, authoritative - use ONLY these figures):",
    `- tool: ${result.tool}`,
    `- date: ${result.date} (company timezone: ${result.timezone})`,
    `- Gross sales: ${money(s.grossSales)}`,
    `- transactions: ${s.transactions}`,
    `- average transaction: ${money(s.averageTransaction)}`,
    `- VAT: ${money(s.vat)}`,
    `- discounts: ${money(s.discounts)}`,
    `- refunds/returns: ${money(s.returns)}`,
    `- net sales: ${money(s.netSales)}`,
    "Use only these figures when answering about sales for this date. Do not invent, extrapolate or estimate any other numbers, and do not claim access to any other data.",
  ].join("\n");
}
