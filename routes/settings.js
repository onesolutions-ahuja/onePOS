import express from "express";

import {
  loadPlatformConfig,
  buildStoredConfiguration,
  maskConfiguration,
} from "../services/onlineOrders/platformConfig.js";

export default function createSettingsRouter({
  authenticate,
  authorize,
  db,
  pool,
  writeAudit,
  testPaymentTerminal,
}) {
  const router = express.Router();

  router.get("/settings", authenticate, async (req, res) => {
    try {
      const result = await db(
        `
        SELECT
          c.id AS company_id, c.name AS company_name, c.legal_name, c.email AS company_email, c.phone AS company_phone, c.currency, c.timezone, c.logo_url,
          cs.date_format, cs.vat_enabled, cs.default_vat_rate, cs.loyalty_enabled, cs.loyalty_earning_rate,
          cs.allow_negative_inventory_billing,
          cs.scan_go_enabled, cs.online_ordering_enabled, cs.online_payment_methods,
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
          },
          loyalty: {
            enabled: settings.loyalty_enabled ?? false,
            earningRate: Number(settings.loyalty_earning_rate ?? 0.0100),
          },
          scanGo: {
            enabled: settings.scan_go_enabled ?? false,
          },
          onlineOrdering: {
            enabled: settings.online_ordering_enabled ?? false,
            paymentMethods: Array.isArray(settings.online_payment_methods) ? settings.online_payment_methods : ["card", "cash", "cod"],
          },
          store: {
            id: settings.store_id,
            name: settings.store_name,
          },
          till: {
            id: settings.till_id,
            name: settings.till_name,
            terminalNumber: settings.terminal_number,
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

  router.put("/settings", authenticate, async (req, res) => {
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
      scanGoEnabled,
      onlineOrderingEnabled,
      onlinePaymentMethods,
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
      await client.query(
        `
        INSERT INTO company_settings (company_id, date_format, vat_enabled, default_vat_rate, loyalty_enabled, loyalty_earning_rate, scan_go_enabled, online_ordering_enabled, online_payment_methods, updated_by, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
        ON CONFLICT (company_id) DO UPDATE SET date_format=$2, vat_enabled=$3, default_vat_rate=$4, loyalty_enabled=$5, loyalty_earning_rate=$6, scan_go_enabled=$7, online_ordering_enabled=$8, online_payment_methods=$9, updated_by=$10, updated_at=NOW()
        `,
        [
          req.user.companyId,
          dateFormat || "DD/MM/YYYY",
          vatEnabled !== false,
          vatRate,
          loyaltyEnabled !== false,
          loyaltyEarningRate !== undefined ? loyaltyEarningRate : null,
          scanGoEnabled === true,
          onlineOrderingEnabled === true,
          onlinePaymentMethods !== undefined ? JSON.stringify(onlinePaymentMethods) : null,
          req.user.id
        ]
      );
      await client.query(
        `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'settings.updated','company',$1,$3)`,
        [req.user.companyId, req.user.id, JSON.stringify({ currency, timezone, dateFormat, vatEnabled, defaultVatRate: vatRate, loyaltyEnabled, loyaltyEarningRate, scanGoEnabled, onlineOrderingEnabled, onlinePaymentMethods })]
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
      await db("UPDATE payment_terminals SET last_test_result=$1, last_tested_at=NOW() WHERE id=$2", [test.message, req.params.id]);
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
      if (result.rows.length) await db("UPDATE hardware_configurations SET last_test_result=$1, last_tested_at=NOW() WHERE id=$2", [message, result.rows[0].id]);
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
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Update online platform settings error:", error);
      res.status(500).json({ success: false, message: "Unable to save online platform settings" });
    } finally {
      client.release();
    }
  });

  return router;
}
