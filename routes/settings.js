import express from "express";

import {
  loadPlatformConfig,
  buildStoredConfiguration,
  maskConfiguration,
  sanitizeUberStoreMappings,
  sanitizeUberStoreMenuMappings,
} from "../services/onlineOrders/platformConfig.js";
import { UBER_MENU_MAPPING_SCHEMA } from "../services/onlineOrders/uberMenuMapping.js";
import {
  JARVES_ALLOWANCE_RESULTS,
  getJarvesLicenceState,
  isJarvesEnabledForUser,
  normalizeJarvesAllowance,
  setJarvesAllowance,
} from "../services/jarvis/licensing.js";
import { destinationFor, isValidLandingPage, normalizeDeviceProfile } from "../services/runtimeAccess.js";
import { listPaymentMethods, ensureDefaultPaymentMethods } from "../services/paymentMethods.js";
import { executeWorkflowAction } from "../services/platformWorkflow.js";

export default function createSettingsRouter({
  authenticate,
  authorize,
  db,
  pool,
  writeAudit,
  testPaymentTerminal,
  requireLoyaltyEntitlement = null,
}) {
  const router = express.Router();

  router.get("/settings/payment-methods", authenticate, async (req, res) => {
    try {
      await ensureDefaultPaymentMethods(db, req.user.companyId);
      res.json({ success: true, data: await listPaymentMethods(db, req.user.companyId, { activeOnly: false }) });
    } catch (error) {
      console.error("Payment methods load error:", error?.message || error);
      res.status(500).json({ success: false, message: "Unable to load payment methods" });
    }
  });


  router.get("/settings/runtime", authenticate, async (req, res) => {
    try {
      const result = await db(
        `SELECT cs.default_landing_page, cs.landing_flow, r.default_landing_page AS role_default_landing_page,
                t.app_profile, up.preferences
         FROM users u
         LEFT JOIN company_settings cs ON cs.company_id=u.company_id
         LEFT JOIN roles r ON r.id=u.role_id AND r.company_id=u.company_id
         LEFT JOIN terminals t ON t.store_id=u.store_id AND t.active=true
         LEFT JOIN user_preferences up ON up.user_id=u.id
         WHERE u.id=$1 AND u.company_id=$2
         ORDER BY t.created_at
         LIMIT 1`,
        [req.user.id, req.user.companyId]
      );
      const row = result.rows[0] || {};
      const preferences = row.preferences && typeof row.preferences === "object" ? row.preferences : {};
      res.json({
        success: true,
        data: {
          companyDefault: destinationFor(row.default_landing_page)?.key || "dashboard",
          roleDefault: destinationFor(row.role_default_landing_page)?.key || null,
          deviceProfile: normalizeDeviceProfile(row.app_profile),
          userOverride: destinationFor(preferences.landingPage)?.key || null,
          landingFlow: row.landing_flow && typeof row.landing_flow === "object" ? row.landing_flow : { rules: [], defaultDestination: "/app/dashboard" },
        },
      });
    } catch (error) {
      console.error("Runtime settings load error:", error?.message || error);
      res.status(500).json({ success: false, message: "Unable to load runtime settings" });
    }
  });

  router.put("/settings/runtime", authenticate, authorize("settings.manage"), async (req, res) => {
    const { companyDefault, roleDefault, appProfile, landingFlow } = req.body || {};
    if (!isValidLandingPage(companyDefault) || (roleDefault != null && !isValidLandingPage(roleDefault))) {
      return res.status(400).json({ success: false, message: "Landing page must be a permitted runtime destination" });
    }
    const profile = normalizeDeviceProfile(appProfile);
    try {
      await db(
        `INSERT INTO company_settings (company_id, default_landing_page, updated_by, updated_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (company_id) DO UPDATE SET default_landing_page=$2, updated_by=$3, updated_at=NOW()`,
        [req.user.companyId, destinationFor(companyDefault).key, req.user.id]
      );
      if (landingFlow !== undefined) {
        const flow = landingFlow && typeof landingFlow === "object" && !Array.isArray(landingFlow) ? landingFlow : null;
        if (!flow || !Array.isArray(flow.rules)) return res.status(400).json({ success: false, message: "Landing flow must contain a rules array" });
        await db("UPDATE company_settings SET landing_flow=$1::jsonb, updated_by=$2, updated_at=NOW() WHERE company_id=$3", [JSON.stringify(flow), req.user.id, req.user.companyId]);
      }
      if (roleDefault !== undefined) {
        await db("UPDATE roles SET default_landing_page=$1 WHERE id=$2 AND company_id=$3", [roleDefault ? destinationFor(roleDefault).key : null, req.user.roleId, req.user.companyId]);
      }
      if (req.user.storeId) {
        await db("UPDATE terminals SET app_profile=$1 WHERE store_id=$2 AND active=true", [profile, req.user.storeId]);
      }
      res.json({ success: true, data: { companyDefault, roleDefault: roleDefault || null, appProfile: profile, landingFlow: landingFlow ?? undefined } });
    } catch (error) {
      console.error("Runtime settings update error:", error?.message || error);
      res.status(500).json({ success: false, message: "Unable to save runtime settings" });
    }
  });

  router.patch("/settings/runtime/user", authenticate, async (req, res) => {
    const { landingPage } = req.body || {};
    if (landingPage != null && !isValidLandingPage(landingPage)) {
      return res.status(400).json({ success: false, message: "Landing page must be a permitted runtime destination" });
    }
    try {
      await db(
        `INSERT INTO user_preferences (user_id, preferences, updated_at)
         VALUES ($1, jsonb_build_object('landingPage', $2::text), NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           preferences=CASE WHEN $2::text IS NULL THEN user_preferences.preferences - 'landingPage'
                            ELSE jsonb_set(user_preferences.preferences, '{landingPage}', to_jsonb($2::text), true) END,
           updated_at=NOW()`,
        [req.user.id, landingPage == null ? null : destinationFor(landingPage).key]
      );
      res.json({ success: true, data: { userOverride: landingPage == null ? null : destinationFor(landingPage).key } });
    } catch (error) {
      console.error("User runtime setting update error:", error?.message || error);
      res.status(500).json({ success: false, message: "Unable to save user runtime setting" });
    }
  });

  /*
   * JARVES licence control (see services/jarvis/licensing.js).
   *
   *   GET /api/settings/jarves  - licence state for the caller's company
   *                               (settings.manage OR user.view: the users
   *                               admin page uses it to show seat usage).
   *   PUT /api/settings/jarves  - set the company allowance (settings.manage).
   *
   * Refusing to lower the allowance below the enabled count guarantees
   * existing JARVES users are never silently disabled.
   */
  router.get("/settings/jarves", authenticate, authorize("settings.manage", "user.view"), async (req, res) => {
    try {
      const state = await getJarvesLicenceState(db, req.user.companyId);
      const enabledForMe = await isJarvesEnabledForUser(db, {
        userId: req.user.id,
        companyId: req.user.companyId,
      });
      res.json({ success: true, data: { ...state, enabledForMe } });
    } catch (error) {
      console.error("JARVES licence state error:", error?.message || error);
      res.status(500).json({ success: false, message: "Unable to load JARVES licence state" });
    }
  });

  router.put("/settings/jarves", authenticate, authorize("settings.manage"), async (req, res) => {
    try {
      if (normalizeJarvesAllowance(req.body?.allowance) == null) {
        return res.status(400).json({ success: false, message: "A whole-number \"allowance\" between 0 and 10000 is required" });
      }
      const result = await setJarvesAllowance(db, req.user.companyId, req.body.allowance, req.user.id);
      if (result === JARVES_ALLOWANCE_RESULTS.ALLOWANCE_BELOW_ENABLED) {
        const state = await getJarvesLicenceState(db, req.user.companyId);
        return res.status(409).json({
          success: false,
          code: "jarves_allowance_below_enabled",
          message: `Cannot set the allowance below the number of users already enabled (${state.enabledUsers}). Disable JARVES for some users first - no user is disabled automatically.`,
        });
      }
      const state = await getJarvesLicenceState(db, req.user.companyId);
      res.json({ success: true, message: "JARVES licence updated", data: state });
    } catch (error) {
      console.error("JARVES licence update error:", error?.message || error);
      res.status(500).json({ success: false, message: "Unable to save JARVES licence" });
    }
  });

  router.get("/settings/jarves/behaviours", authenticate, authorize("settings.manage", "user.view"), async (req, res) => {
    try {
      const result = await db("SELECT jarves_behaviour_media FROM company_settings WHERE company_id=$1", [req.user.companyId]);
      const defaults = { behaviour_1: "/jarves.mp4", behaviour_2: "/jarves.mp4", behaviour_3: "/jarves.mp4" };
      res.json({ success: true, data: { ...defaults, ...(result.rows[0]?.jarves_behaviour_media || {}) } });
    } catch (error) {
      console.error("JARVES behaviour settings error:", error?.message || error);
      res.status(500).json({ success: false, message: "Unable to load JARVES behaviour settings" });
    }
  });

  router.put("/settings/jarves/behaviours", authenticate, authorize("settings.manage"), async (req, res) => {
    try {
      const keys = ["behaviour_1", "behaviour_2", "behaviour_3"];
      const media = Object.fromEntries(keys.map((key) => [key, String(req.body?.[key] || "/jarves.mp4").trim()]));
      if (Object.values(media).some((value) => !value.startsWith("/") && !/^https:\/\//i.test(value))) {
        return res.status(400).json({ success: false, message: "JARVES media must be an app path or HTTPS URL" });
      }
      await db(`INSERT INTO company_settings (company_id, jarves_behaviour_media, updated_by, updated_at) VALUES ($1,$2::jsonb,$3,NOW())
        ON CONFLICT (company_id) DO UPDATE SET jarves_behaviour_media=$2::jsonb, updated_by=$3, updated_at=NOW()`, [req.user.companyId, JSON.stringify(media), req.user.id]);
      res.json({ success: true, data: media });
    } catch (error) {
      console.error("JARVES behaviour settings update error:", error?.message || error);
      res.status(500).json({ success: false, message: "Unable to save JARVES behaviour settings" });
    }
  });

  router.get("/settings", authenticate, async (req, res) => {
    try {
      const result = await db(
        `
        SELECT
          c.id AS company_id, c.name AS company_name, c.legal_name, c.email AS company_email, c.phone AS company_phone, c.currency, c.timezone, c.logo_url,
          cs.date_format, cs.vat_enabled, cs.default_vat_rate, cs.loyalty_enabled, cs.loyalty_earning_rate,
          cs.loyalty_min_sale_total, cs.loyalty_redeem_value_per_point, cs.loyalty_min_points_redeem,
          cs.allow_negative_inventory_billing,
          cs.scan_go_enabled, cs.exchange_mode, cs.online_ordering_enabled, cs.online_payment_methods,
          cs.product_view, cs.dock_quick_access,
          cs.customer_display_enabled,
          s.id AS store_id, s.name AS store_name,
          t.id AS till_id, t.name AS till_name, t.terminal_number
        FROM companies c
        LEFT JOIN company_settings cs ON cs.company_id = c.id
        LEFT JOIN stores s ON s.id = $2 AND s.company_id = c.id
        LEFT JOIN terminals t ON t.store_id = s.id AND t.active = true
        WHERE c.id = $1
        ORDER BY t.created_at
        LIMIT 1
        `,
        [req.user.companyId, req.user.storeId]
      );

      if (!result.rows.length) {
        return res.status(404).json({ success: false, message: "Company settings not found" });
      }

      const settings = result.rows[0];
      res.json({
        success: true,
        data: {
          company: {
            id: settings.company_id,
            name: settings.company_name,
            legalName: settings.legal_name,
            email: settings.company_email,
            phone: settings.company_phone,
            currency: settings.currency,
            timezone: settings.timezone,
            logoUrl: settings.logo_url || null,
          },
          general: {
            dateFormat: settings.date_format || "DD/MM/YYYY",
          },
          tax: {
            vatEnabled: settings.vat_enabled ?? true,
            defaultVatRate: Number(settings.default_vat_rate ?? 20),
          },
          inventory: {
            /* T10U: negative-inventory billing safety — OFF unless explicitly enabled. */
            allowNegativeInventoryBilling: settings.allow_negative_inventory_billing === true,
            batchInventoryMode: settings.batch_inventory_mode || "none",
            batchDefaultMfgRule: settings.batch_default_mfg_rule || "none",
            batchDefaultExpiryRule: settings.batch_default_expiry_rule || "none",
            batchDefaultExpiryDays: Number(settings.batch_default_expiry_days || 365),
          },
          loyalty: {
            enabled: settings.loyalty_enabled ?? false,
            earningRate: Number(settings.loyalty_earning_rate ?? 0.0100),
            /* T10R: redemption economics + minimum qualifying sale.
             * null = feature not configured (redemption UI must treat a
             * null redeem value as "redemption not configured"). */
            minSaleTotal: settings.loyalty_min_sale_total == null ? null : Number(settings.loyalty_min_sale_total),
            redeemValuePerPoint: settings.loyalty_redeem_value_per_point == null ? null : Number(settings.loyalty_redeem_value_per_point),
            minPointsRedeem: settings.loyalty_min_points_redeem == null ? null : Number(settings.loyalty_min_points_redeem),
          },
          scanGo: {
            enabled: settings.scan_go_enabled ?? false,
          },
          exchange: {
            /* receipt | normal | both (default). The till Exchange workflow
               and POST /api/returns/exchanges enforce this server-side. */
            mode: ["receipt", "normal", "both"].includes(settings.exchange_mode)
              ? settings.exchange_mode
              : "both",
          },
          till: {
            id: settings.till_id,
            name: settings.till_name,
            terminalNumber: settings.terminal_number,
            /* Till product browser presentation: 'image' | 'compact'. */
            productView: settings.product_view === "compact" ? "compact" : "image",
          },
          /* Configurable sale invoice/receipt prefixes per sale source.
             Defaults TO / DEL / SC; till + self-checkout receipts keep the
             existing PREFIX-YYYYMMDD-NNNN sequencing, delivery receipts
             become PREFIX-<platform external order id>. */
          invoicePrefixes: {
            till: settings.till_invoice_prefix || "TO",
            delivery: settings.delivery_invoice_prefix || "DEL",
            selfCheckout: settings.self_checkout_invoice_prefix || "SC",
          },
          /* Admin dock quick-access (T10W): pages shown directly on the
             bottom bar. Ordered; validated on save; launcher always shows
             every permitted page regardless of this list. */
          dock: {
            quickAccess: Array.isArray(settings.dock_quick_access)
              ? settings.dock_quick_access
              : ["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports"],
          },
          /* Customer Display (second monitor): master ON/OFF. When OFF the
             till shows no entry point and the /customer-display page refuses
             to connect. */
          customerDisplay: {
            enabled: settings.customer_display_enabled === true,
          },
          onlineOrdering: {
            enabled: settings.online_ordering_enabled ?? false,
            paymentMethods: Array.isArray(settings.online_payment_methods) ? settings.online_payment_methods : ["card", "cash", "cod"],
          },
          store: {
            id: settings.store_id,
            name: settings.store_name,
          },
        },
      });
    } catch (error) {
      console.error("Load settings error:", error);
      res.status(500).json({ success: false, message: "Unable to load settings" });
    }
  });

  /*
   * T10U — Negative Inventory Billing safety setting.
   * Admin/Owner control ONLY: gated by the existing settings.manage
   * permission (Administrator/Admin/Owner bypass applies unchanged via
   * authorize). Every change is audited with the previous value.
   */
  router.put("/settings/negative-inventory-billing", authenticate, authorize("settings.manage"), async (req, res) => {
    const enabled = req.body.enabled === true;
    if (!pool) {
      return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    }

    /* Strong confirmation: an enabling request must carry the exact
       acknowledgement string (the settings UI shows the same warning). */
    if (enabled && req.body.acknowledged !== true) {
      return res.status(400).json({
        success: false,
        message: "Enabling negative-inventory billing requires explicit acknowledgement of the warning",
      });

      router.put("/settings/batch-policy", authenticate, authorize("settings.manage"), async (req, res) => {
        const { batchInventoryMode = "none", batchDefaultMfgRule = "none", batchDefaultExpiryRule = "none", batchDefaultExpiryDays = 365 } = req.body || {};
        const modes = ["required_dates", "optional_dates", "none"];
        const rules = ["none", "today", "today_plus_days"];
        const days = Math.floor(Number(batchDefaultExpiryDays));
        if (!modes.includes(batchInventoryMode) || !rules.includes(batchDefaultMfgRule) || !rules.includes(batchDefaultExpiryRule) || !Number.isFinite(days) || days < 0 || days > 3650) {
          return res.status(400).json({ success: false, message: "Invalid batch inventory policy" });
        }
        try {
          await db(
            `INSERT INTO company_settings (company_id, batch_inventory_mode, batch_default_mfg_rule, batch_default_expiry_rule, batch_default_expiry_days, updated_by, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,NOW())
             ON CONFLICT (company_id) DO UPDATE SET batch_inventory_mode=$2, batch_default_mfg_rule=$3, batch_default_expiry_rule=$4, batch_default_expiry_days=$5, updated_by=$6, updated_at=NOW()`,
            [req.user.companyId, batchInventoryMode, batchDefaultMfgRule, batchDefaultExpiryRule, days, req.user.id]
          );
          res.json({ success: true, data: { batchInventoryMode, batchDefaultMfgRule, batchDefaultExpiryRule, batchDefaultExpiryDays: days } });
        } catch (error) {
          console.error("Update batch policy error:", error);
          res.status(500).json({ success: false, message: "Unable to update batch inventory policy" });
        }
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const previous = await client.query(
        "SELECT allow_negative_inventory_billing FROM company_settings WHERE company_id=$1 FOR UPDATE",
        [req.user.companyId]
      );
      const previousValue = previous.rows.length ? previous.rows[0].allow_negative_inventory_billing === true : false;

      if (previousValue === enabled) {
        await client.query("COMMIT");
        return res.json({ success: true, message: enabled ? "Already enabled" : "Already disabled", data: { enabled } });
      }

      await client.query(
        `
        INSERT INTO company_settings (company_id, allow_negative_inventory_billing, updated_by, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (company_id) DO UPDATE SET
          allow_negative_inventory_billing = $2, updated_by = $3, updated_at = NOW()
        `,
        [req.user.companyId, enabled, req.user.id]
      );

      /* Audit: setting change (previous + new value, who, when). */
      await client.query(
        `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details)
         VALUES ($1,$2,'inventory.negative_billing_setting','company',$1,$3)`,
        [
          req.user.companyId,
          req.user.id,
          JSON.stringify({ enabled, previousValue, storeId: req.user.storeId ?? null }),
        ]
      );

      await client.query("COMMIT");
      res.json({ success: true, message: enabled ? "Negative-inventory billing enabled" : "Negative-inventory billing disabled", data: { enabled } });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("Negative-inventory billing setting error:", error);
      res.status(500).json({ success: false, message: "Unable to update the setting" });
    } finally {
      client.release();
    }
  });

  router.put("/settings", authenticate, ...(requireLoyaltyEntitlement ? [requireLoyaltyEntitlement] : []), async (req, res) => {
    const {
      companyName,
      legalName,
      companyEmail,
      companyPhone,
      currency,
      timezone,
      dateFormat,
      vatEnabled,
      defaultVatRate,
      loyaltyEnabled,
      loyaltyEarningRate,
      loyaltyMinSaleTotal,
      loyaltyRedeemValuePerPoint,
      loyaltyMinPointsRedeem,
      scanGoEnabled,
      exchangeMode,
      productView,
      dockQuickAccess,
      customerDisplayEnabled,
      onlineOrderingEnabled,
      onlinePaymentMethods,
      invoicePrefixes,
      batchInventoryMode,
      batchDefaultMfgRule,
      batchDefaultExpiryRule,
      batchDefaultExpiryDays,
      logoUrl = null,
    } = req.body;

    if (!companyName || !String(companyName).trim()) {
      return res.status(400).json({ success: false, message: "Company name is required" });
    }

    const vatRate = Number(defaultVatRate);
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return res.status(400).json({ success: false, message: "VAT rate must be between 0 and 100" });
    }

    // Validate loyalty earning rate
    if (loyaltyEarningRate !== undefined && loyaltyEarningRate !== null) {
      const earningRate = Number(loyaltyEarningRate);
      if (!Number.isFinite(earningRate) || earningRate < 0 || earningRate > 1) {
        return res.status(400).json({ success: false, message: "Loyalty earning rate must be between 0 and 1 (0% to 100%)" });
      }
    }

    /* T10R: loyalty redemption economics + minimum qualifying sale.
     * Optional (null/omitted = not configured); normalised to numbers here
     * so the INSERT binds clean numerics. */
    let loyaltyMinSaleTotalNorm = null;
    if (loyaltyMinSaleTotal !== undefined && loyaltyMinSaleTotal !== null) {
      const minSale = Number(loyaltyMinSaleTotal);
      if (!Number.isFinite(minSale) || minSale < 0) {
        return res.status(400).json({ success: false, message: "Loyalty minimum sale total must be a non-negative number" });
      }
      loyaltyMinSaleTotalNorm = minSale;
    }
    let loyaltyRedeemValueNorm = null;
    if (loyaltyRedeemValuePerPoint !== undefined && loyaltyRedeemValuePerPoint !== null) {
      const redeemValue = Number(loyaltyRedeemValuePerPoint);
      if (!Number.isFinite(redeemValue) || redeemValue < 0) {
        return res.status(400).json({ success: false, message: "Loyalty redemption value per point must be a non-negative number" });
      }
      loyaltyRedeemValueNorm = redeemValue;
    }
    let loyaltyMinPointsNorm = null;
    if (loyaltyMinPointsRedeem !== undefined && loyaltyMinPointsRedeem !== null) {
      const minPoints = Math.floor(Number(loyaltyMinPointsRedeem));
      if (!Number.isFinite(minPoints) || minPoints < 0) {
        return res.status(400).json({ success: false, message: "Loyalty minimum points for redemption must be a non-negative integer" });
      }
      loyaltyMinPointsNorm = minPoints;
    }

    // Validate till product view (T10Q: image | compact; default image)
    if (productView !== undefined && productView !== null && !["image", "compact"].includes(productView)) {
      return res.status(400).json({ success: false, message: "Till product view must be 'image' or 'compact'" });
    }

    // Validate exchange mode (receipt | normal | both; default both)
    const EXCHANGE_MODES = ["receipt", "normal", "both"];
    const exchangeModeNorm = exchangeMode === undefined || exchangeMode === null
      ? undefined
      : String(exchangeMode).trim().toLowerCase();
    if (exchangeModeNorm !== undefined && !EXCHANGE_MODES.includes(exchangeModeNorm)) {
      return res.status(400).json({ success: false, message: "Exchange mode must be 'receipt', 'normal' or 'both'" });
    }
    const batchModes = ["required_dates", "optional_dates", "none"];
    const dateRules = ["none", "today", "today_plus_days"];
    if (batchInventoryMode !== undefined && !batchModes.includes(batchInventoryMode)) {
      return res.status(400).json({ success: false, message: "Invalid batch inventory mode" });
    }
    if (batchDefaultMfgRule !== undefined && !dateRules.includes(batchDefaultMfgRule)) {
      return res.status(400).json({ success: false, message: "Invalid default manufacturing date rule" });
    }
    if (batchDefaultExpiryRule !== undefined && !dateRules.includes(batchDefaultExpiryRule)) {
      return res.status(400).json({ success: false, message: "Invalid default expiry date rule" });
    }
    const batchDays = batchDefaultExpiryDays === undefined ? null : Math.floor(Number(batchDefaultExpiryDays));
    if (batchDays !== null && (!Number.isFinite(batchDays) || batchDays < 0 || batchDays > 3650)) {
      return res.status(400).json({ success: false, message: "Default expiry days must be between 0 and 3650" });
    }

    // Validate dock quick-access list (T10W): array of known admin page
    // names, no duplicates, max 8 (dock stays touch-sized on 15").
    if (dockQuickAccess !== undefined && dockQuickAccess !== null) {
      if (!Array.isArray(dockQuickAccess)) {
        return res.status(400).json({ success: false, message: "Dock quick access must be an array of page names" });
      }
      const knownPages = new Set([
        "Dashboard", "Sales", "Returns", "Supplier Returns", "Order Prep", "Payments", "Open Till",
        "Products", "Global Products", "Categories", "Purchases", "Suppliers", "Inventory", "Replenishment",
        "Customers", "Employees", "Stores", "Reports", "Integrations", "Accounting", "Settings",
      ]);
      if (dockQuickAccess.length > 8 || new Set(dockQuickAccess).size !== dockQuickAccess.length ||
          dockQuickAccess.some((p) => !knownPages.has(p))) {
        return res.status(400).json({ success: false, message: "Dock quick access must be up to 8 unique known page names" });
      }
    }

    // customerDisplayEnabled (Customer Display master switch): boolean only.
    if (customerDisplayEnabled !== undefined && customerDisplayEnabled !== null
        && typeof customerDisplayEnabled !== "boolean") {
      return res.status(400).json({ success: false, message: "customerDisplayEnabled must be a boolean" });
    }

    // Validate invoice prefixes (configurable receipt prefixes per sale
    // source): uppercase alphanumeric, 1-10 chars. null/undefined = keep.
    if (invoicePrefixes !== undefined && invoicePrefixes !== null) {
      if (typeof invoicePrefixes !== "object" || Array.isArray(invoicePrefixes)) {
        return res.status(400).json({ success: false, message: "invoicePrefixes must be an object" });
      }
      const prefixFields = ["till", "delivery", "selfCheckout"];
      for (const field of prefixFields) {
        const value = invoicePrefixes[field];
        if (value === undefined || value === null) continue;
        if (typeof value !== "string" || !/^[A-Za-z0-9]{1,10}$/.test(value.trim())) {
          return res.status(400).json({ success: false, message: `Invoice prefix for ${field} must be 1-10 letters/numbers` });
        }
      }
    }

    // Validate online payment methods
    if (onlinePaymentMethods !== undefined && onlinePaymentMethods !== null) {
      if (!Array.isArray(onlinePaymentMethods)) {
        return res.status(400).json({ success: false, message: "Online payment methods must be an array" });
      }
      const validMethods = ["card", "cash", "cod"];
      const invalidMethods = onlinePaymentMethods.filter((m) => !validMethods.includes(m));
      if (invalidMethods.length > 0) {
        return res.status(400).json({ success: false, message: `Invalid payment methods: ${invalidMethods.join(", ")}` });
      }
    }

    if (!pool) {
      return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE companies SET name = $1, legal_name = $2, email = $3, phone = $4, currency = $5, timezone = $6, logo_url = $7, updated_at = NOW() WHERE id = $8`,
        [String(companyName).trim(), legalName || null, companyEmail || null, companyPhone || null, currency || "GBP", timezone || "Europe/London", logoUrl || null, req.user.companyId]
      );
      /* COALESCE($6/$9/$10) in VALUES: those columns are NOT NULL with row
         defaults, and an INSERT ... VALUES clause may not reference existing
         row columns — that is what made every settings save fail with
         "column \"dock_quick_access\" does not exist" (HTTP 500). Omitted
         fields fall back to the column default on insert; the ON CONFLICT
         arm below keeps the stored value on update. */
      await client.query(
        `
        INSERT INTO company_settings (company_id, date_format, vat_enabled, default_vat_rate, loyalty_enabled, loyalty_earning_rate, loyalty_min_sale_total, loyalty_redeem_value_per_point, loyalty_min_points_redeem, scan_go_enabled, exchange_mode, product_view, dock_quick_access, customer_display_enabled, online_ordering_enabled, online_payment_methods, till_invoice_prefix, delivery_invoice_prefix, self_checkout_invoice_prefix, updated_by, updated_at)
        VALUES ($1,$2,$3,$4,$5,COALESCE($6, 0.0100),$7::numeric,$8::numeric,$9::integer,$10,COALESCE($11, 'both'),COALESCE($12, 'image'),COALESCE($13::jsonb, '["Dashboard", "Sales", "Products", "Inventory", "Customers", "Reports"]'::jsonb),COALESCE($14, false),$15,COALESCE($16::jsonb, '["card", "cash", "cod"]'::jsonb),COALESCE($17,'TO'),COALESCE($18,'DEL'),COALESCE($19,'SC'),$20,NOW())
        ON CONFLICT (company_id) DO UPDATE SET date_format=$2, vat_enabled=$3, default_vat_rate=$4, loyalty_enabled=$5, loyalty_earning_rate=COALESCE($6, company_settings.loyalty_earning_rate), loyalty_min_sale_total=COALESCE($7::numeric, company_settings.loyalty_min_sale_total), loyalty_redeem_value_per_point=COALESCE($8::numeric, company_settings.loyalty_redeem_value_per_point), loyalty_min_points_redeem=COALESCE($9::integer, company_settings.loyalty_min_points_redeem), scan_go_enabled=$10, exchange_mode=COALESCE($11, company_settings.exchange_mode), product_view=COALESCE($12, company_settings.product_view), dock_quick_access=COALESCE($13::jsonb, company_settings.dock_quick_access), customer_display_enabled=COALESCE($14, company_settings.customer_display_enabled), online_ordering_enabled=$15, online_payment_methods=COALESCE($16::jsonb, company_settings.online_payment_methods), till_invoice_prefix=COALESCE($17, company_settings.till_invoice_prefix), delivery_invoice_prefix=COALESCE($18, company_settings.delivery_invoice_prefix), self_checkout_invoice_prefix=COALESCE($19, company_settings.self_checkout_invoice_prefix), updated_by=$20, updated_at=NOW()
        `,
        [
          req.user.companyId,
          dateFormat || "DD/MM/YYYY",
          vatEnabled !== false,
          vatRate,
          loyaltyEnabled !== false,
          loyaltyEarningRate !== undefined ? loyaltyEarningRate : null,
          loyaltyMinSaleTotalNorm,
          loyaltyRedeemValueNorm,
          loyaltyMinPointsNorm,
          scanGoEnabled === true,
          exchangeModeNorm || null,
          productView === "compact" ? "compact" : productView === "image" ? "image" : null,
          Array.isArray(dockQuickAccess) ? JSON.stringify(dockQuickAccess) : null,
          typeof customerDisplayEnabled === "boolean" ? customerDisplayEnabled : null,
          onlineOrderingEnabled === true,
          onlinePaymentMethods !== undefined ? JSON.stringify(onlinePaymentMethods) : null,
          /* Invoice prefixes: per-source objects only; null = keep existing. */
          invoicePrefixes && typeof invoicePrefixes === "object" && !Array.isArray(invoicePrefixes)
            ? (typeof invoicePrefixes.till === "string" ? invoicePrefixes.till.trim().toUpperCase() : null)
            : null,
          invoicePrefixes && typeof invoicePrefixes === "object" && !Array.isArray(invoicePrefixes)
            ? (typeof invoicePrefixes.delivery === "string" ? invoicePrefixes.delivery.trim().toUpperCase() : null)
            : null,
          invoicePrefixes && typeof invoicePrefixes === "object" && !Array.isArray(invoicePrefixes)
            ? (typeof invoicePrefixes.selfCheckout === "string" ? invoicePrefixes.selfCheckout.trim().toUpperCase() : null)
            : null,
          req.user.id
        ]
      );
      await client.query(
        `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'settings.updated','company',$1,$3)`,
        [req.user.companyId, req.user.id, JSON.stringify({ currency, timezone, dateFormat, vatEnabled, defaultVatRate: vatRate, loyaltyEnabled, loyaltyEarningRate, scanGoEnabled, productView, dockQuickAccess, customerDisplayEnabled, onlineOrderingEnabled, onlinePaymentMethods, invoicePrefixes })]
      );
      await client.query("COMMIT");
      res.json({ success: true, message: "Settings updated" });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Update settings error:", error);
      res.status(500).json({ success: false, message: "Unable to update settings" });
    } finally {
      client.release();
    }
  });

  router.get("/payment-terminals", authenticate, async (req, res) => {
    try {
      const result = await db(
        `
        SELECT id, store_id, provider, name, terminal_identifier, connection_url,
          active, (api_credentials IS NOT NULL AND api_credentials <> '') AS has_credentials,
          last_test_result, last_tested_at, created_at, updated_at
        FROM payment_terminals
        WHERE company_id = $1
        ORDER BY name
        `,
        [req.user.companyId]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Load payment terminals error:", error);
      res.status(500).json({ success: false, message: "Unable to load payment terminals" });
    }
  });

  router.post("/payment-terminals", authenticate, async (req, res) => {
    const { provider, name, terminalIdentifier = null, connectionUrl = null, apiCredentials = null, storeId = null } = req.body;
    if (!provider || !name) return res.status(400).json({ success: false, message: "Provider and terminal name are required" });
    try {
      const result = await db(
        `INSERT INTO payment_terminals (company_id, store_id, provider, name, terminal_identifier, connection_url, api_credentials) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, store_id, provider, name, terminal_identifier, connection_url, active`,
        [req.user.companyId, storeId || req.user.storeId, String(provider).trim(), String(name).trim(), terminalIdentifier || null, connectionUrl || null, apiCredentials || null]
      );
      await writeAudit(req.user.companyId, req.user.id, "payment_terminal.created", "payment_terminal", result.rows[0].id, { provider, name });
      res.status(201).json({ success: true, message: "Payment terminal created", data: result.rows[0] });
    } catch (error) {
      console.error("Create payment terminal error:", error);
      res.status(500).json({ success: false, message: "Unable to create payment terminal" });
    }
  });

  router.put("/payment-terminals/:id", authenticate, async (req, res) => {
    const { provider, name, terminalIdentifier = null, connectionUrl = null, apiCredentials, active = true } = req.body;
    try {
      const existing = await db("SELECT api_credentials FROM payment_terminals WHERE id = $1 AND company_id = $2", [req.params.id, req.user.companyId]);
      if (!existing.rows.length) return res.status(404).json({ success: false, message: "Payment terminal not found" });
      const credentials = apiCredentials ? apiCredentials : existing.rows[0].api_credentials;
      const result = await db(
        `UPDATE payment_terminals SET provider=$1, name=$2, terminal_identifier=$3, connection_url=$4, api_credentials=$5, active=$6, updated_at=NOW() WHERE id=$7 AND company_id=$8 RETURNING id, store_id, provider, name, terminal_identifier, connection_url, active, (api_credentials IS NOT NULL AND api_credentials <> '') AS has_credentials`,
        [provider, name, terminalIdentifier || null, connectionUrl || null, credentials, active !== false, req.params.id, req.user.companyId]
      );
      await writeAudit(req.user.companyId, req.user.id, "payment_terminal.updated", "payment_terminal", req.params.id, { provider, name, active: active !== false });
      res.json({ success: true, message: "Payment terminal updated", data: result.rows[0] });
    } catch (error) {
      console.error("Update payment terminal error:", error);
      res.status(500).json({ success: false, message: "Unable to update payment terminal" });
    }
  });

  router.post("/payment-terminals/:id/test", authenticate, async (req, res) => {
    try {
      const result = await db("SELECT * FROM payment_terminals WHERE id = $1 AND company_id = $2", [req.params.id, req.user.companyId]);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Payment terminal not found" });
      const test = await testPaymentTerminal(result.rows[0]);
      await db("UPDATE payment_terminals SET last_test_result=$1, last_tested_at=NOW() WHERE id=$2 AND company_id=$3", [test.message, req.params.id, req.user.companyId]);
      res.json({ success: true, data: test });
    } catch (error) {
      console.error("Test payment terminal error:", error);
      res.status(500).json({ success: false, message: "Unable to test payment terminal" });
    }
  });

  router.get("/hardware", authenticate, async (req, res) => {
    try {
      const result = await db(
        `SELECT id, store_id, device_type, device_name, connection_type, connection_address, paper_width, is_default, active, last_test_result, last_tested_at FROM hardware_configurations WHERE company_id=$1 AND store_id=$2 ORDER BY device_type`,
        [req.user.companyId, req.user.storeId]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Load hardware error:", error);
      res.status(500).json({ success: false, message: "Unable to load hardware configuration" });
    }
  });

  router.put("/hardware", authenticate, async (req, res) => {
    const { deviceType, deviceName = null, connectionType = null, connectionAddress = null, paperWidth = null, isDefault = false, active = false } = req.body;
    if (!["BARCODE_SCANNER", "CASH_DRAWER", "RECEIPT_PRINTER"].includes(deviceType)) return res.status(400).json({ success: false, message: "Invalid hardware type" });
    try {
      const result = await db(
        `INSERT INTO hardware_configurations (company_id, store_id, device_type, device_name, connection_type, connection_address, paper_width, is_default, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (company_id, store_id, device_type) DO UPDATE SET device_name=$4, connection_type=$5, connection_address=$6, paper_width=$7, is_default=$8, active=$9, updated_at=NOW() RETURNING id, store_id, device_type, device_name, connection_type, connection_address, paper_width, is_default, active, last_test_result, last_tested_at`,
        [req.user.companyId, req.user.storeId, deviceType, deviceName, connectionType, connectionAddress, paperWidth, isDefault, active]
      );
      await writeAudit(req.user.companyId, req.user.id, "hardware.updated", "hardware", result.rows[0].id, { deviceType, connectionType, active });
      res.json({ success: true, message: "Hardware configuration updated", data: result.rows[0] });
    } catch (error) {
      console.error("Update hardware error:", error);
      res.status(500).json({ success: false, message: "Unable to update hardware configuration" });
    }
  });

  router.post("/hardware/:type/test", authenticate, async (req, res) => {
    const allowed = ["BARCODE_SCANNER", "CASH_DRAWER", "RECEIPT_PRINTER"];
    if (!allowed.includes(req.params.type)) return res.status(400).json({ success: false, message: "Invalid hardware type" });
    const message = "Hardware integration not configured";
    try {
      const result = await db("SELECT id FROM hardware_configurations WHERE company_id=$1 AND store_id=$2 AND device_type=$3", [req.user.companyId, req.user.storeId, req.params.type]);
      if (result.rows.length) await db("UPDATE hardware_configurations SET last_test_result=$1, last_tested_at=NOW() WHERE id=$2 AND company_id=$3 AND store_id=$4", [message, result.rows[0].id, req.user.companyId, req.user.storeId]);
      res.json({ success: true, data: { status: "NOT_CONFIGURED", message } });
    } catch (error) {
      console.error("Test hardware error:", error);
      res.status(500).json({ success: false, message: "Unable to test hardware" });
    }
  });

  router.get("/health/integrations", authenticate, async (req, res) => {
    let database = "Unavailable";
    try { await db("SELECT 1"); database = "Connected"; } catch { database = "Unavailable"; }
    const terminals = await db("SELECT COUNT(*)::int AS count FROM payment_terminals WHERE company_id=$1 AND active=true", [req.user.companyId]);
    res.json({ success: true, data: { database, api: "Connected", paymentTerminal: terminals.rows[0].count ? "Configured" : "Not configured", barcodeScanner: "Not configured", cashDrawer: "Not configured", receiptPrinter: "Not configured" } });
  });

  /*
   * ------------------------------------------------------------------
   * Online platform configuration (Uber Eats / Deliveroo)
   *
   * Credentials/details are stored per company in the `integrations` table;
   * secret fields are encrypted at rest and never returned to the client.
   * The platform services read this configuration via
   * services/onlineOrders/platformConfig.js when real API calls are added.
   * ------------------------------------------------------------------
   */

  router.get(
    "/settings/online-platforms/uber/store-mappings",
    authenticate,
    authorize("online_orders.configure"),
    async (req, res) => {
      try {
        const [runtime, stores] = await Promise.all([
          loadPlatformConfig(db, req.user.companyId, "uber"),
          db(
            "SELECT id, name, code FROM stores WHERE company_id=$1 AND active=true ORDER BY name",
            [req.user.companyId]
          ),
        ]);
        res.json({
          success: true,
          data: {
            mappings: sanitizeUberStoreMappings(runtime.store_mappings || []),
            store_menu_mappings: sanitizeUberStoreMenuMappings(runtime.store_menu_mappings || []),
            onepos_stores: stores.rows.map(({ id, name, code }) => ({ id, name, code })),
          },
        });
      } catch (error) {
        console.error("Load Uber store mappings error:", error);
        res.status(500).json({ success: false, message: "Unable to load Uber store mappings" });
      }
    }
  );

  router.put(
    "/settings/online-platforms/uber/store-mappings",
    authenticate,
    authorize("online_orders.configure"),
    async (req, res) => {
      if (!pool) {
        return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
      }

      let mappings;
      let storeMenuMappings;
      try {
        mappings = sanitizeUberStoreMappings(req.body?.store_mappings);
        storeMenuMappings = req.body?.store_menu_mappings === undefined
          ? undefined
          : sanitizeUberStoreMenuMappings(req.body.store_menu_mappings);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }

      const companyId = req.user.companyId;
      let discovery;
      let storesResult;
      try {
        [discovery, storesResult] = await Promise.all([
          executeWorkflowAction({
            db,
            req,
            companyId,
            action: { type: "UBER_GET_STORES" },
          }),
          db("SELECT id FROM stores WHERE company_id=$1 AND active=true", [companyId]),
        ]);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message || "Unable to validate Uber store mappings" });
      }

      const uberRows = Array.isArray(discovery?.data?.stores)
        ? discovery.data.stores
        : Array.isArray(discovery?.data)
          ? discovery.data
          : [];
      const allowedUberStores = new Set(uberRows.map((store) => String(store.id || store.store_id || "")));
      const allowedOneposStores = new Set(storesResult.rows.map((store) => String(store.id)));
      if (discovery?.success !== true && (mappings.length || storeMenuMappings?.length)) {
        return res.status(400).json({ success: false, message: "Retrieve available Uber stores before saving mappings" });
      }
      for (const mapping of mappings) {
        if (!allowedUberStores.has(mapping.uber_store_id)) {
          return res.status(400).json({ success: false, message: `Uber store ${mapping.uber_store_id} is not available to this company connector` });
        }
        if (!allowedOneposStores.has(mapping.onepos_store_id)) {
          return res.status(400).json({ success: false, message: `onePOS store ${mapping.onepos_store_id} is not an active store for this company` });
        }
      }
      for (const menuConfiguration of storeMenuMappings || []) {
        if (!allowedUberStores.has(menuConfiguration.uber_store_id)) {
          return res.status(400).json({ success: false, message: `Uber store ${menuConfiguration.uber_store_id} is not available to this company connector` });
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query(
          "SELECT configuration, active FROM integrations WHERE company_id=$1 AND provider='uber' FOR UPDATE",
          [companyId]
        );
        const existingConfiguration = existing.rows[0]?.configuration || {};
        const configuration = buildStoredConfiguration({
          environment: existingConfiguration.environment || "sandbox",
          store_mappings: mappings,
          ...(storeMenuMappings === undefined ? {} : { store_menu_mappings: storeMenuMappings }),
        }, existingConfiguration);
        const result = await client.query(
          `INSERT INTO integrations (company_id,name,provider,configuration,active)
           VALUES ($1,'Uber Eats','uber',$2,$3)
           ON CONFLICT (company_id,provider) DO UPDATE SET
             configuration=EXCLUDED.configuration, updated_at=NOW()
           RETURNING id`,
          [companyId, JSON.stringify(configuration), existing.rows[0]?.active === true]
        );
        await writeAudit?.(
          companyId,
          req.user.id,
          "online_platform_store_mappings.updated",
          "integration",
          result.rows[0].id,
          { platform: "uber", count: mappings.length }
        );
        await client.query("COMMIT");
        return res.json({
          success: true,
          data: {
            store_mappings: mappings,
            store_menu_mappings: configuration.store_menu_mappings || [],
          },
        });
      } catch (error) {
        await client.query("ROLLBACK");
        if (["INVALID_UBER_STORE_MAPPINGS", "INVALID_UBER_STORE_MENU_MAPPINGS", "INVALID_MENU_MAPPING"].includes(error?.code)) {
          return res.status(400).json({ success: false, message: error.message });
        }
        console.error("Save Uber store mappings error:", error);
        return res.status(500).json({ success: false, message: "Unable to save Uber store mappings" });
      } finally {
        client.release();
      }
    }
  );

  router.get("/settings/online-platforms", authenticate, async (req, res) => {
    try {
      const names = { uber: "Uber Eats", deliveroo: "Deliveroo" };
      const data = [];

      for (const platform of ["uber", "deliveroo"]) {
        const runtime = await loadPlatformConfig(db, req.user.companyId, platform);

        data.push({
          platform,
          name: names[platform],
          enabled: runtime.enabled === true,
          ...maskConfiguration(runtime),
          ...(platform === "uber" ? { menu_mapping_schema: UBER_MENU_MAPPING_SCHEMA } : {}),
        });
      }

      res.json({ success: true, data });
    } catch (error) {
      console.error("Load online platform settings error:", error);
      res.status(500).json({ success: false, message: "Unable to load online platform settings" });
    }
  });

  router.put("/settings/online-platforms/:platform", authenticate, async (req, res) => {
    const platform = req.params.platform;
    const names = { uber: "Uber Eats", deliveroo: "Deliveroo" };

    if (!names[platform]) {
      return res.status(400).json({ success: false, message: "Platform must be 'uber' or 'deliveroo'" });
    }

    if (!pool) {
      return res.status(500).json({ success: false, message: "DATABASE_URL is not configured" });
    }

    const requestedStoreId = req.body?.storeId;
    if (platform === "uber" && requestedStoreId) {
      try {
        const currentConfig = await loadPlatformConfig(db, req.user.companyId, platform);
        const requestedEnvironment = req.body?.environment === "production" ? "production" : "sandbox";
        if (requestedEnvironment !== currentConfig.environment) {
          return res.status(400).json({ success: false, message: "Save the Uber environment, then retrieve and select a store for that environment" });
        }
        const discovery = await executeWorkflowAction({
          db,
          req,
          companyId: req.user.companyId,
          action: { type: "UBER_GET_STORES" },
        });
        const stores = Array.isArray(discovery?.data?.stores)
          ? discovery.data.stores
          : Array.isArray(discovery?.data)
            ? discovery.data
            : [];
        const allowedStoreIds = new Set(stores.map((store) => String(store.id || store.store_id || "")));
        if (discovery?.success !== true || !allowedStoreIds.has(String(requestedStoreId))) {
          return res.status(400).json({ success: false, message: "Select a store returned by Uber store discovery for this company" });
        }
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message || "Unable to verify the selected Uber store" });
      }
    }

    const {
      enabled = false,
      environment = "sandbox",
      clientId,
      clientSecret,
      storeLocationId,
      storeId,
      brandId,
      orderAcceptance,
      requireOtpOnCompletion,
      apiKey,
      webhookSecret,
      menuMapping,
      notes,
    } = req.body;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existing = await client.query(
        "SELECT configuration FROM integrations WHERE company_id = $1 AND provider = $2 FOR UPDATE",
        [req.user.companyId, platform]
      );

      const existingConfiguration = existing.rows.length ? existing.rows[0].configuration || {} : {};

      const configuration = buildStoredConfiguration(
        {
          environment: environment === "production" ? "production" : "sandbox",
          client_id: clientId,
          client_secret: clientSecret,
          store_location_id: storeLocationId,
          store_id: storeId,
          brand_id: brandId,
          order_acceptance:
            orderAcceptance === undefined ? undefined : orderAcceptance === "auto" ? "auto" : "manual",
          require_otp_on_completion:
            requireOtpOnCompletion === undefined ? undefined : requireOtpOnCompletion === true || requireOtpOnCompletion === "true",
          api_key: apiKey,
          webhook_secret: webhookSecret,
          menu_mapping: menuMapping,
          notes,
        },
        existingConfiguration
      );

      const result = await client.query(
        `
        INSERT INTO integrations (company_id, name, provider, configuration, active)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (company_id, provider) DO UPDATE SET
          name = EXCLUDED.name,
          configuration = EXCLUDED.configuration,
          active = EXCLUDED.active,
          updated_at = NOW()
        RETURNING id, active
        `,
        [req.user.companyId, names[platform], platform, JSON.stringify(configuration), enabled === true]
      );

      await writeAudit(
        req.user.companyId,
        req.user.id,
        "online_platform_settings.updated",
        "integration",
        result.rows[0].id,
        { platform, enabled: enabled === true, environment: configuration.environment, require_otp_on_completion: configuration.require_otp_on_completion === true }
      );

      await client.query("COMMIT");

      const runtime = await loadPlatformConfig(db, req.user.companyId, platform);

      res.json({
        success: true,
        message: `${names[platform]} configuration saved`,
        data: {
          platform,
          name: names[platform],
          enabled: runtime.enabled === true,
          ...maskConfiguration(runtime),
          ...(platform === "uber" ? { menu_mapping_schema: UBER_MENU_MAPPING_SCHEMA } : {}),
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error?.code === "INVALID_MENU_MAPPING") {
        return res.status(400).json({ success: false, message: error.message });
      }
      console.error("Update online platform settings error:", error);
      res.status(500).json({ success: false, message: "Unable to save online platform settings" });
    } finally {
      client.release();
    }
  });

  return router;
}
