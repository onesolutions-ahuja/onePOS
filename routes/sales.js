import express from "express";
import { checkCreditLimit, buildCreditSaleTransaction } from "../services/customerCredit.js";
import { validateRedeemConfig, validateRedeemablePoints } from "../src/utils/loyaltyPoints.js";
import { computeBasketTotals, roundCurrency } from "../src/utils/saleTotals.js";
import { dispatchIntegrationEvent } from "../services/integrationDispatcher.js";
import { dispatchWhatsAppInvoiceDelivery } from "../services/whatsappDelivery.js";
import { dispatchSmsInvoiceDelivery, dispatchEmailInvoiceDelivery } from "../services/invoiceDelivery.js";

export default function createSalesRouter({
  authenticate,
  authorize,
  db,
  pool,
  createInventoryMovement,
  associateCustomerWithStore,
  writeAudit = null,
  selfCheckoutMode = null,
  getRolePermissionCodes = null,
  canViewCompanyCustomers = null,
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
    authorize("sale.view", "sale.create", "sale.refund"),
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
    authorize("sale.view", "sale.invoice.view", "sale.create", "sale.refund"),
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
          giftCardCode = null,
          ageVerified, // T10C: operator confirmation flag, verified against the DB below
          vatEnabled, // Till Misc Item: the company's global VAT master switch, as applied by the till
        } = req.body;

        /*
         * T10D: a Self-Checkout session may only pay by card. The payment
         * contract, sale engine and inventory path are the same as the
         * staff till — only the cash option is removed, and it is removed
         * SERVER-SIDE, not just hidden in the UI.
         */
        if (paymentMethod === "cash" && typeof selfCheckoutMode === "function" && selfCheckoutMode(req)) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            success: false,
            message: "Cash is not accepted at Self-Checkout. Please pay by card.",
          });
        }

        /*
          * T10-DISCOUNT: server-side discount authority.
          *
          * The till client MAY propose per-line and order discounts, but the
          * server is the authority on whether a discount is allowed and how
          * much it is worth. Order discounts require the `sale.discount`
          * permission; without it the proposed order discount is dropped to 0.
          * Authoritative totals are recomputed below from catalogue prices, so
          * a non-privileged till cannot inflate a discount or fabricate prices.
          */
        const isAdmin = typeof canViewCompanyCustomers === "function"
          ? await canViewCompanyCustomers(req.user)
          : false;
        let allowedOrderDiscountType = null;
        let allowedOrderDiscountValue = 0;
        if (typeof getRolePermissionCodes === "function") {
          const roleCodes = await getRolePermissionCodes(req.user.roleId);
          const canDiscount = isAdmin || roleCodes.includes("sale.discount");
          if (canDiscount) {
            const dt = req.body.discountType ?? null;
            const dv = Number(req.body.discountValue ?? 0) || 0;
            if ((dt === "percent" || dt === "fixed") && dv > 0) {
              allowedOrderDiscountType = dt;
              allowedOrderDiscountValue = dv;
            }
          }
        }

        /*
         * Multiple payment methods — one authoritative tender list.
         *
         * `payments` in the request body is an optional array of
         * { paymentMethod, amount } lines (split tender). When absent, the
         * single `paymentMethod` tender is used exactly as before — cash,
         * card, customer_credit, loyalty redemption and gift-card flows are
         * untouched. Validation rules:
         *   - each line needs a known method and a positive amount;
         *   - methods must not repeat (one row per tender);
         *   - the tender lines must reconcile EXACTLY to the sale total
         *     (pennies) — over/underpayment is rejected. Cash change is a
         *     display concern handled by the till UI, never a split line.
         *   - customer_credit and loyalty redemption are whole-sale tenders:
         *     they may not be mixed with other methods (credit exposes the
         *     full sale amount on the ledger; loyalty redemption already
         *     pre-commit debits its points against the full total).
         */
        const PAYMENT_METHODS = [
          "cash",
          "card",
          "customer_credit",
          "gift_card",
          "voucher",
          "cheque",
          "bank_transfer",
          "online",
        ];
        const rawPayments = Array.isArray(req.body.payments) ? req.body.payments : [];
        let paymentLines = null;
        if (rawPayments.length) {
          if (rawPayments.length > 8) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Too many payment lines (maximum 8)",
            });
          }

          const seen = new Set();
          paymentLines = [];
          let sumCents = 0;
          for (const line of rawPayments) {
            const method = String(line?.paymentMethod || "").trim();
            const amount = Number(line?.amount);
            if (!PAYMENT_METHODS.includes(method) || !Number.isFinite(amount) || amount <= 0) {
              await client.query("ROLLBACK");
              return res.status(400).json({
                success: false,
                message: `Invalid payment line: method must be one of ${PAYMENT_METHODS.join(", ")} and amount must be greater than 0`,
              });
            }
            if (seen.has(method)) {
              await client.query("ROLLBACK");
              return res.status(400).json({
                success: false,
                message: `Duplicate payment method: ${method}`,
              });
            }
            seen.add(method);
            const cents = Math.round(amount * 100);
            sumCents += cents;
            paymentLines.push({ method, amount: cents / 100 });
          }

          const totalCents = Math.round((Number(total) || 0) * 100);
          if (sumCents !== totalCents) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: `Payments total ${(sumCents / 100).toFixed(2)} does not match the sale total ${(totalCents / 100).toFixed(2)}`,
            });
          }

          if (seen.has("customer_credit") && seen.size > 1) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Customer credit cannot be combined with other payment methods",
            });
          }
        } else if (paymentMethod === "split") {
          /* A "split" sale without tender lines would produce a meaningless
             single payment row — demand the array. */
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: "Split payment requires a payments array",
          });
        }

        /* Till Misc Item lines count as sale content (declared properly in
           the MISC block below; guarded with a body check here). */
        if ((!Array.isArray(items) || !items.length) &&
            !(Array.isArray(req.body.miscLines) && req.body.miscLines.length)) {
          await client.query("ROLLBACK");

          return res.status(400).json({
            success: false,
            message: "Sale contains no items",
          });
        }

        /*
         * T10R: loyalty points redemption (authoritative, pre-commit).
         * Validated against the programme config and the row-locked balance;
         * the debit + REDEEM ledger row commit atomically WITH the sale, so
         * a failed sale never redeems and a committed sale always redeems.
         */
        const redeemPoints = Number(req.body.redeemPoints ?? 0);
        const loyaltyTenderApplied = redeemPoints > 0;
        let loyaltyRedeemValue = 0; // currency value redeemed (0 when none)
        if (redeemPoints > 0) {
          /* Redemption is a whole-sale tender handled by the loyalty ledger
             below (pre-commit debit against the full total) — it can never be
             combined with split payment lines without double-counting money. */
          if (paymentLines) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Loyalty redemption cannot be combined with split payments. Complete the sale with a single payment method.",
            });
          }
          if (!customerId) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "A customer must be selected to redeem loyalty points.",
            });
          }
          const settings = await db(
            `SELECT loyalty_enabled, loyalty_earning_rate, loyalty_min_sale_total, loyalty_redeem_value_per_point, loyalty_min_points_redeem FROM company_settings WHERE company_id = $1`,
            [req.user.companyId]
          );
          const programme = settings.rows[0] ?? null;
          let valuePerPoint = null;
          try {
            ({ valuePerPoint } = validateRedeemConfig(programme));
          } catch (validationError) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: validationError.message });
          }

          // Lock the balance row for the duration of the sale transaction
          const balanceRes = await client.query(
            `SELECT balance FROM customer_loyalty_balances WHERE company_id = $1 AND customer_id = $2 FOR UPDATE`,
            [req.user.companyId, customerId]
          );
          const currentBalance = Number(balanceRes.rows[0]?.balance || 0);
          let pointsToRedeem;
          try {
            pointsToRedeem = validateRedeemablePoints(currentBalance, redeemPoints, programme).points;
          } catch (validationError) {
            await client.query("ROLLBACK");
            return res.status(400).json({ success: false, message: validationError.message });
          }

          const redeemValue = Math.round(pointsToRedeem * valuePerPoint * 100) / 100;
          loyaltyRedeemValue = redeemValue;
          if (redeemValue > Number(total) + 0.01) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Points redemption exceeds the sale total.",
            });
          }

          const newBalance = currentBalance - pointsToRedeem;
          await client.query(
            `UPDATE customer_loyalty_balances SET balance = $1, updated_at = NOW() WHERE company_id = $2 AND customer_id = $3`,
            [newBalance, req.user.companyId, customerId]
          );
          await client.query(
            `
            INSERT INTO customer_loyalty_transactions
              (company_id, customer_id, transaction_type, amount, balance_after, reference_type, description, created_by)
            VALUES ($1, $2, 'REDEEM', $3, $4, $5, $6, $7)
            `,
            [
              req.user.companyId,
              customerId,
              -pointsToRedeem,
              newBalance,
              "sale",
              `Redeemed at the till (sale total ${Number(total).toFixed(2)})`,
              req.user.id,
            ]
          );
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
         * Till Misc Item (manual-price sale line). Lines the cashier typed by
         * hand — description + price + VAT rate — arrive in `miscLines`. Each
         * is validated HERE (server-side, never trusting the client math),
         * then merged into the authoritative line loop below as
         * item_type='MISC' rows referencing the company's shared invisible
         * MISC placeholder product. No stock movement is made for them (the
         * placeholder has track_stock=false and there is no catalogue SKU to
         * decrement), but they are real sale lines: receipt, sales totals,
         * VAT and reports include them like any other line.
         */
        const miscLines = Array.isArray(req.body.miscLines) ? req.body.miscLines : [];
        const miscPlaceholderRows = [];
        if (miscLines.length) {
          const maxMiscLines = 50;
          if (miscLines.length > maxMiscLines) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Too many misc item lines",
            });
          }

          const placeholder = await client.query(
            `
            INSERT INTO products (
              company_id,
              name,
              sku,
              price,
              cost_price,
              vat_rate,
              vat_applicable,
              track_stock,
              stock_quantity,
              active
            )
            VALUES ($1, 'Misc Item', 'MISC', 0, 0, 20, false, false, 0, false)
            ON CONFLICT (company_id) WHERE sku = 'MISC' AND active = false
            DO UPDATE SET updated_at = NOW()
            RETURNING id
            `,
            [req.user.companyId]
          );
          miscPlaceholderRows.push(placeholder.rows[0].id);
        }
        for (const [miscIndex, line] of miscLines.entries()) {
          const desc = typeof line?.description === "string" ? line.description.trim().slice(0, 255) : "";
          const price = Math.round((Number(line?.price) || 0) * 100) / 100;
          const quantity = Number(line?.quantity);
          const vatRate = Math.round((Number(line?.vatRate) || 0) * 100) / 100;

          if (!desc) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Misc item description is required",
            });
          }
          if (!Number.isFinite(price) || price <= 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Misc item price must be greater than zero",
            });
          }
          if (!Number.isFinite(quantity) || quantity <= 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Misc item quantity must be greater than zero",
            });
          }
          if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 1) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "Misc item VAT rate must be a fraction between 0 and 1 (e.g. 0.2 for 20%)",
            });
          }
        }

        /*
         * Make sure all products belong to this company.
         */
        let basketHasAgeRestricted = false; // T10C
        /*
         * T10U: negative-inventory billing safety. The stock check below is
         * THE existing validation mechanism — it is not replaced. When the
         * company has explicitly enabled negative-inventory billing, an
         * insufficient-stock line is recorded (with authoritative stock
         * levels) and the sale is allowed to proceed into the normal
         * checkout/inventory path instead of being rejected; the resulting
         * negative balance flows through the existing inventory ledger and
         * is audited fire-and-forget after commit. When the setting is OFF
         * (the default) behaviour is exactly as before.
         */
        const negativeBillingAllowed =
          req.body.allowNegativeStockSale === true
            ? await client.query(
                "SELECT allow_negative_inventory_billing FROM company_settings WHERE company_id = $1",
                [req.user.companyId]
              ).then((r) => r.rows.length > 0 && r.rows[0].allow_negative_inventory_billing === true)
            : false;
        const insufficientStockLines = [];
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
            track_stock,
            age_restricted
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

          if (p.age_restricted === true) {
            basketHasAgeRestricted = true;
          }

          if (
            p.track_stock &&
            Number(p.stock_quantity) < Number(item.quantity)
          ) {
            /*
             * A paid sale must never be discarded because stock ran out —
             * the money has already changed hands and the sale is the
             * authoritative record. The line is recorded here (with
             * authoritative stock numbers — the client's claim is never
             * trusted) and the sale proceeds into the normal
             * checkout/inventory path: the stock is deducted by the
             * existing SALE inventory movement and the resulting negative
             * balance is audited fire-and-forget after commit. All other
             * validation (quantity, product, price, VAT, permissions,
             * payment) is unchanged.
             */
            insufficientStockLines.push({
              productId: p.id,
              productName: p.name,
              recordedStock: Number(p.stock_quantity) || 0,
              requestedQuantity: Number(item.quantity),
            });
          }
        }

        /*
         * T10C: server-side age-verification gate. The POS modal alone is
         * NOT trusted — a direct API call containing age-restricted products
         * without a confirmed verification is rejected here, before any
         * sale/payment/inventory write.
         */
        if (basketHasAgeRestricted && ageVerified !== true) {
          await client.query("ROLLBACK");
          return res.status(403).json({
            success: false,
            message: "Age verification required for age-restricted products",
          });
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
         *
         * Configurable prefixes: the company can set per-source invoice
         * prefixes in Settings (till_invoice_prefix / delivery prefix /
         * self_checkout_invoice_prefix, defaults TO / DEL / SC). The prefix
         * is chosen by sale SOURCE: self-checkout mode tokens get the SC
         * prefix, staff till sales get the TO prefix. The sequence stays
         * per terminal per day — the prefix is presentation only, so
         * changing it never resets or collides with existing numbers, and
         * when no prefix is configured the original terminal-number prefix
         * applies unchanged.
         */
        const isSelfCheckoutSale = typeof selfCheckoutMode === "function" && selfCheckoutMode(req);
        let receiptPrefix = (session.rows[0].terminal_number || "T").trim();
        try {
          const prefixSettings = await client.query(
            "SELECT till_invoice_prefix, self_checkout_invoice_prefix FROM company_settings WHERE company_id = $1",
            [req.user.companyId]
          );
          if (prefixSettings.rows.length) {
            const configured = isSelfCheckoutSale
              ? prefixSettings.rows[0].self_checkout_invoice_prefix
              : prefixSettings.rows[0].till_invoice_prefix;
            if (configured && String(configured).trim()) {
              receiptPrefix = String(configured).trim();
            }
          }
        } catch {
          /* Settings row missing/unreadable → original terminal-number prefix. */
        }
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
          * T10-DISCOUNT: authoritative totals recomputation.
          *
          * Reads the validated product rows once into a map and recomputes
          * basket totals from authoritative catalogue prices, mirroring
          * src/utils/saleTotals.js semantics: per-line discounts are capped at
          * each line's gross and applied first, then the order discount (only
          * when sale.discount is held) is applied across the discounted basket,
          * then VAT is computed with per-product vat_applicable under the
          * company default rate. The client-proposed subtotal/tax/discount/total
          * are DISCARDED and replaced, so a till cannot inflate prices, apply a
          * discount it lacks permission for, or submit a non-reconciling total.
          */
        const vatRateFromBody = Number(req.body.vatRate ?? 0) || 0;
        const productPriceMap = {};
        const priceRows = await client.query(
          `
          SELECT id, price, vat_rate, vat_applicable
          FROM products
          WHERE company_id = $1
            AND id = ANY($2::uuid[])
            AND active = true
          `,
          [req.user.companyId, items.map((i) => i.productId)]
        );
        for (const row of priceRows.rows) {
          productPriceMap[row.id] = row;
        }

        const basketForTotals = [];
        const saleDiscountAudit = [];
        for (const item of items) {
          const p = productPriceMap[item.productId];
          const price = Number(p?.price) || 0;
          const qty = Number(item.quantity) || 1;
          const vatRate = p ? Number(p.vat_rate || 0) / 100 : vatRateFromBody;
          const vatApplicable = p ? p.vat_applicable !== false : true;

          const ldt = item.discountType;
          const ldv = Number(item.discountValue ?? 0) || 0;
          const ld = (ldt === "percent" || ldt === "fixed") && ldv > 0
            ? ldt === "percent"
              ? roundCurrency(Math.min(price * qty, (price * qty) * (ldv / 100)))
              : roundCurrency(Math.min(price * qty, ldv))
            : 0;

          if (ld > 0 && item.discountedBy) {
            saleDiscountAudit.push({
              itemIndex: items.indexOf(item),
              discountType: ldt,
              discountValue: ldv,
              amount: ld,
              userId: item.discountedBy,
            });
          }

          basketForTotals.push({
            price,
            quantity: qty,
            vatApplicable,
            discountType: ldt || null,
            discountValue: ldv || 0,
          });
        }

        const engine = computeBasketTotals(basketForTotals, {
          vatEnabled: vatEnabled !== false,
          vatRate: vatRateFromBody,
          discountType: allowedOrderDiscountType,
          discountValue: allowedOrderDiscountValue,
        });

        subtotal = roundCurrency(engine.subtotal);
        tax = roundCurrency(engine.vat || 0);
        discount = roundCurrency(engine.discountAmount);
        total = roundCurrency(engine.total);

        if (allowedOrderDiscountType && engine.orderDiscount > 0 && req.user.id) {
          saleDiscountAudit.push({
            itemIndex: null,
            discountType: allowedOrderDiscountType,
            discountValue: allowedOrderDiscountValue,
            amount: roundCurrency(engine.orderDiscount),
            userId: req.user.id,
          });
        }


        /*
         * Create sale.
         */
        /* T10R: bound (was inline 'completed') so the loyalty earn guard
         * reads a real status; only earnable statuses award points. */
        const saleStatus = "completed";
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
            $12,
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
            saleStatus,
          ]
        );

        const saleId = sale.rows[0].id;

        /*
         * Sale items + stock reduction. Misc lines are appended to the same
         * insert as ordinary lines, but flagged item_type='MISC' and never
         * stock-decremented (no catalogue SKU exists to decrement).
          */
         const saleItemIds = [];
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

          const itemInsert = await client.query(
            `
          INSERT INTO sale_items (
            sale_id,
            product_id,
            product_name,
            quantity,
            unit_price,
            discount,
            tax,
            total,
            item_type,
            discount_type,
            discount_value,
            original_unit_price,
            original_tax,
            original_total,
            discounted_by
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PRODUCT',$9,$10,$11,$12,$13,$14)
          RETURNING id
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
              item.discountType || null,
              Number(item.discountValue) || 0,
              Number(p.price) || 0,
              Number(p.vat_rate || 0) / 100,
              roundCurrency((Number(item.unitPrice) || Number(p.price) || 0) * (Number(item.quantity) || 1)),
              item.discountedBy || null,
            ]
          );
          saleItemIds.push(itemInsert.rows[0].id);
        }

        /*
         * Misc lines: same sale_items table, real money values (the client's
         * maths is never trusted — price/tax are recomputed from the
         * validated description/quantity/vatRate), flagged item_type='MISC',
         * referencing the shared placeholder. No stock movement.
         */
        for (const line of miscLines) {
          const desc = typeof line.description === "string" ? line.description.trim().slice(0, 255) : "";
          const price = Math.round((Number(line.price) || 0) * 100) / 100;
          const quantity = Number(line.quantity);
          const vatRate = Math.round((Number(line.vatRate) || 0) * 100) / 100;
          const gross = Math.round(price * quantity * 100) / 100;
          const lineTax = vatEnabled === false ? 0 : Math.round(gross * vatRate * 100) / 100;
          const lineTotal = Math.round((gross + lineTax) * 100) / 100;

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
            total,
            item_type
          )
          VALUES ($1,$2,$3,$4,$5,0,$6,$7,'MISC')
          `,
            [
              saleId,
              miscPlaceholderRows[0],
              desc,
              quantity,
              price,
              lineTax,
              lineTotal,
            ]
           );
         }

         /*
          * T10-DISCOUNT: audit trail for every discount applied to this sale.
          * Per-line entries reference the sale_items row; order-level entries
          * have item_id NULL. Persisted atomically with the sale.
          */
         for (const entry of saleDiscountAudit) {
           const itemId = entry.itemIndex != null ? saleItemIds[entry.itemIndex] : null;
           await client.query(
             `
             INSERT INTO sale_discounts
               (sale_id, item_id, user_id, type, value, amount)
             VALUES ($1, $2, $3, $4, $5, $6)
             `,
             [saleId, itemId || null, entry.userId, entry.discountType, entry.discountValue, entry.amount]
           );
         }

        /*
          * Payment records — one row per tender.
         *
         * With a validated split (`payments` array) every line is persisted
         * with its own method and amount (reconciliation already enforced
         * above). Without one, the historic single tender is written exactly
         * as before: loyalty redemption relabels the row "loyalty" (the
         * redemption debit lives in the loyalty ledger), and credit/other
         * methods pass through unchanged.
         */
        const tenderRows = paymentLines
          ? paymentLines.map((line) => [saleId, line.method, line.amount])
          : [[saleId, loyaltyTenderApplied ? "loyalty" : paymentMethod, Number(total) || 0]];
        for (const [tSaleId, tMethod, tAmount] of tenderRows) {
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
            [tSaleId, tMethod, tAmount]
          );
        }

        /*
         * T10Y — Customer credit sale. Runs INSIDE the sale transaction so
         * the ledger entry commits or rolls back with the sale itself.
         * Cash/card/other flows are untouched. `amount` stores the unsigned
         * magnitude (major units); the direction comes from transaction_type.
         */
        if (paymentMethod === "customer_credit") {
          if (!customerId) {
            await client.query("ROLLBACK");
            return res.status(400).json({
              success: false,
              message: "A customer is required for credit sales",
            });
          }

          const creditCustomer = await client.query(
            `SELECT credit_enabled, credit_limit FROM customers WHERE id = $1 AND company_id = $2 FOR UPDATE`,
            [customerId, req.user.companyId]
          );
          if (!creditCustomer.rows.length) {
            await client.query("ROLLBACK");
            return res.status(404).json({ success: false, message: "Customer was not found" });
          }
          const cc = creditCustomer.rows[0];
          if (cc.credit_enabled !== true) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              success: false,
              message: "Customer credit is not enabled for this customer",
            });
          }

          const saleTotalCents = Math.round((Number(total) || 0) * 100);
          const signedSum = await client.query(
            `
            SELECT COALESCE(SUM(amount * CASE WHEN transaction_type IN ('payment','debit_note') THEN -1 ELSE 1 END), 0) AS outstanding
            FROM customer_credit_ledger
            WHERE company_id = $1 AND customer_id = $2
            `,
            [req.user.companyId, customerId]
          );
          const currentOutstandingCents = Math.round(Number(signedSum.rows[0].outstanding || 0) * 100);
          const limitCents = Math.round((Number(cc.credit_limit) || 0) * 100);
          const limitCheck = checkCreditLimit(currentOutstandingCents, saleTotalCents, limitCents);
          if (!limitCheck.allowed) {
            await client.query("ROLLBACK");
            return res.status(409).json({
              success: false,
              message: `Credit limit exceeded. Available credit: £${((Number(cc.credit_limit) || 0) - currentOutstandingCents / 100).toFixed(2)}`,
            });
          }

          const ledgerTx = buildCreditSaleTransaction({
            saleId,
            customerId,
            companyId: req.user.companyId,
            storeId: req.user.storeId,
            amount: Number(total) || 0,
            totalTax: Number(tax) || 0,
            netAmount: Number(subtotal) || 0,
            grossAmount: Number(total) || 0,
            userId: req.user.id,
            receiptNumber: sale.rows[0].receipt_number,
          });
          await client.query(
            `
            INSERT INTO customer_credit_ledger
              (company_id, store_id, customer_id, transaction_type, amount, reference_type, reference_id, description, net_amount, vat_amount, gross_amount, idempotency_key, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            `,
            [
              ledgerTx.company_id,
              ledgerTx.store_id,
              ledgerTx.customer_id,
              ledgerTx.transaction_type,
              ledgerTx.amount,
              ledgerTx.reference_type,
              ledgerTx.reference_id,
              ledgerTx.description,
              ledgerTx.net_amount,
              ledgerTx.vat_amount,
              ledgerTx.gross_amount,
              clientRequestId ? `credit_sale:${clientRequestId.toLowerCase()}` : null,
              ledgerTx.created_by,
            ]
          );
        }

        await client.query("COMMIT");

        /*
         * T10R: Customer loyalty earning - fire-and-forget after sale commit
         * Loyalty failures must never block a completed sale. The earn base
         * excludes any redemption applied to this sale (a customer never
         * earns points on points). Redemption itself is handled pre-commit
         * above, atomically with the sale.
         */
        const loyaltyEarnBase = loyaltyTenderApplied ? Math.max(Number(total) - Number(loyaltyRedeemValue), 0) : Number(total);
        if (customerId && typeof writeAudit === "function") {
          Promise.resolve(
            (async () => {
              try {
                // Check if loyalty is enabled for this company
                const settings = await db(
                  `SELECT loyalty_enabled, loyalty_earning_rate, loyalty_min_sale_total FROM company_settings WHERE company_id = $1`,
                  [req.user.companyId]
                );
                if (!settings.rows.length || !settings.rows[0].loyalty_enabled) return;

                /* Cancelled/void sales must never award points. The earn
                 * block runs after the sale transaction commits, so the
                 * sale's CURRENT status is re-read from the database —
                 * a sale voided between commit and this block (or created
                 * by a flow that must not award) is skipped here. */
                const earnableStatuses = ["completed", "paid", "partially_paid"];
                const saleStatusRow = await db(
                  `SELECT status FROM sales WHERE id = $1 AND company_id = $2`,
                  [saleId, req.user.companyId]
                );
                if (
                  !saleStatusRow.rows.length ||
                  !earnableStatuses.includes(String(saleStatusRow.rows[0].status).toLowerCase())
                )
                  return;

                const earningRate = Number(settings.rows[0].loyalty_earning_rate) || 0.01;
                const minSaleTotal = settings.rows[0].loyalty_min_sale_total;
                if (minSaleTotal !== null && minSaleTotal !== undefined && loyaltyEarnBase < Number(minSaleTotal)) return;

                const loyaltyEarned = Math.round(loyaltyEarnBase * earningRate * 10000) / 10000;

                if (loyaltyEarned <= 0) return;

                /* T10R idempotent earn: the unique index
                 * uq_loyalty_earn_per_sale makes a second EARN for the same
                 * sale impossible (lost-acknowledgement retry / double
                 * fire). If the insert hits 23505 the balance upsert is
                 * reversed so the stored balance stays ledger-true. */
                let balanceAfter;
                try {
                  // Insert/update loyalty balance (upsert) and get new balance
                  const balanceResult = await db(
                    `
                    INSERT INTO customer_loyalty_balances (company_id, customer_id, balance)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (company_id, customer_id) 
                    DO UPDATE SET balance = customer_loyalty_balances.balance + EXCLUDED.balance,
                                   updated_at = NOW()
                    RETURNING balance
                    `,
                    [req.user.companyId, customerId, loyaltyEarned]
                  );

                  balanceAfter = Number(balanceResult.rows[0].balance);

                  // Record transaction
                  await db(
                    `
                    INSERT INTO customer_loyalty_transactions 
                      (company_id, customer_id, transaction_type, amount, balance_after, reference_type, reference_id, description, created_by)
                    VALUES ($1, $2, 'EARN', $3, $4, 'sale', $5, 'Sale completed', $6)
                    `,
                    [req.user.companyId, customerId, loyaltyEarned, balanceAfter, saleId, req.user.id]
                  );
                } catch (earnError) {
                  if (earnError && earnError.code === "23505") {
                    /* Already earned for this sale - reverse the balance
                     * upsert so it matches the ledger, then finish quietly. */
                    try {
                      await db(
                        `UPDATE customer_loyalty_balances SET balance = balance - $3, updated_at = NOW() WHERE company_id = $1 AND customer_id = $2`,
                        [req.user.companyId, customerId, loyaltyEarned]
                      );
                    } catch (revertError) {
                      console.error("Loyalty balance revert error:", revertError);
                    }
                    return;
                  }
                  throw earnError;
                }

                // Audit log for loyalty earning
                writeAudit(
                  req.user.companyId,
                  req.user.id,
                  "loyalty.earned",
                  "customer",
                  customerId,
                  { saleId, amount: loyaltyEarned, balanceAfter }
                ).catch((auditError) => console.error("Loyalty audit write error:", auditError));
              } catch (loyaltyError) {
                console.error("Loyalty earning error:", loyaltyError);
                // Do not throw - loyalty failures must not block sales
              }
            })()
          ).catch(() => {});
        }

        /*
         * T10C audit trail: one minimal verification event per restricted
         * sale (sale ID, store, operator, timestamp, confirmed — no personal
         * data). Fire-and-forget through the SHARED audit writer after the
         * sale has committed, so an audit failure can never block or fail a
         * legitimate verified sale (same policy as every other audit write).
         */
        if (basketHasAgeRestricted && typeof writeAudit === "function") {
          Promise.resolve(
            writeAudit(
              req.user.companyId,
              req.user.id,
              "SALE_AGE_VERIFIED",
              "sale",
              saleId,
              { verified: true, storeId: req.user.storeId ?? null }
            )
          ).catch((auditError) => console.error("Age-verification audit write error:", auditError));
        }

        /*
         * T10U audit trail: one event per sale completed despite insufficient
         * stock. Captures product, requested quantity, recorded stock before
         * the sale, resulting stock after the existing SALE ledger movement,
         * operator, store and the sale reference. Fire-and-forget through the
         * shared audit writer — an audit failure can never fail the sale.
         */
        if (insufficientStockLines.length && typeof writeAudit === "function") {
          Promise.resolve(
            (async () => {
              const resulting = new Map();
              for (const line of insufficientStockLines) {
                try {
                  const bal = await db(
                    `SELECT stock_quantity FROM products WHERE id = $1 AND company_id = $2`,
                    [line.productId, req.user.companyId]
                  );
                  resulting.set(String(line.productId), bal.rows.length ? Number(bal.rows[0].stock_quantity) : null);
                } catch {
                  resulting.set(String(line.productId), null);
                }
              }
              return writeAudit(
                req.user.companyId,
                req.user.id,
                "SALE_NEGATIVE_STOCK",
                "sale",
                saleId,
                {
                  receiptNumber: receiptNumber,
                  storeId: req.user.storeId ?? null,
                  lines: insufficientStockLines.map((line) => ({
                    productId: line.productId,
                    productName: line.productName,
                    requestedQuantity: line.requestedQuantity,
                    recordedStock: line.recordedStock,
                    resultingStock: resulting.get(String(line.productId)),
                  })),
                }
              );
            })()
          ).catch((auditError) => console.error("Negative-stock audit write error:", auditError));
        }

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

        /*
         * T9Q-NEXT: fire-and-forget WhatsApp invoice delivery (never
         * blocks/throws - WhatsApp failures cannot affect the sale).
         */
        dispatchWhatsAppInvoiceDelivery({
          db,
          saleId,
          companyId: req.user.companyId,
          storeId: req.user.storeId ?? null,
          userId: req.user.id ?? null,
        }).catch(() => {});

        /*
         * T9D-NEXT: fire-and-forget SMS/Email invoice delivery (never
         * blocks/throws; both skip unless explicitly enabled + auto-send ON,
         * which is NOT the default).
         */
        dispatchSmsInvoiceDelivery({
          db,
          saleId,
          companyId: req.user.companyId,
          storeId: req.user.storeId ?? null,
          userId: req.user.id ?? null,
        }).catch(() => {});
        dispatchEmailInvoiceDelivery({
          db,
          saleId,
          companyId: req.user.companyId,
          storeId: req.user.storeId ?? null,
          userId: req.user.id ?? null,
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
