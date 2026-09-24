import express from "express";

export default function createDashboardRouter({ authenticate, db }) {
  const router = express.Router();

  router.get("/dashboard/summary", authenticate, async (req, res) => {
    try {
      const result = await db(
        `
        WITH business_day AS (
          SELECT (CURRENT_TIMESTAMP AT TIME ZONE c.timezone)::date AS today
          FROM companies c
          WHERE c.id = $1
        ),
        valid_sales AS (
          SELECT s.id, s.total, s.created_at, s.store_id
          FROM sales s
          INNER JOIN companies c ON c.id = s.company_id
          CROSS JOIN business_day d
          WHERE s.company_id = $1
            AND s.store_id = $2
            AND s.status = 'completed'
            AND (s.created_at AT TIME ZONE c.timezone)::date = d.today
        ),
        daily_sales AS (
          SELECT
            dates.sale_date,
            COALESCE(SUM(s.total) FILTER (WHERE s.id IS NOT NULL), 0) AS sales
          FROM generate_series(
            (SELECT today FROM business_day) - 6,
            (SELECT today FROM business_day),
            INTERVAL '1 day'
          ) AS dates(sale_date)
          LEFT JOIN sales s
            ON s.company_id = $1
            AND s.store_id = $2
            AND s.status = 'completed'
            AND (s.created_at AT TIME ZONE (
              SELECT timezone FROM companies WHERE id = $1
            ))::date = dates.sale_date
          GROUP BY dates.sale_date
          ORDER BY dates.sale_date
        )
        SELECT
          COALESCE((SELECT SUM(total) FROM valid_sales), 0) AS today_sales,
          (SELECT COUNT(*) FROM valid_sales) AS today_transactions,
          COALESCE((SELECT COUNT(*) FROM products WHERE company_id = $1 AND active = true AND low_stock_level > 0 AND stock_quantity <= low_stock_level), 0) AS low_stock_count,
          (SELECT json_agg(json_build_object(
            'date', sale_date::date,
            'sales', sales
          ) ORDER BY sale_date) FROM daily_sales) AS sales_overview,
          c.name AS company_name,
          c.logo_url AS company_logo
        FROM companies c
        WHERE c.id = $1
        `,
        [req.user.companyId, req.user.storeId]
      );

      const summary = result.rows[0];
      const transactions = Number(summary.today_transactions);
      const todaySales = Number(summary.today_sales);

      res.json({
        success: true,
        data: {
          companyName: summary.company_name,
          companyLogo: summary.company_logo || null,
          todaySales,
          todayTransactions: transactions,
          averageSale: transactions ? todaySales / transactions : 0,
          lowStockCount: Number(summary.low_stock_count),
          salesOverview: (summary.sales_overview || []).map((day) => ({
            date: day.date,
            sales: Number(day.sales),
          })),
        },
      });
    } catch (error) {
      console.error("Dashboard summary error:", error);
      res.status(500).json({ success: false, message: "Unable to load dashboard" });
    }
  });

  return router;
}
