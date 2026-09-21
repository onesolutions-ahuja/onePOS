import express from "express";

export default function createTillRouter({ authenticate, authorize, db, pool, getRolePermissionCodes, canViewCompanyCustomers }) {
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
          ) AS cash_sales,
          (
            SELECT COALESCE(SUM(r.amount), 0)
            FROM refunds r
            WHERE r.payment_method = 'cash'
              AND r.created_at BETWEEN ts.opened_at AND COALESCE(ts.closed_at, NOW())
              AND EXISTS (
                SELECT 1 FROM sales rs
                WHERE rs.id = r.sale_id
                  AND rs.company_id = c.id
                  AND rs.store_id = s.id
                  AND rs.terminal_id = ts.terminal_id
              )
          ) AS cash_refunds
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
        /* T-TILL: the backend is authoritative for the cash position — the
         * current/expected cash is computed HERE, never on the client. */
        const row = result.rows[0];
        const data = row
          ? {
              ...row,
              cash_refunds: Number(row.cash_refunds) || 0,
              current_cash: Math.round(
                ((Number(row.opening_cash) || 0) + (Number(row.cash_in_total) || 0) + (Number(row.cash_sales) || 0) -
                  (Number(row.cash_out_total) || 0) - (Number(row.cash_refunds) || 0)) * 100
              ) / 100,
            }
          : null;
        res.json({ success: true, data });
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
        /* T-TILL: a specific terminal may be requested; it must belong to the
         * caller's store (company/store/till isolation). Falls back to the
         * store's first active terminal as before. */
        let terminalId = null;
        if (req.body.terminalId) {
          const requested = await db(
            "SELECT id FROM terminals WHERE id = $1 AND store_id = $2 AND active = true",
            [req.body.terminalId, req.user.storeId]
          );
          if (!requested.rows.length) {
            return res.status(400).json({
              success: false,
              message: "Requested till does not belong to this store",
            });
          }
          terminalId = requested.rows[0].id;
        } else {
          const terminal = await db(
            "SELECT id FROM terminals WHERE store_id = $1 AND active = true ORDER BY created_at LIMIT 1",
            [req.user.storeId]
          );
          if (!terminal.rows.length) {
            return res
              .status(400)
              .json({ success: false, message: "No active till configured for this store" });
          }
          terminalId = terminal.rows[0].id;
        }

        const existing = await db(
          "SELECT id FROM till_sessions WHERE terminal_id = $1 AND status = 'open' LIMIT 1",
          [terminalId]
        );
        if (existing.rows.length) {
          return res
            .status(409)
            .json({ success: false, message: "A till session is already open for this terminal" });
        }

        try {
          const result = await db(
            `INSERT INTO till_sessions (company_id, store_id, terminal_id, user_id, opening_cash, status)
             VALUES ($1, $2, $3, $4, $5, 'open')
             RETURNING id, company_id, store_id, terminal_id, user_id, opening_cash, status, opened_at`,
            [req.user.companyId, req.user.storeId, terminalId, req.user.id, opening]
          );
          res.status(201).json({ success: true, message: "Till session opened", data: result.rows[0] });
        } catch (insertError) {
          /* The partial unique index uq_till_sessions_open_per_terminal makes
           * "at most one open session per till" atomic; a concurrent open
           * lands here. */
          if (insertError && insertError.code === "23505") {
            return res.status(409).json({
              success: false,
              message: "A till session is already open for this terminal",
            });
          }
          throw insertError;
        }
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
        /* T-TILL: close inside a transaction with the session row locked, so
         * a concurrent cash movement or a double-close cannot interleave and
         * the counted amount is never silently overwritten. */
        let client = null;
        try {
        client = await pool.connect();
        await client.query("BEGIN");
        const session = await client.query(
          `SELECT ts.id, ts.terminal_id, ts.store_id, ts.opening_cash, ts.opened_at
           FROM till_sessions ts
           WHERE ts.id = $1 AND ts.company_id = $2 AND ts.store_id = $3 AND ts.status = 'open'
           FOR UPDATE`,
          [req.params.id, req.user.companyId, req.user.storeId]
        );
        if (!session.rows.length) {
          await client.query("ROLLBACK");
          return res
            .status(404)
            .json({ success: false, message: "Open till session not found" });
        }
        const s = session.rows[0];

        const cashIn = await client.query("SELECT COALESCE(SUM(amount),0) AS total FROM cash_movements WHERE till_session_id=$1 AND type='cash_in'", [s.id]);
        const cashOut = await client.query("SELECT COALESCE(SUM(amount),0) AS total FROM cash_movements WHERE till_session_id=$1 AND type='cash_out'", [s.id]);
        const cashSales = await client.query(
          `SELECT COALESCE(SUM(s.total),0) AS total
           FROM sales s
           INNER JOIN payments pa ON pa.sale_id = s.id
           WHERE s.company_id=$1 AND s.store_id=$2 AND s.terminal_id=$3
             AND pa.payment_method='cash' AND s.status='completed'
             AND s.created_at BETWEEN $4 AND NOW()`,
          [req.user.companyId, s.store_id, s.terminal_id, s.opened_at]
        );
        /* T-TILL: cash refunds given during the session reduce the drawer —
         * expected cash must account for them (cash column exists on
         * refunds; sales-side scoping keeps it terminal/store accurate). */
        const cashRefunds = await client.query(
          `SELECT COALESCE(SUM(r.amount),0) AS total
           FROM refunds r
           INNER JOIN sales s ON s.id = r.sale_id
           WHERE s.company_id=$1 AND s.store_id=$2 AND s.terminal_id=$3
             AND r.payment_method='cash'
             AND r.created_at BETWEEN $4 AND NOW()`,
          [req.user.companyId, s.store_id, s.terminal_id, s.opened_at]
        );

        const opening = Number(s.opening_cash) || 0;
        const inTotal = Number(cashIn.rows[0].total) || 0;
        const outTotal = Number(cashOut.rows[0].total) || 0;
        const salesTotal = Number(cashSales.rows[0].total) || 0;
        const refundsTotal = Number(cashRefunds.rows[0].total) || 0;
        const expectedCash = Math.round((opening + inTotal - outTotal + salesTotal - refundsTotal) * 100) / 100;
        const cashDifference = Math.round((counted - expectedCash) * 100) / 100;

        const updated = await client.query(
          `UPDATE till_sessions
           SET status = 'closed',
               closing_cash = $1,
               expected_cash = $2,
               cash_difference = $3,
               closed_by = $4,
               closed_at = NOW()
           WHERE id = $5
           RETURNING id, company_id, store_id, terminal_id, opening_cash, closing_cash, expected_cash, cash_difference, status, opened_at, closed_at, closed_by`,
          [counted, expectedCash, cashDifference, req.user.id, s.id]
        );
        await client.query("COMMIT");
        res.json({
          success: true,
          message: "Till session closed",
          data: {
            ...updated.rows[0],
            cash_sales: salesTotal,
            cash_in_total: inTotal,
            cash_out_total: outTotal,
            cash_refunds: refundsTotal,
          },
        });
        } finally {
          client.release();
        }
      } catch (error) {
        await client?.query("ROLLBACK").catch(() => {});
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
      let clientTill = null;
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
        /* T-TILL: the session lookup, the overdraw guard and the insert run
         * in one row-locked transaction so a concurrent cash-out/close cannot
         * interleave between the balance check and the write. */
        const client = await pool.connect();
        clientTill = client;
        try {
        await client.query("BEGIN");
        const session = await client.query(
          "SELECT id, store_id, terminal_id FROM till_sessions WHERE id=$1 AND company_id=$2 AND store_id=$3 AND status='open' FOR UPDATE",
          [req.params.id, req.user.companyId, req.user.storeId]
        );
        if (!session.rows.length) {
          await client.query("ROLLBACK");
          return res
            .status(404)
            .json({ success: false, message: "Open till session not found" });
        }

        const required = type === "cash_in" ? "cash.adjustment" : "cash.payout";
        const codes = await getRolePermissionCodes(req.user.roleId);
        const isAdmin = await canViewCompanyCustomers(req.user);
        if (!isAdmin && !codes.includes(required)) {
          await client.query("ROLLBACK");
          return res
            .status(403)
            .json({ success: false, message: "You do not have permission to perform this action" });
        }

        /* T-TILL overdraw guard: a cash-out may not remove more cash than
         * the drawer can legitimately contain (opening + cash-in + cash
         * sales − cash-out − cash refunds). */
        if (type === "cash_out") {
          const position = await client.query(
            `SELECT
               (SELECT opening_cash FROM till_sessions WHERE id = $1) AS opening_cash,
               (SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE till_session_id=$1 AND type='cash_in') AS cash_in,
               (SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE till_session_id=$1 AND type='cash_out') AS cash_out,
               (SELECT COALESCE(SUM(s.total),0) FROM sales s
                 INNER JOIN payments pa ON pa.sale_id = s.id
                 INNER JOIN till_sessions ts ON ts.id = $1
                 WHERE s.company_id = ts.company_id AND s.store_id = ts.store_id
                   AND s.terminal_id = ts.terminal_id
                   AND pa.payment_method='cash' AND s.status='completed'
                   AND s.created_at BETWEEN ts.opened_at AND NOW()) AS cash_sales,
               (SELECT COALESCE(SUM(r.amount),0) FROM refunds r
                 INNER JOIN sales s ON s.id = r.sale_id
                 INNER JOIN till_sessions ts ON ts.id = $1
                 WHERE s.company_id = ts.company_id AND s.store_id = ts.store_id
                   AND s.terminal_id = ts.terminal_id
                   AND r.payment_method='cash'
                   AND r.created_at BETWEEN ts.opened_at AND NOW()) AS cash_refunds`,
            [session.rows[0].id]
          );
          const row = position.rows[0];
          const available = Math.round(
            ((Number(row.opening_cash) || 0) + (Number(row.cash_in) || 0) + (Number(row.cash_sales) || 0) -
              (Number(row.cash_out) || 0) - (Number(row.cash_refunds) || 0)) * 100
          ) / 100;
          if (value > available + 0.01) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: `Insufficient cash in drawer: ${available.toFixed(2)} available, cannot remove ${value.toFixed(2)}`,
            });
          }
        }

        const result = await client.query(
          `INSERT INTO cash_movements (till_session_id, user_id, type, amount, reason, store_id, terminal_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, till_session_id, user_id, type, amount, reason, store_id, terminal_id, created_at`,
          [session.rows[0].id, req.user.id, type, value, reason || null, session.rows[0].store_id, session.rows[0].terminal_id]
        );
        await client.query("COMMIT");
        res
          .status(201)
          .json({ success: true, message: "Cash movement recorded", data: result.rows[0] });
        } finally {
          client.release();
        }
      } catch (error) {
        await clientTill?.query("ROLLBACK").catch(() => {});
        console.error("Cash movement error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to record cash movement" });
      }
    }
  );

  /*
   * GET /api/till/sessions/active
   * T-TILL: the caller's own active session for THIS terminal (matched by
   * device identifier or the terminal the session was opened with). Distinct
   * from /sessions/current (store-wide, for supervisors) — this answers the
   * POS question "is MY till open?" and drives the Open Till modal.
   */
  router.get(
    "/till/sessions/active",
    authenticate,
    authorize("till.open"),
    async (req, res) => {
      try {
        /* The caller's terminal: matched by device identifier when the POS
         * sends one, else the store's first active terminal. */
        let terminalId = null;
        if (req.query.deviceIdentifier) {
          const t = await db(
            "SELECT id FROM terminals WHERE device_identifier = $1 AND store_id = $2 AND active = true",
            [req.query.deviceIdentifier, req.user.storeId]
          );
          if (t.rows.length) terminalId = t.rows[0].id;
        }
        if (!terminalId) {
          const t = await db(
            "SELECT id FROM terminals WHERE store_id = $1 AND active = true ORDER BY created_at LIMIT 1",
            [req.user.storeId]
          );
          terminalId = t.rows[0]?.id ?? null;
          if (!terminalId) return res.json({ success: true, data: null });
        }

        const result = await db(
          `SELECT ts.id, ts.company_id, ts.store_id, ts.terminal_id, ts.user_id,
                  t.terminal_number, u.username AS opened_by_name,
                  ts.opening_cash, ts.status, ts.opened_at,
                  COALESCE((SELECT SUM(amount) FROM cash_movements cm WHERE cm.till_session_id = ts.id AND cm.type='cash_in'), 0) AS cash_in_total,
                  COALESCE((SELECT SUM(amount) FROM cash_movements cm WHERE cm.till_session_id = ts.id AND cm.type='cash_out'), 0) AS cash_out_total,
                  (
                    SELECT COALESCE(SUM(s.total), 0)
                    FROM sales s
                    INNER JOIN payments pa ON pa.sale_id = s.id
                    WHERE s.company_id = ts.company_id AND s.store_id = ts.store_id
                      AND s.terminal_id = ts.terminal_id
                      AND pa.payment_method='cash' AND s.status='completed'
                      AND s.created_at BETWEEN ts.opened_at AND NOW()
                  ) AS cash_sales_total,
                  (
                    SELECT COALESCE(SUM(r.amount), 0)
                    FROM refunds r
                    INNER JOIN sales s ON s.id = r.sale_id
                    WHERE s.company_id = ts.company_id AND s.store_id = ts.store_id
                      AND s.terminal_id = ts.terminal_id
                      AND r.payment_method='cash'
                      AND r.created_at BETWEEN ts.opened_at AND NOW()
                  ) AS cash_refunds_total
           FROM till_sessions ts
           INNER JOIN terminals t ON t.id = ts.terminal_id
           LEFT JOIN users u ON u.id = ts.user_id
           WHERE ts.terminal_id = $1 AND ts.status = 'open'
           ORDER BY ts.opened_at DESC
           LIMIT 1`,
          [terminalId]
        );
        if (!result.rows.length) return res.json({ success: true, data: null });
        const row = result.rows[0];
        const currentCash = Math.round(
          ((Number(row.opening_cash) || 0) + (Number(row.cash_in_total) || 0) + (Number(row.cash_sales_total) || 0) -
            (Number(row.cash_out_total) || 0) - (Number(row.cash_refunds_total) || 0)) * 100
        ) / 100;
        res.json({
          success: true,
          data: {
            id: row.id, companyId: row.company_id, storeId: row.store_id, terminalId: row.terminal_id,
            terminalNumber: row.terminal_number, openedBy: row.opened_by_name, openedAt: row.opened_at,
            openingCash: Number(row.opening_cash) || 0, currentCash,
            cashInTotal: Number(row.cash_in_total) || 0, cashOutTotal: Number(row.cash_out_total) || 0,
            cashSalesTotal: Number(row.cash_sales_total) || 0, cashRefundsTotal: Number(row.cash_refunds_total) || 0,
            status: row.status,
          },
        });
      } catch (error) {
        console.error("Load active till session error:", error);
        res.status(500).json({ success: false, message: "Unable to load active till session" });
      }
    }
  );

  /*
   * POST /api/till/drawer/open
   * T-TILL software drawer control: records a drawer-open event (audit) and
   * returns an ack for the POS to trigger the local hardware kick it already
   * owns. Permission: cash.open_drawer (admin bypass per authorize()).
   */
  router.post(
    "/till/drawer/open",
    authenticate,
    authorize("cash.open_drawer"),
    async (req, res) => {
      try {
        const reason = req.body?.reason ? String(req.body.reason).slice(0, 255) : null;
        let terminalId = req.body?.terminalId ?? null;
        if (terminalId) {
          const t = await db(
            "SELECT id FROM terminals WHERE id = $1 AND store_id = $2 AND active = true",
            [terminalId, req.user.storeId]
          );
          if (!t.rows.length) {
            return res.status(400).json({
              success: false,
              message: "Requested till does not belong to this store",
            });
          }
        } else {
          const t = await db(
            "SELECT id FROM terminals WHERE store_id = $1 AND active = true ORDER BY created_at LIMIT 1",
            [req.user.storeId]
          );
          terminalId = t.rows[0]?.id ?? null;
          if (!terminalId) {
            return res.status(400).json({ success: false, message: "No active till configured for this store" });
          }
        }

        /* No open session needed for a no-sale drawer opening, but when one
         * exists the event is attributed to it. */
        const session = await db(
          "SELECT id FROM till_sessions WHERE terminal_id = $1 AND status = 'open' LIMIT 1",
          [terminalId]
        );

        await db(
          `INSERT INTO cash_movements (till_session_id, user_id, type, amount, reason, store_id, terminal_id)
           VALUES ($1, $2, 'drawer_open', $3, $4, $5, $6)`,
          [session.rows[0]?.id ?? null, req.user.id, 0, reason, req.user.storeId, terminalId]
        );
        res.json({
          success: true,
          message: "Drawer open recorded",
          data: { terminalId, sessionId: session.rows[0]?.id ?? null, reason },
        });
      } catch (error) {
        console.error("Open drawer error:", error);
        res.status(500).json({ success: false, message: "Unable to open drawer" });
      }
    }
  );

  return router;
}
