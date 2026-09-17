import express from "express";
import { dispatchIntegrationEvent } from "../services/integrationDispatcher.js";

export default function createSalesRouter({
  authenticate,
  authorize,
  db,
  pool,
  createInventoryMovement,
  associateCustomerWithStore,
}) {
  const router = express.Router();

  function reportDateFilters(query, params, alias = "s") {
    const filters = [];
    if (query.dateFrom) {
      params.push(query.dateFrom);
      filters.push(
        `(${alias}.created_at AT TIME ZONE c.timezone)::date >= $${params.length}`
      );
    }
    if (query.dateTo) {
      params.push(query.dateTo);
      filters.push(
        `(${alias}.created_at AT TIME ZONE c.timezone)::date <= $${params.length}`
      );
    }
    return filters;
  }

  /*
   * GET /api/sales
   */
  router.get(
    "/sales",
    authenticate,
    authorize("sale.create", "sale.refund"),
    async (req, res) => {
      try {
        const params = [req.user.companyId, req.user.storeId];
        const filters = ["s.company_id = $1", "s.store_id = $2"];
        if (req.query.search) {
          params.push(`%${String(req.query.search).trim()}%`);
          filters.push(
            `(s.id::text ILIKE $${params.length} OR s.receipt_number ILIKE $${params.length} OR cst.name ILIKE $${params.length})`
          );
        }
        filters.push(...reportDateFilters(req.query, params));
        if (req.query.paymentMethod) {
          params.push(req.query.paymentMethod);
          filters.push(`pay.payment_method = $${params.length}`);
        }
        if (req.query.status) {
          params.push(req.query.status);
          filters.push(`s.status = $${params.length}`);
        }

        const result = await db(
          `
          SELECT s.id, s.receipt_number, s.created_at, s.store_id, st.name AS store_name,
            COALESCE(cst.name, 'Walk-in Customer') AS customer_name,
            COUNT(DISTINCT si.id)::int AS item_count, s.subtotal, s.tax, s.discount, s.total,
            s.status, u.username AS cashier, pay.payment_method, pay.status AS payment_status
          FROM sales s
          INNER JOIN companies c ON c.id = s.company_id
          LEFT JOIN stores st ON st.id = s.store_id
          LEFT JOIN customers cst ON cst.id = s.customer_id
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN sale_items si ON si.sale_id = s.id
          LEFT JOIN payments pay ON pay.sale_id = s.id
          WHERE ${filters.join(" AND ")}
          GROUP BY s.id, st.name, cst.name, u.username, pay.payment_method, pay.status
          ORDER BY s.created_at DESC
          LIMIT 500
          `,
          params
        );
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Load sales error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load sales" });
      }
    }
  );

  /*
   * GET /api/sales/:id
   */
  router.get(
    "/sales/:id",
    authenticate,
    authorize("sale.create", "sale.refund"),
    async (req, res) => {
      try {
        const sale = await db(
          `
          SELECT s.*, st.name AS store_name, u.username AS cashier,
            cst.name AS customer_name, cst.phone AS customer_phone, cst.email AS customer_email,
            pay.payment_method, pay.amount AS payment_amount, pay.status AS payment_status, pay.created_at AS payment_created_at,
            oo.platform, oo.external_order_id
          FROM sales s
          LEFT JOIN online_orders oo ON oo.id = s.online_order_id
            AND oo.company_id = s.company_id AND oo.store_id = s.store_id
          LEFT JOIN stores st ON st.id = s.store_id
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN customers cst ON cst.id = s.customer_id
          LEFT JOIN payments pay ON pay.sale_id = s.id
          WHERE s.id = $1 AND s.company_id = $2 AND s.store_id = $3
          `,
          [req.params.id, req.user.companyId, req.user.storeId]
        );
        if (!sale.rows.length)
          return res
            .status(404)
            .json({ success: false, message: "Sale not found" });
        const items = await db(
          "SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id",
          [req.params.id]
        );
        const returns = await db(
          "SELECT sr.id, sri.product_id, sri.quantity, sr.reason, sr.created_at FROM stock_returns sr INNER JOIN stock_return_items sri ON sri.return_id=sr.id WHERE sr.sale_id=$1 ORDER BY sr.created_at",
          [req.params.id]
        );
        res.json({
          success: true,
          data: { ...sale.rows[0], items: items.rows, returns: returns.rows },
        });
      } catch (error) {
        console.error("Get sale error:", error);
        res
          .status(500)
          .json({ success: false, message: "Unable to load sale" });
      }
    }
  );

  /*
   * POST /api/sales
   */
  router.post(
    "/sales",
    authenticate,
    authorize("sale.create"),
    async (req, res) => {
      if (!pool) {
        return res.status(500).json({
          success: false,
          message: "DATABASE_URL is not configured",
        });
      }

      const clientRequestId = req.body.clientRequestId ?? null;
      if (clientRequestId !== null && (typeof clientRequestId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientRequestId))) {
        return res.status(400).json({ success: false, message: "Invalid clientRequestId UUID" });
      }

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        if (clientRequestId !== null) {
          // Serialize retries before any customer, inventory or payment writes.
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
            `${req.user.companyId}:${clientRequestId.toLowerCase()}`,
          ]);
          const existing = await client.query(
            "SELECT id, created_at, total, receipt_number FROM sales WHERE company_id = $1 AND client_request_id = $2",
            [req.user.companyId, clientRequestId]
          );
          if (existing.rows.length) {
            await client.query("COMMIT");
            return res.status(201).json({ success: true, message: "Sale completed", sale: existing.rows[0] });
          }
        }

        const session = await db(
          `
          SELECT ts.id, ts.terminal_id, t.terminal_number, c.timezone
          FROM till_sessions ts
          INNER JOIN terminals t ON t.id = ts.terminal_id
          INNER JOIN stores s ON s.id = ts.store_id
          INNER JOIN companies c ON c.id = s.company_id
          WHERE ts.company_id = $1
            AND ts.store_id = $2
            AND ts.status = 'open'
          ORDER BY ts.opened_at DESC
          LIMIT 1
          `,
          [req.user.companyId, req.user.storeId]
        );

        if (!session.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: "No open till session. Open a till before selling.",
          });
        }

        const {
          items = [],
          customerId = null,
          subtotal = 0,
          tax = 0,
          discount = 0,
          total = 0,
          paymentMethod = "cash",
        } = req.body;

        if (!Array.isArray(items) || !items.length) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            success: false,
            message: "Sale contains no items",
          });
        }

        if (customerId) {
          await associateCustomerWithStore(
            client,
            customerId,
            req.user.storeId,
            req.user.companyId,
            new Date()
          );
        }

        /*
         * Make sure all products belong to this company.
         */
        for (const item of items) {
          if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
            throw new Error("Sale quantities must be greater than zero");
          }

          const product = await client.query(
            `
          SELECT
            id,
            name,
            price,
            stock_quantity,
            track_stock
          FROM products
          WHERE id = $1
            AND company_id = $2
            AND active = true
          FOR UPDATE
          `,
            [item.productId, req.user.companyId]
          );

          if (!product.rows.length) {
            throw new Error(`Product ${item.productId} was not found`);
          }

          const p = product.rows[0];

          if (
            p.track_stock &&
            Number(p.stock_quantity) < Number(item.quantity)
          ) {
            throw new Error(`Insufficient stock for ${p.name}`);
          }
        }

        /*
         * Authoritative receipt number (T8E): sequential per terminal per
         * business day, in the same shape as the offline provisional
         * receipts (PREFIX-YYYYMMDD-NNNN). The advisory lock serialises
         * concurrent numbering for this terminal/day, and MAX(numeric
         * suffix)+1 stays monotonic even if old sale rows are ever
         * removed. Online-order receipts (terminal_id NULL, platform
         * references) never match the LIKE prefix, so they are neither
         * renumbered nor blocked.
         */
        const receiptPrefix = (session.rows[0].terminal_number || "T").trim();
        const receiptDateKey = await client.query(
          "SELECT to_char(timezone($1, NOW()), 'YYYYMMDD') AS date_key",
          [session.rows[0].timezone || "UTC"]
        );
        const dateKey = receiptDateKey.rows[0].date_key;

        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${req.user.companyId}:${session.rows[0].terminal_id}:${dateKey}`,
        ]);

        const likePrefix =
          `${receiptPrefix}-${dateKey}-`.replace(/([%_\\])/g, "\\$1") + "%";
        const nextNumberResult = await client.query(
          `
          SELECT COALESCE(MAX(NULLIF(split_part(receipt_number, '-', 3), '')::int), 0) + 1 AS next_number
          FROM sales
          WHERE company_id = $1
            AND terminal_id = $2
            AND receipt_number LIKE $3
          `,
          [req.user.companyId, session.rows[0].terminal_id, likePrefix]
        );
        const receiptNumber = `${receiptPrefix}-${dateKey}-${String(
          nextNumberResult.rows[0].next_number
        ).padStart(4, "0")}`;

        /*
         * Create sale.
         */
        const sale = await client.query(
          `
          INSERT INTO sales (
            company_id,
            store_id,
            user_id,
            customer_id,
            terminal_id,
            receipt_number,
            subtotal,
            tax,
            discount,
            total,
            status,
            offline_created,
            sync_status,
            client_request_id,
            completed_at
          )
          VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
            'completed',
            false,
            'synced',
            $11,
            NOW()
          )
          RETURNING
            id,
            created_at,
            total,
            receipt_number
          `,
          [
            req.user.companyId,
            req.user.storeId,
            req.user.id,
            customerId,
            session.rows[0].terminal_id,
            receiptNumber,
            Number(subtotal) || 0,
            Number(tax) || 0,
            Number(discount) || 0,
            Number(total) || 0,
            clientRequestId,
          ]
        );

        const saleId = sale.rows[0].id;

        /*
         * Sale items + stock reduction.
         */
        for (const item of items) {
          const product = await client.query(
            `
          SELECT
            id,
            name,
            price,
            vat_rate,
            track_stock
          FROM products
          WHERE id = $1
            AND company_id = $2
            AND active = true
          `,
            [item.productId, req.user.companyId]
          );

          const p = product.rows[0];

          if (p.track_stock) {
            const movement = await createInventoryMovement(client, {
              companyId: req.user.companyId,
              productId: item.productId,
              storeId: req.user.storeId,
              movementType: "SALE",
              quantityChange: -(Number(item.quantity) || 1),
              referenceType: "SALE",
              referenceId: saleId,
              createdBy: req.user.id,
            });

            p.stock_quantity = movement.balance;
          }

          await client.query(
            `
          INSERT INTO sale_items (
            sale_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            discount,
            tax,
            total
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          `,
            [
              saleId,
              item.productId,
              p.name,
              Number(item.quantity) || 1,
              Number(item.unitPrice) || Number(p.price) || 0,
              Number(item.discount) || 0,
              Number(item.tax) || 0,
              Number(item.total) || 0,
            ]
          );
        }

        /*
         * Payment record.
         */
        await client.query(
          `
          INSERT INTO payments (
            sale_id,
            payment_method,
            amount,
            status
          )
          VALUES ($1,$2,$3,'completed')
          `,
          [saleId, paymentMethod, Number(total) || 0]
        );

        await client.query("COMMIT");

        /*
         * T9G: fire-and-forget integration dispatch (never blocks/throws -
         * partner failures cannot affect the completed sale).
         */
        dispatchIntegrationEvent({
          event: "SALE_CREATED",
          deps: { db },
          context: { companyId: req.user.companyId, storeId: req.user.storeId },
          entityId: saleId,
        }).catch(() => {});

        res.status(201).json({
          success: true,
          message: "Sale completed",
          sale: sale.rows[0],
        });
      } catch (error) {
        await client.query("ROLLBACK");

        console.error("Sale error:", error);

        res.status(500).json({
          success: false,
          message: error.message || "Sale could not be completed",
        });
      } finally {
        client.release();
      }
    }
  );

  return router;
}
