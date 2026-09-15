import express from "express";

export default function createSettingsRouter({
  authenticate,
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
          cs.date_format, cs.vat_enabled, cs.default_vat_rate,
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
      logoUrl = null,
    } = req.body;

    if (!companyName || !String(companyName).trim()) {
      return res.status(400).json({ success: false, message: "Company name is required" });
    }

    const vatRate = Number(defaultVatRate);
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
      return res.status(400).json({ success: false, message: "VAT rate must be between 0 and 100" });
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
        INSERT INTO company_settings (company_id, date_format, vat_enabled, default_vat_rate, updated_by, updated_at)
        VALUES ($1,$2,$3,$4,$5,NOW())
        ON CONFLICT (company_id) DO UPDATE SET date_format=$2, vat_enabled=$3, default_vat_rate=$4, updated_by=$5, updated_at=NOW()
        `,
        [req.user.companyId, dateFormat || "DD/MM/YYYY", vatEnabled !== false, vatRate, req.user.id]
      );
      await client.query(
        `INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details) VALUES ($1,$2,'settings.updated','company',$1,$3)`,
        [req.user.companyId, req.user.id, JSON.stringify({ currency, timezone, dateFormat, vatEnabled, defaultVatRate: vatRate })]
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

  return router;
}
