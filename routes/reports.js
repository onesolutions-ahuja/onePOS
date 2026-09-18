import express from "express";

export default function createReportsRouter({ authenticate, authorize, db }) {
  const router = express.Router();

  function scopedReportParams(req) {
    return [req.user.companyId, req.user.storeId, req.query.dateFrom || null, req.query.dateTo || null];
  }

  router.get("/reports/summary", authenticate, authorize("reports.summary.view"), async (req, res) => {
    try {
      const result = await db(
        `
        WITH sales_total AS (
          SELECT COALESCE(SUM(s.total),0) gross_sales, COUNT(*)::int transactions,
            COALESCE(SUM(s.tax),0) vat, COALESCE(SUM(s.discount),0) discounts
          FROM sales s INNER JOIN companies c ON c.id=s.company_id
          WHERE s.company_id=$1 AND s.store_id=$2 AND s.status='completed'
            AND ($3::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date >= $3::date)
            AND ($4::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date <= $4::date)
        ), returns_total AS (
          SELECT COALESCE(SUM(sri.quantity * si.unit_price),0) returned_value
          FROM stock_returns sr
          INNER JOIN stock_return_items sri ON sri.return_id=sr.id
          INNER JOIN sale_items si ON si.id=sri.sale_item_id
          WHERE sr.company_id=$1 AND sr.store_id=$2 AND sr.return_type='CUSTOMER'
            AND ($3::date IS NULL OR sr.created_at::date >= $3::date)
            AND ($4::date IS NULL OR sr.created_at::date <= $4::date)
        ) SELECT sales_total.*, returns_total.returned_value FROM sales_total, returns_total
        `,
        scopedReportParams(req)
      );
      const row = result.rows[0];
      const gross = Number(row.gross_sales);
      const returned = Number(row.returned_value);
      res.json({ success: true, data: { grossSales: gross, transactions: Number(row.transactions), averageTransaction: Number(row.transactions) ? gross / Number(row.transactions) : 0, vat: Number(row.vat), discounts: Number(row.discounts), returns: returned, netSales: gross - returned } });
    } catch (error) { console.error("Reports summary error:", error); res.status(500).json({ success: false, message: "Unable to load report summary" }); }
  });

  router.get("/reports/sales", authenticate, authorize("reports.sales.view"), async (req, res) => {
    try {
      const result = await db(
        `
        WITH dates AS (SELECT generate_series(COALESCE($3::date, CURRENT_DATE), COALESCE($4::date, CURRENT_DATE), '1 day')::date AS report_date),
        daily AS (SELECT (s.created_at AT TIME ZONE c.timezone)::date report_date, COUNT(*)::int transactions, COALESCE(SUM(s.total),0) gross_sales, COALESCE(SUM(s.tax),0) vat FROM sales s INNER JOIN companies c ON c.id=s.company_id WHERE s.company_id=$1 AND s.store_id=$2 AND s.status='completed' GROUP BY 1),
        returned AS (SELECT sr.created_at::date report_date, COALESCE(SUM(sri.quantity * si.unit_price),0) returns FROM stock_returns sr INNER JOIN stock_return_items sri ON sri.return_id=sr.id INNER JOIN sale_items si ON si.id=sri.sale_item_id WHERE sr.company_id=$1 AND sr.store_id=$2 AND sr.return_type='CUSTOMER' GROUP BY 1)
        SELECT dates.report_date AS date, COALESCE(daily.transactions,0) transactions, COALESCE(daily.gross_sales,0) gross_sales, COALESCE(returned.returns,0) returns, COALESCE(daily.gross_sales,0)-COALESCE(returned.returns,0) net_sales, COALESCE(daily.vat,0) vat FROM dates LEFT JOIN daily USING(report_date) LEFT JOIN returned USING(report_date) ORDER BY dates.report_date
        `,
        scopedReportParams(req)
      );
      res.json({ success: true, data: result.rows.map((row) => ({ date: row.date, transactions: Number(row.transactions), grossSales: Number(row.gross_sales), returns: Number(row.returns), netSales: Number(row.net_sales), vat: Number(row.vat) })) });
    } catch (error) { console.error("Sales report error:", error); res.status(500).json({ success: false, message: "Unable to load sales report" }); }
  });

  router.get("/reports/products", authenticate, authorize("reports.products.view"), async (req, res) => {
    try {
      const result = await db(
        `
        SELECT p.id, p.name, p.sku, COALESCE(SUM(si.quantity) FILTER (WHERE s.id IS NOT NULL),0) quantity_sold, COALESCE(SUM(si.total) FILTER (WHERE s.id IS NOT NULL),0) gross_sales,
          COALESCE((SELECT SUM(sri.quantity) FROM stock_return_items sri INNER JOIN stock_returns sr ON sr.id=sri.return_id WHERE sr.return_type='CUSTOMER' AND sri.product_id=p.id AND sr.company_id=$1 AND sr.store_id=$2),0) returned_quantity,
          COALESCE((SELECT SUM(sri.quantity * si2.unit_price) FROM stock_return_items sri INNER JOIN stock_returns sr ON sr.id=sri.return_id INNER JOIN sale_items si2 ON si2.id=sri.sale_item_id WHERE sr.return_type='CUSTOMER' AND sri.product_id=p.id AND sr.company_id=$1 AND sr.store_id=$2),0) returned_sales
        FROM products p LEFT JOIN sale_items si ON si.product_id=p.id LEFT JOIN sales s ON s.id=si.sale_id AND s.company_id=$1 AND s.store_id=$2 AND s.status='completed' AND ($3::date IS NULL OR (s.created_at AT TIME ZONE (SELECT timezone FROM companies WHERE id=$1))::date >= $3::date) AND ($4::date IS NULL OR (s.created_at AT TIME ZONE (SELECT timezone FROM companies WHERE id=$1))::date <= $4::date)
        WHERE p.company_id=$1 GROUP BY p.id ORDER BY quantity_sold DESC LIMIT 100
        `,
        [req.user.companyId, req.user.storeId, req.query.dateFrom || null, req.query.dateTo || null]
      );
      res.json({ success: true, data: result.rows.map((row) => ({ product: row.name, sku: row.sku, quantitySold: Number(row.quantity_sold), grossSales: Number(row.gross_sales), returns: Number(row.returned_quantity), netQuantity: Number(row.quantity_sold) - Number(row.returned_quantity), netSales: Number(row.gross_sales) - Number(row.returned_sales) })) });
    } catch (error) { console.error("Product report error:", error); res.status(500).json({ success: false, message: "Unable to load product report" }); }
  });

  router.get("/reports/payments", authenticate, authorize("reports.payments.view"), async (req, res) => {
    try {
      const result = await db("SELECT pay.payment_method, COALESCE(SUM(pay.amount),0) total, COUNT(*)::int transactions FROM payments pay INNER JOIN sales s ON s.id=pay.sale_id INNER JOIN companies c ON c.id=s.company_id WHERE s.company_id=$1 AND s.store_id=$2 AND s.status='completed' AND ($3::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date >= $3::date) AND ($4::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date <= $4::date) GROUP BY pay.payment_method ORDER BY pay.payment_method", [req.user.companyId, req.user.storeId, req.query.dateFrom || null, req.query.dateTo || null]);
      res.json({ success: true, data: result.rows.map((row) => ({ method: row.payment_method, total: Number(row.total), transactions: row.transactions })) });
    } catch (error) { res.status(500).json({ success: false, message: "Unable to load payment report" }); }
  });

  router.get("/reports/customers", authenticate, authorize("reports.customers.view"), async (req, res) => {
    try {
      const result = await db("SELECT COALESCE(c.name,'Walk-in Customer') customer, COUNT(s.id)::int transactions, COALESCE(SUM(s.total),0) spend FROM sales s LEFT JOIN customers c ON c.id=s.customer_id INNER JOIN companies co ON co.id=s.company_id WHERE s.company_id=$1 AND s.store_id=$2 AND s.status='completed' AND ($3::date IS NULL OR (s.created_at AT TIME ZONE co.timezone)::date >= $3::date) AND ($4::date IS NULL OR (s.created_at AT TIME ZONE co.timezone)::date <= $4::date) GROUP BY c.id,c.name ORDER BY spend DESC LIMIT 100", [req.user.companyId, req.user.storeId, req.query.dateFrom || null, req.query.dateTo || null]);
      res.json({ success: true, data: result.rows.map((row) => ({ customer: row.customer, transactions: row.transactions, spend: Number(row.spend), returns: 0, netSpend: Number(row.spend) })) });
    } catch (error) { res.status(500).json({ success: false, message: "Unable to load customer report" }); }
  });


  /*
   * GET /reports/inventory-overview
   * Current stock snapshot for the store: product, SKU/barcode, category,
   * on-hand quantity, cost and stock value (plus a low-stock flag), used by
   * the "Inventory Overview" report page. Company/store come from the
   * authenticated session — never from query parameters.
   */
  router.get("/reports/inventory-overview", authenticate, authorize("reports.inventory.view"), async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(10000, Number(req.query.limit) || 1000));
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const result = await db(
        `
        SELECT
          p.name AS product,
          p.sku,
          p.barcode AS ean,
          COALESCE(cat.name, '-') AS category,
          p.stock_quantity,
          p.cost_price,
          (p.stock_quantity * COALESCE(p.cost_price, 0)) AS stock_value,
          (p.track_stock = true AND p.low_stock_level IS NOT NULL AND p.stock_quantity <= p.low_stock_level) AS low_stock
        FROM products p
        LEFT JOIN categories cat ON cat.id = p.category_id
        WHERE p.company_id = $1
        ORDER BY p.name
        LIMIT $2 OFFSET $3
        `,
        [req.user.companyId, limit, offset]
      );

      res.json({
        success: true,
        data: result.rows.map((row) => ({
          product: row.product,
          sku: row.sku,
          ean: row.ean,
          category: row.category,
          stock_quantity: Number(row.stock_quantity) || 0,
          cost_price: row.cost_price !== null ? Number(row.cost_price) : null,
          stock_value: Number(row.stock_value) || 0,
          low_stock: row.low_stock === true,
        })),
      });
    } catch (error) {
      console.error("Inventory overview report error:", error);
      res.status(500).json({ success: false, message: "Unable to load inventory overview report" });
    }
  });


  /*
   * T10R - same ledger, extended filters: reason (Wastage / Breakage /
   * Other, matched against the stored reason text), productId, category
   * (product category name), movementTypes + productIds lists. All optional
   * and backward compatible; company/store isolation unchanged.
   */
  router.get("/reports/inventory-movements", authenticate, authorize("reports.inventory_movements.view", "inventory.movements.view"), async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(10000, Number(req.query.limit) || 500));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const companyId = req.user.companyId;
      const storeId = req.user.storeId;
      const dateFrom = req.query.dateFrom || null;
      const dateTo = req.query.dateTo || null;

      const whereClauses = ["m.company_id = $1", "m.store_id = $2"];
      const params = [companyId, storeId];

      if (dateFrom || dateTo) {
        params.push(dateFrom || "1970-01-01", dateTo || "2099-12-31");
        whereClauses.push("(m.created_at AT TIME ZONE c.timezone)::date >= $3::date");
        whereClauses.push("(m.created_at AT TIME ZONE c.timezone)::date <= $4::date");
      } else {
        params.push(null, null);
      }

      const push = (clause, value) => {
        params.push(value);
        whereClauses.push(clause.replace("$$", `$${params.length}`));
      };

      const listParam = (value) => String(value || "").split(",").map((v) => v.trim()).filter(Boolean);

      if (req.query.reason) {
        const wanted = String(req.query.reason).trim().toLowerCase();
        if (!["wastage", "breakage", "other"].includes(wanted)) {
          return res.status(400).json({ success: false, message: "Invalid reason filter: use Wastage, Breakage or Other" });
        }
        if (wanted === "other") {
          whereClauses.push("(m.reason IS NULL OR NOT (LOWER(m.reason) IN ('wastage','wasted','waste','breakage','broken','damage','damaged')))");
        } else if (wanted === "wastage") {
          whereClauses.push("(LOWER(m.reason) IN ('wastage','wasted','waste'))");
        } else {
          whereClauses.push("(LOWER(m.reason) IN ('breakage','broken','damage','damaged'))");
        }
      }

      if (req.query.productId) push("m.product_id = $$", req.query.productId);
      for (const id of listParam(req.query.productIds)) push("m.product_id = $$", id);
      if (req.query.category) push("LOWER(cat.name) LIKE LOWER($$)", `%${req.query.category}%`);
      for (const t of listParam(req.query.movementTypes)) push("m.movement_type = $$", t);

      const rowsSql = `
        SELECT
          m.id,
          m.created_at,
          p.name AS product,
          p.sku,
          p.barcode AS ean,
          COALESCE(cat.name, '-') AS category,
          p.cost_price,
          s.name AS store_name,
          m.movement_type,
          m.quantity_change,
          (m.quantity_change * COALESCE(p.cost_price, 0)) AS line_value,
          m.balance_after,
          m.reference_type,
          m.reference_id,
          u.username,
          m.reason
        FROM inventory_movements m
        INNER JOIN products p ON p.id = m.product_id
        INNER JOIN companies c ON c.id = m.company_id
        LEFT JOIN categories cat ON cat.id = p.category_id
        LEFT JOIN stores s ON s.id = m.store_id
        LEFT JOIN users u ON u.id = m.created_by
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
      params.push(limit, offset);

      const rowsResult = await db(rowsSql, params);

      const countParams = params.slice(0, params.length - 2);
      const countSql = `
        SELECT COUNT(*)::int AS total,
          COALESCE(SUM(m.quantity_change), 0) AS quantity,
          COALESCE(SUM(m.quantity_change * COALESCE(p.cost_price, 0)), 0) AS value
        FROM inventory_movements m
        INNER JOIN products p ON p.id = m.product_id
        INNER JOIN companies c ON c.id = m.company_id
        LEFT JOIN categories cat ON cat.id = p.category_id
        WHERE ${whereClauses.join(" AND ")}
      `;
      const totalResult = await db(countSql, countParams);

      res.json({
        success: true,
        data: {
          rows: rowsResult.rows.map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            product: row.product,
            sku: row.sku,
            ean: row.ean,
            category: row.category,
            costPrice: row.cost_price !== null ? Number(row.cost_price) : null,
            storeName: row.store_name,
            movementType: row.movement_type,
            quantityChange: Number(row.quantity_change),
            lineValue: row.line_value !== null ? Number(row.line_value) : null,
            balanceAfter: row.balance_after !== null ? Number(row.balance_after) : null,
            referenceType: row.reference_type,
            referenceId: row.reference_id,
            createdBy: row.username,
            reason: row.reason,
          })),
          total: Number(totalResult.rows[0]?.total ?? 0),
          quantity: Number(totalResult.rows[0]?.quantity ?? 0),
          value: Number(totalResult.rows[0]?.value ?? 0),
          limit,
          offset,
        },
      });
    } catch (error) {
      console.error("Inventory movements report error:", error);
      res.status(500).json({ success: false, message: "Unable to load inventory movements report" });
    }
  });

  router.get("/reports/profit", authenticate, authorize("reports.profit.view"), async (req, res) => {
    try {
      const result = await db(
        `
        WITH sales_total AS (
          SELECT COALESCE(SUM(s.total),0) gross_sales, COALESCE(SUM(s.discount),0) discounts
          FROM sales s INNER JOIN companies c ON c.id=s.company_id
          WHERE s.company_id=$1 AND s.store_id=$2 AND s.status='completed'
            AND ($3::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date >= $3::date)
            AND ($4::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date <= $4::date)
        ), returns_total AS (
          SELECT COALESCE(SUM(sri.quantity * si.unit_price),0) returned_value
          FROM stock_returns sr
          INNER JOIN stock_return_items sri ON sri.return_id=sr.id
          INNER JOIN sale_items si ON si.id=sri.sale_item_id
          WHERE sr.company_id=$1 AND sr.store_id=$2 AND sr.return_type='CUSTOMER'
            AND ($3::date IS NULL OR sr.created_at::date >= $3::date)
            AND ($4::date IS NULL OR sr.created_at::date <= $4::date)
        ), cogs_total AS (
          SELECT COALESCE(SUM(si.quantity * COALESCE(p.cost_price,0)),0) cogs
          FROM sale_items si
          INNER JOIN sales s ON s.id=si.sale_id
          INNER JOIN companies c ON c.id=s.company_id
          INNER JOIN products p ON p.id=si.product_id
          WHERE s.company_id=$1 AND s.store_id=$2 AND s.status='completed'
            AND ($3::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date >= $3::date)
            AND ($4::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date <= $4::date)
        ) SELECT sales_total.gross_sales, sales_total.discounts, returns_total.returned_value, cogs_total.cogs FROM sales_total, returns_total, cogs_total
        `,
        scopedReportParams(req)
      );
      const row = result.rows[0];
      const gross = Number(row.gross_sales);
      const discounts = Number(row.discounts);
      const returned = Number(row.returned_value);
      const cogs = Number(row.cogs);
      const net = gross - returned;
      const profit = net - cogs;
      const margin = net ? (profit / net) * 100 : 0;
      res.json({ success: true, data: { grossSales: gross, discounts, returns: returned, netSales: net, cogs, grossProfit: profit, grossMargin: margin } });
    } catch (error) { console.error("Profit report error:", error); res.status(500).json({ success: false, message: "Unable to load profit report" }); }
  });

  router.get("/reports/till", authenticate, authorize("reports.till.view"), async (req, res) => {
    try {
      const result = await db(
        `
        SELECT ts.id, ts.status, ts.opened_at, ts.closed_at, ts.opening_cash, ts.closing_cash,
               ts.expected_cash, ts.cash_difference,
               t.name AS terminal_name, u.username AS opened_by_name, cl.username AS closed_by_name,
               COALESCE(SUM(CASE WHEN cm.type = 'cash_in' THEN cm.amount ELSE 0 END), 0) AS cash_in_total,
               COALESCE(SUM(CASE WHEN cm.type = 'cash_out' THEN cm.amount ELSE 0 END), 0) AS cash_out_total,
               (
                 SELECT COALESCE(SUM(sa.total), 0)
                 FROM sales sa
                 INNER JOIN payments pa ON pa.sale_id = sa.id
                 WHERE sa.company_id = ts.company_id
                   AND sa.store_id = ts.store_id
                   AND sa.terminal_id = ts.terminal_id
                   AND pa.payment_method = 'cash'
                   AND sa.status = 'completed'
                   AND sa.created_at BETWEEN ts.opened_at AND COALESCE(ts.closed_at, NOW())
               ) AS cash_sales
        FROM till_sessions ts
        INNER JOIN terminals t ON t.id = ts.terminal_id
        LEFT JOIN users u ON u.id = ts.user_id
        LEFT JOIN users cl ON cl.id = ts.closed_by
        LEFT JOIN cash_movements cm ON cm.till_session_id = ts.id
        WHERE ts.company_id = $1 AND ts.store_id = $2
          AND ($3::date IS NULL OR ts.opened_at::date >= $3::date)
          AND ($4::date IS NULL OR ts.opened_at::date <= $4::date)
        GROUP BY ts.id, t.name, u.username, cl.username
        ORDER BY ts.opened_at DESC
        `,
        scopedReportParams(req)
      );
      const sessions = result.rows.map((row) => {
        const opening = Number(row.opening_cash) || 0;
        const cashIn = Number(row.cash_in_total) || 0;
        const cashOut = Number(row.cash_out_total) || 0;
        const cashSales = Number(row.cash_sales) || 0;
        const closed = row.status === "closed";
        const expected = closed ? Number(row.expected_cash) || 0 : opening + cashIn - cashOut + cashSales;
        return {
          id: row.id,
          terminal: row.terminal_name,
          openedBy: row.opened_by_name,
          closedBy: row.closed_by_name,
          status: row.status,
          openedAt: row.opened_at,
          closedAt: row.closed_at,
          openingCash: opening,
          cashIn,
          cashOut,
          cashSales,
          expectedClosing: expected,
          actualClosing: closed ? Number(row.closing_cash) || 0 : null,
          difference: closed ? Number(row.cash_difference) || 0 : null,
        };
      });
      const summary = sessions.reduce(
        (acc, s) => ({
          sessions: acc.sessions + 1,
          openingCash: acc.openingCash + s.openingCash,
          cashIn: acc.cashIn + s.cashIn,
          cashOut: acc.cashOut + s.cashOut,
          cashSales: acc.cashSales + s.cashSales,
          expectedClosing: acc.expectedClosing + s.expectedClosing,
          actualClosing: acc.actualClosing + (s.actualClosing || 0),
          difference: acc.difference + (s.difference || 0),
        }),
        { sessions: 0, openingCash: 0, cashIn: 0, cashOut: 0, cashSales: 0, expectedClosing: 0, actualClosing: 0, difference: 0 }
      );
      res.json({ success: true, data: { summary, sessions } });
    } catch (error) { console.error("Till report error:", error); res.status(500).json({ success: false, message: "Unable to load till report" }); }
  });

  router.get("/reports/vat", authenticate, authorize("reports.vat.view"), async (req, res) => {
    try {
      const result = await db(
        `
        WITH sales_total AS (
          SELECT COALESCE(SUM(s.total),0) gross_sales, COALESCE(SUM(s.discount),0) discounts, COALESCE(SUM(s.tax),0) vat
          FROM sales s INNER JOIN companies c ON c.id=s.company_id
          WHERE s.company_id=$1 AND s.store_id=$2 AND s.status='completed'
            AND ($3::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date >= $3::date)
            AND ($4::date IS NULL OR (s.created_at AT TIME ZONE c.timezone)::date <= $4::date)
        ), returns_total AS (
          SELECT COALESCE(SUM(sri.quantity * si.unit_price),0) returned_value,
                 COALESCE(SUM(sri.quantity * si.tax),0) returned_vat
          FROM stock_returns sr
          INNER JOIN stock_return_items sri ON sri.return_id=sr.id
          INNER JOIN sale_items si ON si.id=sri.sale_item_id
          WHERE sr.company_id=$1 AND sr.store_id=$2 AND sr.return_type='CUSTOMER'
            AND ($3::date IS NULL OR sr.created_at::date >= $3::date)
            AND ($4::date IS NULL OR sr.created_at::date <= $4::date)
        ) SELECT sales_total.gross_sales, sales_total.discounts, sales_total.vat, returns_total.returned_value, returns_total.returned_vat FROM sales_total, returns_total
        `,
        scopedReportParams(req)
      );
      const row = result.rows[0];
      const gross = Number(row.gross_sales);
      const discounts = Number(row.discounts);
      const vat = Number(row.vat);
      const returned = Number(row.returned_value);
      const returnedVat = Number(row.returned_vat);
      res.json({
        success: true,
        data: {
          grossSales: gross,
          discounts,
          netSales: gross - returned,
          vat,
          salesExVat: gross - vat,
          returns: returned,
          returnsVat: returnedVat,
          vatAfterReturns: vat - returnedVat,
        },
      });
    } catch (error) { console.error("VAT report error:", error); res.status(500).json({ success: false, message: "Unable to load VAT report" }); }
  });

  return router;
}
