import express from "express";
import {
  toCents,
  fromCents,
  checkCreditLimit,
  checkPayment,
  buildPaymentTransaction,
  buildAdjustmentTransaction,
  generateStatement,
} from "../services/customerCredit.js";
import {
  validateIssueValue,
  validateTopUp,
  normaliseGiftCardCode,
  codeLookupClause,
} from "../services/giftCards.js";

export default function createCustomersRouter({
  authenticate,
  authorize,
  db: domainDb,
  pool,
  savePlatformRecord = null,
  canViewCompanyCustomers,
  associateCustomerWithStore,
  requireLoyaltyEntitlement = (_req, _res, next) => next(),
  /*
   * Administrative GATE for customer administration: Admin/Owner roles AND a
   * Platform Superadmin. Deliberately separate from canViewCompanyCustomers,
   * which also drives DATA SCOPE (company-wide vs store-restricted reads) —
   * widening that helper would silently change query scope.
   *
   * Defaults to the company-admin check alone, so existing callers and tests
   * keep exactly today's behaviour.
   */
  hasCompanyAdminAccess = async (req) => canViewCompanyCustomers(req.user),
}) {
  const router = express.Router();
  const db = domainDb;

  const parseCsv = (csv) => {
    const lines = String(csv || "").split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = lines.shift().split(",").map((header) => header.trim());
    return lines.map((line) => {
      const values = line.split(",");
      return headers.reduce((row, header, index) => ({ ...row, [header]: (values[index] || "").trim() }), {});
    });
  };

  /*
   * GET /api/customers
   */
  router.get("/customers", authenticate, authorize("customer.view"), async (req, res) => {
    try {
      const companyScope =
        req.query.scope === "company" && (await canViewCompanyCustomers(req.user));
      const params = [req.user.companyId];
      const filters = ["c.company_id = $1"];

      if (!companyScope) {
        params.push(req.user.storeId);
        filters.push(`cs.store_id = $${params.length}`);
        filters.push("cs.active = true");
      }

      if (req.query.active !== undefined) {
        params.push(req.query.active !== "false");
        filters.push(`c.active = $${params.length}`);
      }

      if (req.query.search) {
        params.push(`%${String(req.query.search).trim()}%`);
        filters.push(
          `(c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.email ILIKE $${params.length})`
        );
      }

      const result = await db(
        `
        SELECT c.id, c.company_id, c.name, c.phone, c.email, c.address, c.postcode,
          c.loyalty_number, c.notes, c.active, c.created_at, c.updated_at,
          COALESCE(clb.balance, 0) AS loyalty_balance,
          c.credit_enabled,
          c.credit_limit,
          COALESCE(ccl.outstanding, 0) AS credit_balance,
          MAX(cs.last_purchase_at) AS last_purchase_at,
          STRING_AGG(DISTINCT st.name, ', ' ORDER BY st.name) AS store_names
        FROM customers c
        ${
          companyScope
            ? "LEFT JOIN customer_stores cs ON cs.customer_id = c.id"
            : "INNER JOIN customer_stores cs ON cs.customer_id = c.id"
        }
        LEFT JOIN stores st ON st.id = cs.store_id
        LEFT JOIN customer_loyalty_balances clb ON clb.company_id = c.company_id AND clb.customer_id = c.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(l.amount * CASE WHEN l.transaction_type IN ('payment','debit_note') THEN -1 ELSE 1 END), 0) AS outstanding
          FROM customer_credit_ledger l
          WHERE l.company_id = c.company_id AND l.customer_id = c.id
        ) ccl ON TRUE
        WHERE ${filters.join(" AND ")}
        GROUP BY c.id, clb.balance, c.credit_enabled, c.credit_limit, ccl.outstanding
        ORDER BY c.name
        `,
        params
      );

      const enriched = result.rows.map((r) => ({
        ...r,
        credit: {
          enabled: !!r.credit_enabled,
          limit: Number(r.credit_limit) || 0,
          balance: Number(r.credit_balance) || 0,
          available: Math.max(0, (Number(r.credit_limit) || 0) - (Number(r.credit_balance) || 0)),
        },
      }));

      res.json({
        success: true,
        data: enriched,
        scope: companyScope ? "company" : "store",
      });
    } catch (error) {
      console.error("Load customers error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to load customers" });
    }
  });

  /*
   * GET /api/customer-lookup
   */
  router.get("/customer-lookup", authenticate, authorize("customer.view"), async (req, res) => {
    const query = String(req.query.search || "").trim();
    if (!query) return res.json({ success: true, data: [] });

    try {
      const result = await db(
        `
        SELECT c.id, c.name, c.phone, c.email, c.active,
          EXISTS (
            SELECT 1 FROM customer_stores cs
            WHERE cs.customer_id = c.id AND cs.store_id = $2 AND cs.active = true
          ) AS associated
        FROM customers c
        WHERE c.company_id = $1
          AND c.active = true
          AND (c.name ILIKE $3 OR c.phone ILIKE $3 OR c.email ILIKE $3)
        ORDER BY c.name
        LIMIT 25
        `,
        [req.user.companyId, req.user.storeId, `%${query}%`]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Customer lookup error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to search customers" });
    }
  });

  // These collection routes must precede the parameterised customer detail route.
  router.get("/customers/export", authenticate, authorize("customer.view"), async (req, res) => {
    const result = await db(
      `SELECT c.name, c.phone, c.email, c.address, c.postcode, c.notes,
        c.credit_enabled, c.credit_limit, COALESCE(clb.balance, 0) AS loyalty_balance
       FROM customers c
       LEFT JOIN customer_loyalty_balances clb ON clb.customer_id = c.id AND clb.company_id = c.company_id
       WHERE c.company_id = $1 ORDER BY c.name`,
      [req.user.companyId]
    );
    const headers = ["name", "phone", "email", "address", "postcode", "notes", "credit_enabled", "credit_limit", "loyalty_balance"];
    res.type("text/csv").send([headers.join(","), ...result.rows.map((row) => headers.map((header) => String(row[header] ?? "").replaceAll(",", " ")).join(","))].join("\n"));
  });

  router.post("/customers/import/preview", authenticate, authorize("customer.edit"), async (req, res) => {
    const sourceRows = parseCsv(req.body.csv);
    const existing = await db(`SELECT id, name, phone, email, credit_enabled, credit_limit FROM customers WHERE company_id = $1 AND active = true`, [req.user.companyId]);
    const rows = sourceRows.map((row, index) => {
      const match = existing.rows.find((customer) => (row.email && customer.email === row.email) || (row.phone && customer.phone === row.phone));
      const invalid = !row.name || (row.phone && !/^\+?\d{7,15}$/.test(row.phone)) || (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email));
      return { row: index + 2, ...row, valid: !invalid, action: invalid ? "invalid" : match ? "update" : "create", matchCustomer: match ? { id: match.id, name: match.name } : null, errors: !row.name ? ["Name is required"] : invalid ? ["Invalid email or phone"] : [] };
    });
    res.json({ success: true, data: { total: rows.length, creates: rows.filter((row) => row.action === "create").length, updates: rows.filter((row) => row.action === "update").length, invalid: rows.filter((row) => row.action === "invalid").length, rows } });
  });

  router.post("/customers/import", authenticate, authorize("customer.edit"), async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.some((row) => row.valid === false || row.action === "invalid")) return res.status(422).json({ success: false, message: "Import contains invalid rows" });
    for (const row of rows.filter((item) => item.action === "update")) {
      const check = await db(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [row.matchCustomer?.id, req.user.companyId]);
      if (!check.rows.length) return res.status(400).json({ success: false, message: "Import customer does not belong to this company" });
    }
    let created = 0;
    let updated = 0;
    for (const row of rows) {
      if (row.action === "update") {
        await db(`UPDATE customers SET name = COALESCE($1, name), phone = COALESCE($2, phone), email = COALESCE($3, email), address = COALESCE($4, address), postcode = COALESCE($5, postcode), notes = COALESCE($6, notes), credit_enabled = COALESCE($7, credit_enabled), credit_limit = COALESCE($8, credit_limit) WHERE id = $9 AND company_id = $10 RETURNING id, name, phone, email`, [row.name, row.phone, row.email, row.address, row.postcode, row.notes, row.creditEnabled, row.creditLimit, row.matchCustomer.id, req.user.companyId]);
        updated += 1;
      } else {
        await db(`INSERT INTO customers (company_id, name, phone, email, address, postcode, notes, credit_enabled, credit_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, name, phone, email`, [req.user.companyId, row.name, row.phone, row.email, row.address, row.postcode, row.notes, row.creditEnabled ?? false, row.creditLimit]);
        created += 1;
      }
    }
    res.json({ success: true, data: { created, updated } });
  });

  /*
   * GET /api/customers/:id
   */
  router.get("/customers/:id", authenticate, authorize("customer.view"), async (req, res) => {
    try {
      const companyAdmin = await canViewCompanyCustomers(req.user);
      const result = await db(
        `
        SELECT c.id, c.company_id, c.name, c.phone, c.email, c.address, c.postcode,
          c.loyalty_number, c.notes, c.active, c.created_at, c.updated_at,
          COALESCE(clb.balance, 0) AS loyalty_balance,
          c.credit_enabled, c.credit_limit,
          COALESCE(ccl.outstanding, 0) AS credit_balance,
          COALESCE(json_agg(json_build_object(
            'storeId', cs.store_id,
            'storeName', st.name,
            'active', cs.active,
            'lastPurchaseAt', cs.last_purchase_at
          ) ORDER BY cs.store_id) FILTER (WHERE cs.id IS NOT NULL), '[]') AS stores
        FROM customers c
        LEFT JOIN customer_stores cs ON cs.customer_id = c.id
        LEFT JOIN stores st ON st.id = cs.store_id
        LEFT JOIN customer_loyalty_balances clb ON clb.company_id = c.company_id AND clb.customer_id = c.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(l.amount * CASE WHEN l.transaction_type IN ('payment','debit_note') THEN -1 ELSE 1 END), 0) AS outstanding
          FROM customer_credit_ledger l
          WHERE l.company_id = c.company_id AND l.customer_id = c.id
        ) ccl ON TRUE
        WHERE c.id = $1 AND c.company_id = $2
        GROUP BY c.id, clb.balance, c.credit_enabled, c.credit_limit, ccl.outstanding
        `,
        [req.params.id, req.user.companyId]
      );
      if (!result.rows.length)
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });

      if (!companyAdmin) {
        const visible = await db(
          `SELECT 1 FROM customer_stores WHERE customer_id = $1 AND store_id = $2 AND active = true`,
          [req.params.id, req.user.storeId]
        );
        if (!visible.rows.length)
          return res
            .status(404)
            .json({ success: false, message: "Customer not found" });
      }
      const sales = await db(
        `
        SELECT s.id, s.receipt_number, s.store_id, st.name AS store_name,
          s.total, s.status, s.created_at,
          COALESCE(
            (SELECT p.payment_method
             FROM payments p
             WHERE p.sale_id = s.id AND p.status = 'completed'
             ORDER BY p.created_at DESC
             LIMIT 1),
            NULL
          ) AS payment_method
        FROM sales s
        LEFT JOIN stores st ON st.id = s.store_id
        WHERE s.customer_id = $1
          AND s.company_id = $2
          AND NOT (s.offline_created = true AND s.sync_status <> 'synced')
        ORDER BY s.created_at DESC
        LIMIT 100
        `,
        [req.params.id, req.user.companyId]
      );

      const credit = {
        enabled: !!result.rows[0].credit_enabled,
        limit: Number(result.rows[0].credit_limit) || 0,
        balance: Number(result.rows[0].credit_balance) || 0,
      };
      credit.available = Math.max(0, credit.limit - credit.balance);

      res.json({
        success: true,
        data: { ...result.rows[0], sales: sales.rows, credit },
      });
    } catch (error) {
      console.error("Get customer error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to load customer" });
    }
  });

  /*
   * GET /api/customers/:id/loyalty
   * Returns customer loyalty balance and transaction history
   */
  router.get("/customers/:id/loyalty", authenticate, requireLoyaltyEntitlement, authorize("customer.view"), async (req, res) => {
    try {
      const companyAdmin = await canViewCompanyCustomers(req.user);

      // Verify customer belongs to user's company
      const customerCheck = await db(
        `SELECT id, name FROM customers WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.user.companyId]
      );

      if (!customerCheck.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      // Check store access for non-admin users
      if (!companyAdmin) {
        const visible = await db(
          `SELECT 1 FROM customer_stores WHERE customer_id = $1 AND store_id = $2 AND active = true`,
          [req.params.id, req.user.storeId]
        );
        if (!visible.rows.length)
          return res.status(404).json({
            success: false,
            message: "Customer not found",
          });
      }

      // Get loyalty balance
      const balanceResult = await db(
        `SELECT COALESCE(balance, 0) AS balance FROM customer_loyalty_balances WHERE company_id = $1 AND customer_id = $2`,
        [req.user.companyId, req.params.id]
      );

      // Get loyalty transactions
      const transactionsResult = await db(
        `
        SELECT
          clt.id,
          clt.transaction_type,
          clt.amount,
          clt.balance_after,
          clt.reference_type,
          clt.reference_id,
          clt.description,
          clt.created_at,
          u.username,
          u.full_name
        FROM customer_loyalty_transactions clt
        LEFT JOIN users u ON u.id = clt.created_by
        WHERE clt.company_id = $1 AND clt.customer_id = $2
        ORDER BY clt.created_at DESC
        LIMIT 100
        `,
        [req.user.companyId, req.params.id]
      );

      res.json({
        success: true,
        data: {
          customerId: req.params.id,
          customerName: customerCheck.rows[0].name,
          balance: Number(balanceResult.rows[0]?.balance || 0),
          transactions: transactionsResult.rows,
        },
      });
    } catch (error) {
      console.error("Get customer loyalty error:", error);
      res.status(500).json({
        success: false,
        message: "Unable to load customer loyalty",
      });
    }
  });

  /*
   * POST /api/customers/:id/loyalty/adjust  (T10R)
   * Authorised manual/admin loyalty point adjustment.
   *
   * Body: { points: number, reason?: string, referenceId?: UUID (sale/invoice) }
   * - points > 0: credit; points < 0: debit (balance can never go below 0)
   * - permission: loyalty.adjust (managers/admins), falls back to customer.edit
   * - writes a ledger row + an adjustments audit row; both company-scoped
   */
  router.post("/customers/:id/loyalty/adjust", authenticate, requireLoyaltyEntitlement, authorize("loyalty.adjust", "customer.edit"), async (req, res) => {
    try {
      const companyAdmin = await canViewCompanyCustomers(req.user);

      // Verify customer belongs to user's company
      const customerCheck = await db(
        `SELECT id FROM customers WHERE id = $1 AND company_id = $2`,
        [req.params.id, req.user.companyId]
      );

      if (!customerCheck.rows.length) {
        return res.status(404).json({
          success: false,
          message: "Customer not found",
        });
      }

      // Store access for non-admin users mirrors the loyalty GET route
      if (!companyAdmin) {
        const visible = await db(
          `SELECT 1 FROM customer_stores WHERE customer_id = $1 AND store_id = $2 AND active = true`,
          [req.params.id, req.user.storeId]
        );
        if (!visible.rows.length)
          return res.status(404).json({
            success: false,
            message: "Customer not found",
          });
      }

      const points = Number(req.body.points);
      const reason = req.body.reason ? String(req.body.reason).slice(0, 500) : null;
      const referenceId = req.body.referenceId ? String(req.body.referenceId) : null;

      if (!Number.isFinite(points) || points === 0) {
        return res.status(400).json({ success: false, message: "A non-zero points amount is required" });
      }
      const pointsNorm = Math.round(points * 10000) / 10000; // 4dp like the ledger
      if (referenceId && !/^[0-9a-fA-F-]{36}$/.test(referenceId)) {
        return res.status(400).json({ success: false, message: "referenceId must be a UUID" });
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Read the current balance under a row lock so concurrent
        // adjustments serialise and no reader sees an intermediate value.
        const currentRes = await client.query(
          `SELECT COALESCE(balance, 0) AS balance FROM customer_loyalty_balances WHERE company_id = $1 AND customer_id = $2 FOR UPDATE`,
          [req.user.companyId, req.params.id]
        );
        const currentBalance = Number(currentRes.rows[0]?.balance || 0);

        const newBalance = currentBalance + pointsNorm;
        if (newBalance < 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: `Insufficient points: balance is ${currentBalance}, adjustment of ${pointsNorm} would go negative`,
          });
        }

        // Upsert to the new balance (inserts on first-ever adjustment)
        await client.query(
          `
          INSERT INTO customer_loyalty_balances (company_id, customer_id, balance)
          VALUES ($1, $2, $3)
          ON CONFLICT (company_id, customer_id) DO UPDATE SET balance = $3
          `,
          [req.user.companyId, req.params.id, newBalance]
        );

        // Ledger row: the audit trail. reference_type is 'sale' when the
        // adjustment references a sale/invoice, otherwise 'adjustment'.
        await client.query(
          `
          INSERT INTO customer_loyalty_transactions
            (company_id, customer_id, transaction_type, amount, balance_after, reference_type, description, created_by)
          VALUES ($1, $2, 'ADJUST', $3, $4, $5, $6, $7)
          `,
          [
            req.user.companyId,
            req.params.id,
            pointsNorm,
            newBalance,
            referenceId ? "sale" : "adjustment",
            reason || (pointsNorm > 0 ? "Manual points adjustment (credit)" : "Manual points adjustment (debit)"),
            req.user.id,
          ]
        );

        await client.query(
          `
          INSERT INTO customer_loyalty_adjustments
            (company_id, customer_id, points, reason, reference_id, created_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [req.user.companyId, req.params.id, pointsNorm, reason, referenceId, req.user.id]
        );

        await client.query("COMMIT");

        res.json({
          success: true,
          message: "Loyalty points adjusted",
          data: {
            customerId: req.params.id,
            points: pointsNorm,
            balance: newBalance,
          },
        });
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Adjust customer loyalty error:", error);
      res.status(500).json({
        success: false,
        message: "Unable to adjust customer loyalty",
      });
    }
  });

  /*
   * POST /api/customers
   */
  router.post("/customers", authenticate, authorize("customer.create"), async (req, res) => {
    const { name, phone = null, email = null, address = null, postcode = null, notes = null, storeId = null } = req.body;
    const companyAdmin = await canViewCompanyCustomers(req.user);
    const targetStoreId = companyAdmin && storeId ? storeId : req.user.storeId;
    if (!name || !String(name).trim())
      return res
        .status(400)
        .json({ success: false, message: "Customer name is required" });
    if (!pool)
      return res
        .status(500)
        .json({ success: false, message: "DATABASE_URL is not configured" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const identifiers = [phone, email].filter(
        (value) => value && String(value).trim()
      );
      const matches = identifiers.length
        ? await client.query(
            `SELECT id, name, phone, email FROM customers WHERE company_id = $1 AND (phone = ANY($2::text[]) OR LOWER(email) = ANY($3::text[])) AND active = true`,
            [
              req.user.companyId,
              identifiers.map((value) => String(value).trim()),
              identifiers.map((value) => String(value).trim().toLowerCase()),
            ]
          )
        : { rows: [] };

      const ids = [...new Set(matches.rows.map((customer) => customer.id))];
      if (ids.length > 1) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({
            success: false,
            message:
              "Customer identifiers match multiple customers; no merge was performed",
          });
      }

      let customer;
      if (ids.length === 1) {
        customer = matches.rows[0];
      } else {
        const created = await client.query(
          `INSERT INTO customers (company_id, name, phone, email, address, postcode, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, phone, email, address, postcode, notes, active, created_at, updated_at`,
          [
            req.user.companyId,
            String(name).trim(),
            phone || null,
            email || null,
            address || null,
            postcode || null,
            notes || null,
          ]
        );
        customer = created.rows[0];
      }

      const association = await associateCustomerWithStore(
        client,
        customer.id,
        targetStoreId,
        req.user.companyId
      );
      if (savePlatformRecord && !ids.length) customer.platform = await savePlatformRecord({ db: client.query.bind(client), key: "customer", req, record: customer });
      await client.query("COMMIT");
      res
        .status(ids.length ? 200 : 201)
        .json({
          success: true,
          message: ids.length
            ? "Customer associated with store"
            : "Customer created",
          data: { customer, association },
        });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "PLATFORM_RECORD_INVALID") return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      console.error("Create customer error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to create customer" });
    } finally {
      client.release();
    }
  });

  /*
   * POST /api/customers/:id/associate
   */
  router.post("/customers/:id/associate", authenticate, authorize("customer.edit"), async (req, res) => {
    const companyAdmin = await canViewCompanyCustomers(req.user);
    const targetStoreId =
      companyAdmin && req.body.storeId ? req.body.storeId : req.user.storeId;
    if (!pool)
      return res
        .status(500)
        .json({ success: false, message: "DATABASE_URL is not configured" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const association = await associateCustomerWithStore(
        client,
        req.params.id,
        targetStoreId,
        req.user.companyId
      );
      await client.query("COMMIT");
      res.json({
        success: true,
        message: "Customer associated with store",
        data: association,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      res
        .status(
          error.message === "Customer not found" ||
            error.message === "Store not found"
            ? 404
            : 400
        )
        .json({ success: false, message: error.message });
    } finally {
      client.release();
    }
  });

  /*
   * PUT /api/customers/:id
   */
  router.put("/customers/:id", authenticate, authorize("customer.edit"), async (req, res) => {
    if (!(await hasCompanyAdminAccess(req)))
      return res
        .status(403)
        .json({ success: false, message: "Customer administration permission required" });
    const { name, phone = null, email = null, address = null, postcode = null, notes = null } = req.body;
    if (!name || !String(name).trim())
      return res
        .status(400)
        .json({ success: false, message: "Customer name is required" });

    let client = null;
    let committed = false;
    const db = (...args) => client ? client.query(...args) : domainDb(...args);
    try {
      let previous = null;
      if (savePlatformRecord) {
        client = await pool.connect(); await client.query("BEGIN");
        previous = (await db("SELECT * FROM customers WHERE id=$1 AND company_id=$2 FOR UPDATE", [req.params.id, req.user.companyId])).rows[0];
        if (!previous) return res.status(404).json({ success: false, message: "Customer not found" });
      }
      const result = await db(
        `
        UPDATE customers
        SET name=$1, phone=$2, email=$3, address=$4, postcode=$5, notes=$6, updated_at=NOW()
        WHERE id=$7 AND company_id=$8
        RETURNING id, company_id, name, phone, email, address, postcode, notes, active, created_at, updated_at
        `,
        [
          String(name).trim(),
          phone || null,
          email || null,
          address || null,
          postcode || null,
          notes || null,
          req.params.id,
          req.user.companyId,
        ]
      );
      if (!result.rows.length)
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      if (savePlatformRecord) {
        result.rows[0].platform = await savePlatformRecord({ db, key: "customer", req, record: { ...previous, ...result.rows[0] }, previous });
        await client.query("COMMIT"); committed = true;
      }
      res.json({ success: true, message: "Customer updated", data: result.rows[0] });
    } catch (error) {
      if (error.code === "PLATFORM_RECORD_INVALID") return res.status(error.status).json({ success: false, code: error.code, message: error.message });
      console.error("Update customer error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to update customer" });
    } finally {
      if (client) { try { if (!committed) await client.query("ROLLBACK"); } finally { client.release(); } }
    }
  });

  /*
   * PATCH /api/customers/:id/status
   */
  router.patch("/customers/:id/status", authenticate, authorize("customer.edit"), async (req, res) => {
    if (!(await hasCompanyAdminAccess(req)))
      return res
        .status(403)
        .json({ success: false, message: "Customer administration permission required" });
    if (typeof req.body.active !== "boolean")
      return res
        .status(400)
        .json({ success: false, message: "Customer active status is required" });
    try {
      const result = await db(
        `UPDATE customers SET active=$1, updated_at=NOW() WHERE id=$2 AND company_id=$3 RETURNING id, name, active`,
        [req.body.active, req.params.id, req.user.companyId]
      );
      if (!result.rows.length)
        return res
          .status(404)
          .json({ success: false, message: "Customer not found" });
      res.json({
        success: true,
        message: req.body.active ? "Customer activated" : "Customer deactivated",
        data: result.rows[0],
      });
    } catch (error) {
      console.error("Customer status error:", error);
      res
        .status(500)
        .json({ success: false, message: "Unable to update customer status" });
    }
  });

  /*
   * ============================== T10Y — CUSTOMER CREDIT ==============================
   * All handlers enforce company isolation; store scoping mirrors the existing
   * canViewCompanyCustomers / customer_stores model used above.
   */

  /** Sum of the customer's signed ledger amounts, in minor units (pence).
   *  The ledger stores NUMERIC(12,2) MAJOR units; ×100 here so all route
   *  math (checkPayment, available credit) runs in integer pence. */
  async function outstandingCents(companyId, customerId) {
    const r = await db(
      `SELECT COALESCE(SUM(amount * CASE WHEN transaction_type IN ('payment','debit_note') THEN -1 ELSE 1 END), 0) AS outstanding
       FROM customer_credit_ledger WHERE company_id = $1 AND customer_id = $2`,
      [companyId, customerId]
    );
    return Math.round(Number(r.rows[0]?.outstanding || 0) * 100);
  }

  /** Shared guard: customer must exist in the caller's company (and, for
   *  non-company admins, be linked to the caller's store). */
  async function loadCustomerForCredit(req, res, { needAdmin = false } = {}) {
    const companyAdmin = await canViewCompanyCustomers(req.user);
    const result = await db(
      `SELECT id, name, company_id, credit_enabled, credit_limit FROM customers WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.user.companyId]
    );
    const customer = result.rows[0];
    if (!customer) {
      res.status(404).json({ success: false, message: "Customer not found" });
      return null;
    }
    if (!companyAdmin) {
      const visible = await db(
        `SELECT 1 FROM customer_stores WHERE customer_id = $1 AND store_id = $2 AND active = true`,
        [req.params.id, req.user.storeId]
      );
      if (!visible.rows.length) {
        res.status(404).json({ success: false, message: "Customer not found" });
        return null;
      }
    }
    if (needAdmin && !companyAdmin) {
      res.status(403).json({ success: false, message: "Company administration permission required" });
      return null;
    }
    const ageResult = await db(
      "SELECT maximum_credit_age_days FROM customers WHERE id = $1 AND company_id = $2",
      [req.params.id, req.user.companyId]
    );
    customer.maximum_credit_age_days = ageResult.rows[0]?.maximum_credit_age_days ?? null;
    return customer;
  }

  /*
   * GET /api/customers/:id/credit — credit summary + recent ledger entries.
   */
  router.get("/customers/:id/credit", authenticate, authorize("customer.view"), async (req, res) => {
    try {
      const customer = await loadCustomerForCredit(req, res);
      if (!customer) return;

      const ledger = await db(
        `
        SELECT l.id, l.transaction_type, l.amount, l.balance_after, l.reference_type,
          l.reference_id, l.description, l.created_by, u.full_name AS created_by_name, l.created_at
        FROM customer_credit_ledger l
        LEFT JOIN users u ON u.id = l.created_by
        WHERE l.company_id = $1 AND l.customer_id = $2
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 25
        `,
        [req.user.companyId, req.params.id]
      );

      const balanceC = await outstandingCents(req.user.companyId, req.params.id);
      const credit = {
        enabled: !!customer.credit_enabled,
        limit: Number(customer.credit_limit) || 0,
        maximumAgeDays: customer.maximum_credit_age_days == null ? null : Number(customer.maximum_credit_age_days),
        balance: fromCents(balanceC),
        available: Math.max(0, (Number(customer.credit_limit) || 0) - fromCents(balanceC)),
      };

      res.json({ success: true, data: { customer: { id: customer.id, name: customer.name }, credit, ledger: ledger.rows } });
    } catch (error) {
      console.error("Customer credit summary error:", error);
      res.status(500).json({ success: false, message: "Unable to load customer credit" });
    }
  });

  /*
   * PUT /api/customers/:id/credit — enable/disable credit + set limit (company admin only).
   */
  router.put("/customers/:id/credit", authenticate, authorize("customer.edit"), async (req, res) => {
    try {
      const customer = await loadCustomerForCredit(req, res, { needAdmin: true });
      if (!customer) return;

      const enabled = req.body.enabled === true;
      let limitMajor = null;
      if (req.body.limit !== undefined && req.body.limit !== null && req.body.limit !== "") {
        const n = Number(req.body.limit);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ success: false, message: "Credit limit must be a non-negative amount" });
        }
        limitMajor = Math.round(n * 100) / 100;
      }
      if (limitMajor === null) {
        limitMajor = Number(customer.credit_limit) || 0;
      }
      let maximumAgeDays = customer.maximum_credit_age_days == null ? null : Number(customer.maximum_credit_age_days);
      if (req.body.maximumAgeDays !== undefined && req.body.maximumAgeDays !== null && req.body.maximumAgeDays !== "") {
        maximumAgeDays = Number(req.body.maximumAgeDays);
        if (!Number.isInteger(maximumAgeDays) || maximumAgeDays < 0) {
          return res.status(400).json({ success: false, message: "Maximum credit age must be a non-negative whole number of days" });
        }
      }

      const result = await db(
        `UPDATE customers SET credit_enabled = $1, credit_limit = $2, updated_at = NOW() WHERE id = $3 AND company_id = $4 RETURNING credit_enabled, credit_limit`,
        [enabled, limitMajor, req.params.id, req.user.companyId]
      );
      if (!result.rows.length)
        return res.status(404).json({ success: false, message: "Customer not found" });
      await db(
        "UPDATE customers SET maximum_credit_age_days = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3",
        [maximumAgeDays, req.params.id, req.user.companyId]
      );

      res.json({
        success: true,
        message: enabled ? "Customer credit enabled" : "Customer credit disabled",
        data: {
          enabled: !!result.rows[0].credit_enabled,
          limit: Number(result.rows[0].credit_limit) || 0,
          maximumAgeDays: maximumAgeDays == null ? null : Number(maximumAgeDays),
        },
      });
    } catch (error) {
      console.error("Customer credit config error:", error);
      res.status(500).json({ success: false, message: "Unable to update customer credit" });
    }
  });

  /*
   * POST /api/customers/:id/credit/payments — record a payment against credit.
   */
  router.post("/customers/:id/credit/payments", authenticate, authorize("payment.manage", "customer.edit"), async (req, res) => {
    try {
      const customer = await loadCustomerForCredit(req, res);
      if (!customer) return;
      if (!customer.credit_enabled)
        return res.status(409).json({ success: false, message: "Customer credit is not enabled" });

      const cents = toCents(req.body.amount);
      if (!Number.isFinite(Number(req.body.amount)) || cents <= 0)
        return res.status(400).json({ success: false, message: "Payment amount must be greater than zero" });

      const method = String(req.body.method || "cash").trim().toLowerCase();
      const allowed = ["cash", "card", "bank_transfer", "other"];
      if (!allowed.includes(method))
        return res.status(400).json({ success: false, message: "Invalid payment method" });

      const outstanding = await outstandingCents(req.user.companyId, req.params.id);
      /* Service contract: checkPayment(currentBalanceCents, paymentAmountCents). */
      const check = checkPayment(outstanding, cents);
      if (!check.allowed)
        return res.status(409).json({ success: false, message: "Payment exceeds the outstanding balance" });

      const idempotencyKey = req.body.idempotencyKey
        ? String(req.body.idempotencyKey).trim().slice(0, 120)
        : null;
      if (idempotencyKey) {
        const existing = await db(
          `SELECT id, amount, payment_method FROM customer_credit_ledger
           WHERE company_id = $1 AND idempotency_key = $2 LIMIT 1`,
          [req.user.companyId, idempotencyKey]
        );
        if (existing.rows.length) {
          return res.status(409).json({
            success: false,
            message: "Customer payment has already been processed",
            data: { entryId: existing.rows[0].id, duplicate: true },
          });
        }
      }

      const tx = buildPaymentTransaction({
        amount: req.body.amount,
        paymentMethod: method,
        userId: req.user.id || req.user.userId || null,
      });

      const inserted = await db(
        `
        INSERT INTO customer_credit_ledger
          (company_id, store_id, customer_id, transaction_type, amount, reference_type, reference_id, description, payment_method, idempotency_key, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id, created_at
        `,
        [
          req.user.companyId,
          req.user.storeId || null,
          req.params.id,
          tx.transaction_type,
          tx.amount,
          tx.reference_type,
          req.body.referenceId || null,
          tx.description,
          tx.payment_method,
          idempotencyKey,
          tx.created_by,
        ]
      );

      res.status(201).json({
        success: true,
        message: "Payment recorded",
        data: {
          entryId: inserted.rows[0].id,
          amount: fromCents(cents),
          method,
          balance: fromCents(outstanding - cents),
        },
      });
    } catch (error) {
      console.error("Customer credit payment error:", error);
      res.status(500).json({ success: false, message: "Unable to record payment" });
    }
  });

  /*
   * POST /api/customers/:id/credit/adjustments — manual debit/credit note.
   */
  router.post("/customers/:id/credit/adjustments", authenticate, authorize("customer.edit"), async (req, res) => {
    try {
      const customer = await loadCustomerForCredit(req, res, { needAdmin: true });
      if (!customer) return;
      if (!customer.credit_enabled)
        return res.status(409).json({ success: false, message: "Customer credit is not enabled" });

      const cents = toCents(req.body.amount);
      if (!Number.isFinite(Number(req.body.amount)) || cents <= 0)
        return res.status(400).json({ success: false, message: "Adjustment amount must be greater than zero" });

      const type = req.body.type === "credit" ? "credit_note" : "debit_note";
      const notes = typeof req.body.notes === "string" ? req.body.notes.trim().slice(0, 500) : "";
      if (!notes)
        return res.status(400).json({ success: false, message: "Adjustment reason is required" });

      const outstanding = await outstandingCents(req.user.companyId, req.params.id);
      /*
       * Sign convention (matches txSign + the outstanding SQL): credit_note
       * INCREASES what the customer owes (must respect the credit limit);
       * debit_note DECREASES it (cannot exceed the outstanding balance).
       */
      if (type === "credit_note") {
        const limitCents = Math.round((Number(customer.credit_limit) || 0) * 100);
        const limitCheck = checkCreditLimit(outstanding, cents, limitCents);
        if (!limitCheck.allowed)
          return res.status(409).json({ success: false, message: "Credit note would exceed the customer's credit limit" });
      } else if (cents > outstanding) {
        return res.status(409).json({ success: false, message: "Debit note exceeds the outstanding balance" });
      }

      const idempotencyKey = req.body.idempotencyKey
        ? String(req.body.idempotencyKey).trim().slice(0, 120)
        : null;
      if (idempotencyKey) {
        const existing = await db(
          "SELECT id FROM customer_credit_ledger WHERE company_id = $1 AND idempotency_key = $2 LIMIT 1",
          [req.user.companyId, idempotencyKey]
        );
        if (existing.rows.length) {
          return res.status(409).json({
            success: false,
            message: "Customer adjustment has already been processed",
            data: { entryId: existing.rows[0].id, duplicate: true },
          });
        }
      }

      const tx = buildAdjustmentTransaction({
        adjustmentType: type,
        amount: req.body.amount,
        reason: notes,
        userId: req.user.id || req.user.userId || null,
      });

      await db(
        `
        INSERT INTO customer_credit_ledger
          (company_id, store_id, customer_id, transaction_type, amount, reference_type, reference_id, description, idempotency_key, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          req.user.companyId,
          req.user.storeId || null,
          req.params.id,
          tx.transaction_type,
          tx.amount,
          tx.reference_type,
          req.body.referenceId || null,
          tx.description,
          idempotencyKey,
          tx.created_by,
        ]
      );

      const newOutstanding = await outstandingCents(req.user.companyId, req.params.id);
      res.status(201).json({
        success: true,
        message: type === "credit_note" ? "Credit note applied" : "Debit note applied",
        data: { type, amount: fromCents(cents), balance: fromCents(newOutstanding) },
      });
    } catch (error) {
      console.error("Customer credit adjustment error:", error);
      res.status(500).json({ success: false, message: "Unable to record adjustment" });
    }
  });

  /*
   * GET /api/customers/:id/credit/ledger — filtered, paginated ledger view.
   * Identifiers are fixed in this query; all user-controlled values are
   * parameterised and customer/company/store access is re-checked above.
   */
  router.get("/customers/:id/credit/ledger", authenticate, authorize("customer.view"), async (req, res) => {
    try {
      const customer = await loadCustomerForCredit(req, res);
      if (!customer) return;

      const pageValue = Number.parseInt(req.query.page, 10);
      const pageSizeValue = Number.parseInt(req.query.pageSize, 10);
      const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1;
      const pageSize = Math.min(
        Number.isFinite(pageSizeValue) && pageSizeValue > 0 ? pageSizeValue : 25,
        100
      );
      const params = [req.user.companyId, req.params.id];
      const filters = ["company_id = $1", "customer_id = $2"];
      let index = 3;

      const companyAdmin = await canViewCompanyCustomers(req.user);
      if (!companyAdmin && req.user.storeId) {
        filters.push(`store_id = $${index}`);
        params.push(req.user.storeId);
        index += 1;
      }
      if (req.query.storeId) {
        filters.push(`store_id = $${index}`);
        params.push(String(req.query.storeId));
        index += 1;
      }
      if (req.query.entryType) {
        const supported = ["credit_sale", "payment", "credit_note", "debit_note", "opening"];
        const entryType = String(req.query.entryType).toLowerCase();
        if (!supported.includes(entryType)) {
          return res.status(400).json({ success: false, message: "Unsupported customer ledger entry type" });
        }
        filters.push(`transaction_type = $${index}`);
        params.push(entryType);
        index += 1;
      }
      if (req.query.direction) {
        const direction = String(req.query.direction).toLowerCase();
        if (!["debit", "credit"].includes(direction)) {
          return res.status(400).json({ success: false, message: "Ledger direction must be debit or credit" });
        }
        const types = direction === "debit"
          ? ["payment", "debit_note"]
          : ["credit_sale", "credit_note", "opening"];
        filters.push(`transaction_type = ANY($${index}::text[])`);
        params.push(types);
        index += 1;
      }
      if (req.query.from) {
        filters.push(`created_at >= $${index}`);
        params.push(String(req.query.from));
        index += 1;
      }
      if (req.query.to) {
        filters.push(`created_at < ($${index}::date + INTERVAL '1 day')`);
        params.push(String(req.query.to));
        index += 1;
      }
      if (req.query.search) {
        filters.push(`(
          COALESCE(description, '') ILIKE $${index}
          OR COALESCE(reference_type, '') ILIKE $${index}
          OR COALESCE(reference_id::text, '') ILIKE $${index}
        )`);
        params.push(`%${String(req.query.search).trim()}%`);
        index += 1;
      }

      const where = filters.join(" AND ");
      const countResult = await db(
        `SELECT COUNT(*)::int AS total FROM customer_credit_ledger WHERE ${where}`,
        params
      );
      const total = Number(countResult.rows[0]?.total || 0);
      const pages = total === 0 ? 0 : Math.ceil(total / pageSize);
      const offset = (page - 1) * pageSize;
      const rows = await db(
        `SELECT l.id, l.transaction_type, l.amount, l.balance_after,
          l.reference_type, l.reference_id, l.description, l.payment_method,
          l.store_id, l.created_by, u.full_name AS created_by_name, l.created_at,
          SUM(l.amount * CASE WHEN l.transaction_type IN ('payment','debit_note') THEN -1 ELSE 1 END)
            OVER (ORDER BY l.created_at, l.id) AS running_balance
         FROM customer_credit_ledger l
         LEFT JOIN users u ON u.id = l.created_by
         WHERE ${where.replaceAll("company_id", "l.company_id").replaceAll("customer_id", "l.customer_id").replaceAll("store_id", "l.store_id").replaceAll("transaction_type", "l.transaction_type").replaceAll("created_at", "l.created_at").replaceAll("description", "l.description").replaceAll("reference_type", "l.reference_type").replaceAll("reference_id", "l.reference_id")}
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT $${index} OFFSET $${index + 1}`,
        [...params, pageSize, offset]
      );
      res.json({
        success: true,
        data: rows.rows,
        records: rows.rows,
        page,
        pageSize,
        total,
        pages,
        customer: { id: customer.id, name: customer.name },
      });
    } catch (error) {
      console.error("Customer credit ledger error:", error);
      res.status(500).json({ success: false, message: "Unable to load customer ledger" });
    }
  });

  /*
   * GET /api/customers/:id/credit/statement?from=&to= — date-range statement.
   */
  router.get("/customers/:id/credit/statement", authenticate, authorize("customer.view"), async (req, res) => {
    try {
      const customer = await loadCustomerForCredit(req, res);
      if (!customer) return;

      const result = await db(
        `
        SELECT transaction_type, amount, reference_type, reference_id, description, created_at
        FROM customer_credit_ledger
        WHERE company_id = $1 AND customer_id = $2
        ORDER BY created_at ASC, id ASC
        `,
        [req.user.companyId, req.params.id]
      );
      const statement = generateStatement({
        transactions: result.rows,
        fromDate: req.query.from ? String(req.query.from) : null,
        toDate: req.query.to ? String(req.query.to) : null,
        customerId: req.params.id,
        companyId: req.user.companyId,
      });

      res.json({ success: true, data: { customer: { id: customer.id, name: customer.name }, statement } });
    } catch (error) {
      console.error("Customer statement error:", error);
      res.status(500).json({ success: false, message: "Unable to build statement" });
    }
  });

  router.get("/customer-segments", authenticate, authorize("customer.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT s.id, s.company_id, s.name, s.description, s.active,
          COUNT(m.customer_id)::int AS member_count
         FROM customer_segments s
         LEFT JOIN customer_segment_members m ON m.segment_id = s.id
         WHERE s.company_id = $1
         GROUP BY s.id
         ORDER BY s.name`,
        [req.user.companyId]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("List customer segments error:", error);
      res.status(500).json({ success: false, message: "Unable to load customer segments" });
    }
  });

  router.post("/customer-segments", authenticate, authorize("customer.edit"), async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ success: false, message: "Segment name is required" });
    try {
      const result = await db(
        `INSERT INTO customer_segments (company_id, name, description, active)
         VALUES ($1, $2, $3, true)
         RETURNING id, company_id, name, description, active`,
        [req.user.companyId, name, req.body.description || null]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "Segment already exists" });
      console.error("Create customer segment error:", error);
      res.status(500).json({ success: false, message: "Unable to create customer segment" });
    }
  });

  router.put("/customer-segments/:id", authenticate, authorize("customer.edit"), async (req, res) => {
    try {
      const result = await db(
        `UPDATE customer_segments SET
          name = COALESCE($1, name), description = COALESCE($2, description),
          active = COALESCE($3, active), updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND company_id = $5
         RETURNING id, company_id, name, description, active`,
        [req.body.name == null ? null : String(req.body.name).trim(), req.body.description, req.body.active, req.params.id, req.user.companyId]
      );
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Segment not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "Segment already exists" });
      console.error("Update customer segment error:", error);
      res.status(500).json({ success: false, message: "Unable to update customer segment" });
    }
  });

  router.get("/customer-segments/:id/members", authenticate, authorize("customer.view"), async (req, res) => {
    const result = await db(
      `SELECT c.id, c.name, c.phone, c.email, c.active, m.created_at AS member_since
       FROM customer_segment_members m
       INNER JOIN customers c ON c.id = m.customer_id
       WHERE m.segment_id = $1 AND m.company_id = $2
       ORDER BY c.name`,
      [req.params.id, req.user.companyId]
    );
    res.json({ success: true, data: { members: result.rows } });
  });

  router.post("/customer-segments/:id/members", authenticate, authorize("customer.edit"), async (req, res) => {
    const customerIds = Array.isArray(req.body.customerIds) ? req.body.customerIds : [req.body.customerId];
    const result = await db(
      `INSERT INTO customer_segment_members (company_id, segment_id, customer_id)
       SELECT $1, $2, c.id FROM customers c
       WHERE c.company_id = $1 AND c.id = ANY($3::uuid[])
       ON CONFLICT (segment_id, customer_id) DO NOTHING
       RETURNING customer_id`,
      [req.user.companyId, req.params.id, customerIds.filter(Boolean)]
    );
    res.json({ success: true, assigned: result.rows.length });
  });

  router.delete("/customer-segments/:id/members/:customerId", authenticate, authorize("customer.edit"), async (req, res) => {
    const result = await db(
      `DELETE FROM customer_segment_members
       WHERE segment_id = $1 AND customer_id = $2 AND company_id = $3`,
      [req.params.id, req.params.customerId, req.user.companyId]
    );
    res.json({ success: true, removed: result.rowCount || 0 });
  });

  router.post("/customers/import/preview", authenticate, authorize("customer.edit"), async (req, res) => {
    const sourceRows = parseCsv(req.body.csv);
    const existing = await db(
      `SELECT id, name, phone, email, credit_enabled, credit_limit FROM customers WHERE company_id = $1 AND active = true`,
      [req.user.companyId]
    );
    const rows = sourceRows.map((row, index) => {
      const phone = row.phone || null;
      const email = row.email || null;
      const invalid = (phone && !/^\+?\d{7,15}$/.test(phone)) || (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
      const match = existing.rows.find((customer) => (email && customer.email === email) || (phone && customer.phone === phone));
      return { row: index + 2, ...row, valid: !invalid, action: invalid ? "invalid" : match ? "update" : "create", matchCustomer: match ? { id: match.id, name: match.name } : null, errors: invalid ? ["Invalid email or phone"] : [] };
    });
    res.json({ success: true, data: { total: rows.length, creates: rows.filter((row) => row.action === "create").length, updates: rows.filter((row) => row.action === "update").length, invalid: rows.filter((row) => row.action === "invalid").length, rows } });
  });

  router.post("/customers/import", authenticate, authorize("customer.edit"), async (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.some((row) => row.valid === false || row.action === "invalid")) {
      return res.status(422).json({ success: false, message: "Import contains invalid rows" });
    }
    if (rows.some((row) => row.action === "update" && (!row.matchCustomer?.id || !String(row.matchCustomer.id).startsWith(req.user.companyId.slice(0, 1))))) {
      const check = await db(`SELECT id FROM customers WHERE id = $1 AND company_id = $2`, [rows.find((row) => row.action === "update")?.matchCustomer?.id, req.user.companyId]);
      if (!check.rows.length) return res.status(400).json({ success: false, message: "Import customer does not belong to this company" });
    }
    const client = pool?.connect ? await pool.connect() : null;
    try {
      let created = 0;
      let updated = 0;
      for (const row of rows) {
        if (row.action === "update") {
          const result = await db(
            `UPDATE customers SET
              name = COALESCE($1, name), phone = COALESCE($2, phone), email = COALESCE($3, email),
              address = COALESCE($4, address), postcode = COALESCE($5, postcode), notes = COALESCE($6, notes),
              credit_enabled = COALESCE($7, credit_enabled), credit_limit = COALESCE($8, credit_limit)
             WHERE id = $9 AND company_id = $10
             RETURNING id, name, phone, email`,
            [row.name, row.phone, row.email, row.address, row.postcode, row.notes, row.creditEnabled, row.creditLimit, row.matchCustomer.id, req.user.companyId]
          );
          if (!result.rows.length) return res.status(400).json({ success: false, message: "Import customer does not belong to this company" });
          updated += 1;
        } else {
          await db(
            `INSERT INTO customers (company_id, name, phone, email, address, postcode, notes, credit_enabled, credit_limit)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, name, phone, email`,
            [req.user.companyId, row.name, row.phone, row.email, row.address, row.postcode, row.notes, row.creditEnabled ?? false, row.creditLimit]
          );
          created += 1;
        }
      }
      res.json({ success: true, data: { created, updated } });
    } finally {
      client?.release();
    }
  });

  router.get("/customers/export", authenticate, authorize("customer.view"), async (req, res) => {
    const result = await db(
      `SELECT c.name, c.phone, c.email, c.address, c.postcode, c.notes,
        c.credit_enabled, c.credit_limit, COALESCE(clb.balance, 0) AS loyalty_balance
       FROM customers c
       LEFT JOIN customer_loyalty_balances clb ON clb.customer_id = c.id AND clb.company_id = c.company_id
       WHERE c.company_id = $1 ORDER BY c.name`,
      [req.user.companyId]
    );
    const headers = ["name", "phone", "email", "address", "postcode", "notes", "credit_enabled", "credit_limit", "loyalty_balance"];
    const csv = [headers.join(","), ...result.rows.map((row) => headers.map((header) => String(row[header] ?? "").replaceAll(",", " ")).join(","))].join("\n");
    res.type("text/csv").send(csv);
  });

  router.post("/gift-cards", authenticate, authorize("customer.edit"), async (req, res) => {
    const value = validateIssueValue(req.body.value);
    if (!value.ok) return res.status(400).json({ success: false, message: value.reason });
    const code = normaliseGiftCardCode(req.body.code);
    if (!code) return res.status(400).json({ success: false, message: "Gift card code is required" });
    try {
      const card = await db(
        `INSERT INTO gift_cards (company_id, code, reference_number, customer_id, status, initial_value, expires_at, issued_by)
         VALUES ($1, $2, $3, $4, 'active', $5, $7, $6)
         RETURNING id, code`,
        [req.user.companyId, code, req.body.referenceNumber || null, req.body.customerId || null, req.body.value, req.user.id, req.body.expiresAt || null]
      );
      await db(
        `INSERT INTO gift_card_transactions (company_id, gift_card_id, transaction_type, amount, balance_after, reference_type, description, store_id, created_by)
         VALUES ($1, $2, 'issue', $3, $3, 'issue', 'Gift card issued', $4, $5)`,
        [req.user.companyId, card.rows[0].id, req.body.value, req.user.storeId, req.user.id]
      );
      res.status(201).json({ success: true, data: { ...card.rows[0], balance: Number(req.body.value) } });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "Gift card code already exists" });
      console.error("Issue gift card error:", error);
      res.status(500).json({ success: false, message: "Unable to issue gift card" });
    }
  });

  router.get("/gift-cards", authenticate, authorize("customer.view"), async (req, res) => {
    const result = await db(
      `SELECT g.id, g.code, g.reference_number, g.customer_id, c.name AS customer_name,
        g.status, g.initial_value, g.expires_at, COALESCE(SUM(CASE WHEN t.transaction_type = 'redeem' THEN -t.amount ELSE t.amount END), 0) AS balance
       FROM gift_cards g LEFT JOIN customers c ON c.id = g.customer_id
       LEFT JOIN gift_card_transactions t ON t.gift_card_id = g.id
       WHERE g.company_id = $1 GROUP BY g.id, c.name ORDER BY g.issued_at DESC`,
      [req.user.companyId]
    );
    res.json({ success: true, data: result.rows });
  });

  router.get("/gift-cards/:id", authenticate, authorize("customer.view"), async (req, res) => {
    const result = await db(
      `SELECT g.id, g.code, g.status, g.expires_at,
        COALESCE(SUM(CASE WHEN t.transaction_type = 'redeem' THEN -t.amount ELSE t.amount END), 0) AS balance
       FROM gift_cards g LEFT JOIN gift_card_transactions t ON t.gift_card_id = g.id
       WHERE g.id = $1 AND g.company_id = $2 GROUP BY g.id`,
      [req.params.id, req.user.companyId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Gift card not found" });
    const transactions = await db(
      `SELECT * FROM gift_card_transactions WHERE gift_card_id = $1 AND company_id = $2 ORDER BY created_at ASC`,
      [req.params.id, req.user.companyId]
    );
    res.json({ success: true, data: { ...result.rows[0], transactions: transactions.rows } });
  });

  router.post("/gift-cards/lookup", authenticate, authorize("customer.view"), async (req, res) => {
    const lookup = codeLookupClause(req.body.code, 2);
    const result = await db(lookup.sql, [...lookup.params, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Gift card not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.post("/gift-cards/:id/topup", authenticate, authorize("customer.edit"), async (req, res) => {
    const value = validateTopUp(req.body.amount);
    if (!value.ok) return res.status(400).json({ success: false, message: value.reason });
    const card = await db(`SELECT id, code, status, expires_at FROM gift_cards WHERE id = $1 AND company_id = $2`, [req.params.id, req.user.companyId]);
    if (!card.rows.length) return res.status(404).json({ success: false, message: "Gift card not found" });
    if (card.rows[0].status !== "active") return res.status(409).json({ success: false, message: "Gift card is not active" });
    await db(`INSERT INTO gift_card_transactions (company_id, gift_card_id, transaction_type, amount, balance_after, reference_type, description, store_id, created_by) VALUES ($1, $2, 'topup', $3, $3, 'topup', 'Gift card top up', $4, $5)`, [req.user.companyId, req.params.id, req.body.amount, req.user.storeId, req.user.id]);
    const txs = await db(`SELECT * FROM gift_card_transactions WHERE gift_card_id = $1 AND company_id = $2 ORDER BY created_at ASC`, [req.params.id, req.user.companyId]);
    const balance = txs.rows.reduce((total, tx) => total + (tx.transaction_type === "redeem" ? -Number(tx.amount) : Number(tx.amount)), 0);
    res.json({ success: true, data: { balance } });
  });

  router.post("/gift-cards/:id/block", authenticate, authorize("customer.edit"), async (req, res) => {
    const result = await db(
      `UPDATE gift_cards SET status = CASE WHEN $1 THEN 'blocked' ELSE 'active' END
       WHERE id = $2 AND company_id = $3 RETURNING id, code, status`,
      [req.body.blocked !== false, req.params.id, req.user.companyId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Gift card not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  return router;
}
