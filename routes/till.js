import express from "express";

export default function createTillRouter({ authenticate, authorize, db, getRolePermissionCodes, canViewCompanyCustomers }) {
  const router = express.Router();

  function money(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : NaN;
  }

  /*
   * GET /api/till/sessions/current
   * Returns the currently open till session for the authenticated user's store.
   */
  router.get(
    "/till/sessions/current",
    authenticate,
    authorize("till.open"),
    async (req, res) => {
      try {
        const result = await db(
          `
          SELECT ts.id, ts.terminal_id, ts.user_id, ts.opening_cash, ts.closing_cash,
                 ts.expected_cash, ts.cash_difference, ts.status, ts.opened_at, ts.closed_at, ts.closed_by,
                 t.name AS terminal_name, u.username AS opened_by_name,
                 COALESCE(SUM(CASE WHEN cm.type = 'cash_in' THEN cm.amount ELSE 0 END), 0) AS cash_in_total,
                 COALESCE(SUM(CASE WHEN cm.type = 'cash_out' THEN cm.amount ELSE 0 END), 0) AS cash_out_total,
          (
            SELECT COALESCE(SUM(sa.total), 0)
            FROM sales sa
            INNER JOIN payments pa ON pa.sale_id = sa.id
            WHERE sa.company_id = c.id
              AND sa.store_id = s.id
              AND sa.terminal_id = ts.terminal_id
              AND pa.payment_method = 'cash'
              AND sa.status = 'completed'
              AND sa.created_at BETWEEN ts.opened_at AND COALESCE(ts.closed_at, NOW())
          ) AS cash_sales
          FROM till_sessions ts
          INNER JOIN terminals t ON t.id = ts.terminal_id
          INNER JOIN stores s ON s.id = t.store_id
          INNER JOIN companies c ON c.id = s.company_id
          LEFT JOIN users u ON u.id = ts.user_id
          LEFT JOIN cash_movements cm ON cm.till_session_id = ts.id
          WHERE ts.company_id = $1
            AND ts.store_id = $2
            AND ts.status = 'open'
          GROUP BY ts.id, t.name, u.username, c.id, s.id
          ORDER BY ts.opened_at DESC
          LIMIT 1
          `,
          [req.user.companyId, req.user.storeId]
        );
        res.json({ success: true, data: result.rows[0] || null });
      } catch (error) {
        console.error("Load current till session error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load current till session" });
      }
    }
  );

  /*
   * GET /api/till/sessions
   * Returns till session history for the authenticated user's store.
   */
  router.get(
    "/till/sessions",
    authenticate,
    authorize("till.open"),
    async (req, res) => {
      try {
        const result = await db(
          `
          SELECT ts.id, ts.terminal_id, ts.user_id, ts.opening_cash, ts.closing_cash,
                 ts.expected_cash, ts.cash_difference, ts.status, ts.opened_at, ts.closed_at,
                 t.name AS terminal_name, u.username AS opened_by_name, cl.username AS closed_by_name
          FROM till_sessions ts
          INNER JOIN terminals t ON t.id = ts.terminal_id
          INNER JOIN stores s ON s.id = t.store_id
          INNER JOIN companies c ON c.id = s.company_id
          LEFT JOIN users u ON u.id = ts.user_id
          LEFT JOIN users cl ON cl.id = ts.closed_by
          WHERE ts.company_id = $1
            AND ts.store_id = $2
          ORDER BY ts.opened_at DESC
          LIMIT 50
          `,
          [req.user.companyId, req.user.storeId]
        );
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Load till history error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load till history" });
      }
    }
  );

  /*
   * POST /api/till/sessions
   * Opens a new till session for the default terminal of the authenticated user's store.
   */
  router.post(
    "/till/sessions",
    authenticate,
    authorize("till.open"),
    async (req, res) => {
      const opening = money(req.body.openingCash);
      if (!Number.isFinite(opening) || opening < 0) {
        return res
          .status(400)
          .json({ success: false, message: "Opening cash must be a positive number" });
      }
      try {
        const terminal = await db(
          "SELECT id FROM terminals WHERE store_id = $1 AND active = true ORDER BY created_at LIMIT 1",
          [req.user.storeId]
        );
        if (!terminal.rows.length) {
          return res
            .status(400)
            .json({ success: false, message: "No active till configured for this store" });
        }
        const terminalId = terminal.rows[0].id;

        const existing = await db(
          "SELECT id FROM till_sessions WHERE terminal_id = $1 AND status = 'open' LIMIT 1",
          [terminalId]
        );
        if (existing.rows.length) {
          return res
            .status(409)
            .json({ success: false, message: "A till session is already open for this terminal" });
        }

        const result = await db(
          `INSERT INTO till_sessions (company_id, store_id, terminal_id, user_id, opening_cash, status)
           VALUES ($1, $2, $3, $4, $5, 'open')
           RETURNING id, terminal_id, user_id, opening_cash, status, opened_at`,
          [req.user.companyId, req.user.storeId, terminalId, req.user.id, opening]
        );
        res.status(201).json({ success: true, message: "Till session opened", data: result.rows[0] });
      } catch (error) {
        console.error("Open till session error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to open till session" });
      }
    }
  );

  /*
   * POST /api/till/sessions/:id/close
   * Closes an open till session, calculating expected cash from opening, movements and cash sales.
   */
  router.post(
    "/till/sessions/:id/close",
    authenticate,
    authorize("till.close"),
    async (req, res) => {
      const counted = money(req.body.countedCash);
      if (!Number.isFinite(counted) || counted < 0) {
        return res
          .status(400)
          .json({ success: false, message: "Counted cash must be a positive number" });
      }
      try {
        const session = await db(
          `SELECT ts.id, ts.terminal_id, ts.store_id, ts.opening_cash, ts.opened_at
           FROM till_sessions ts
           WHERE ts.id = $1 AND ts.company_id = $2 AND ts.store_id = $3 AND ts.status = 'open'`,
          [req.params.id, req.user.companyId, req.user.storeId]
        );
        if (!session.rows.length) {
          return res
            .status(404)
            .json({ success: false, message: "Open till session not found" });
        }
        const s = session.rows[0];

        const cashIn = await db("SELECT COALESCE(SUM(amount),0) AS total FROM cash_movements WHERE till_session_id=$1 AND type='cash_in'", [s.id]);
        const cashOut = await db("SELECT COALESCE(SUM(amount),0) AS total FROM cash_movements WHERE till_session_id=$1 AND type='cash_out'", [s.id]);
        const cashSales = await db(
          `SELECT COALESCE(SUM(s.total),0) AS total
           FROM sales s
           INNER JOIN payments pa ON pa.sale_id = s.id
           WHERE s.company_id=$1 AND s.store_id=$2 AND s.terminal_id=$3
             AND pa.payment_method='cash' AND s.status='completed'
             AND s.created_at BETWEEN $4 AND NOW()`,
          [req.user.companyId, s.store_id, s.terminal_id, s.opened_at]
        );

        const opening = Number(s.opening_cash) || 0;
        const inTotal = Number(cashIn.rows[0].total) || 0;
        const outTotal = Number(cashOut.rows[0].total) || 0;
        const salesTotal = Number(cashSales.rows[0].total) || 0;
        const expectedCash = opening + inTotal - outTotal + salesTotal;
        const cashDifference = counted - expectedCash;

        const updated = await db(
          `UPDATE till_sessions
           SET status = 'closed',
               closing_cash = $1,
               expected_cash = $2,
               cash_difference = $3,
               closed_by = $4,
               closed_at = NOW()
           WHERE id = $5
           RETURNING id, terminal_id, opening_cash, closing_cash, expected_cash, cash_difference, status, opened_at, closed_at, closed_by`,
          [counted, expectedCash, cashDifference, req.user.id, s.id]
        );
        res.json({
          success: true,
          message: "Till session closed",
          data: {
            ...updated.rows[0],
            cash_sales: salesTotal,
            cash_in_total: inTotal,
            cash_out_total: outTotal,
          },
        });
      } catch (error) {
        console.error("Close till session error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to close till session" });
      }
    }
  );

  /*
   * GET /api/till/sessions/:id/cash-movements
   * Returns cash movement history for a specific till session.
   * Requires cash.adjustment or cash.payout permission.
   */
  router.get(
    "/till/sessions/:id/cash-movements",
    authenticate,
    authorize("cash.adjustment", "cash.payout"),
    async (req, res) => {
      try {
        const session = await db(
          "SELECT id FROM till_sessions WHERE id=$1 AND company_id=$2 AND store_id=$3",
          [req.params.id, req.user.companyId, req.user.storeId]
        );
        if (!session.rows.length)
          return res
            .status(404)
            .json({ success: false, message: "Till session not found" });
        const result = await db(
          `SELECT cm.id, cm.till_session_id, cm.user_id, u.username, cm.type, cm.amount, cm.reason, cm.created_at
           FROM cash_movements cm
           LEFT JOIN users u ON u.id = cm.user_id
           WHERE cm.till_session_id = $1
           ORDER BY cm.created_at DESC
           LIMIT 200`,
          [req.params.id]
        );
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Load cash movements error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load cash movements" });
      }
    }
  );

  /*
   * POST /api/till/sessions/:id/cash-movements
   * Records a cash-in or cash-out movement for a specific till session.
   * Requires cash.adjustment (cash_in) or cash.payout (cash_out) permission.
   */
  router.post(
    "/till/sessions/:id/cash-movements",
    authenticate,
    authorize("cash.adjustment", "cash.payout"),
    async (req, res) => {
      const { type, amount, reason = null } = req.body;
      const value = money(amount);
      if (!type || !["cash_in", "cash_out"].includes(type)) {
        return res
          .status(400)
          .json({ success: false, message: "Movement type must be 'cash_in' or 'cash_out'" });
      }
      if (!Number.isFinite(value) || value <= 0) {
        return res
          .status(400)
          .json({ success: false, message: "Amount must be a positive number" });
      }
      try {
        const session = await db(
          "SELECT id FROM till_sessions WHERE id=$1 AND company_id=$2 AND store_id=$3 AND status='open'",
          [req.params.id, req.user.companyId, req.user.storeId]
        );
        if (!session.rows.length)
          return res
            .status(404)
            .json({ success: false, message: "Open till session not found" });

        const required = type === "cash_in" ? "cash.adjustment" : "cash.payout";
        const codes = await getRolePermissionCodes(req.user.roleId);
        const isAdmin = await canViewCompanyCustomers(req.user);
        if (!isAdmin && !codes.includes(required)) {
          return res
            .status(403)
            .json({ success: false, message: "You do not have permission to perform this action" });
        }

        const result = await db(
          `INSERT INTO cash_movements (till_session_id, user_id, type, amount, reason)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, till_session_id, user_id, type, amount, reason, created_at`,
          [session.rows[0].id, req.user.id, type, value, reason || null]
        );
        res
          .status(201)
          .json({ success: true, message: "Cash movement recorded", data: result.rows[0] });
      } catch (error) {
        console.error("Cash movement error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to record cash movement" });
      }
    }
  );

  return router;
}
