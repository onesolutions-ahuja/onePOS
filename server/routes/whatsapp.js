/*
 * T9Q-SMALL - WhatsApp settings, connection test and test-invoice routes.
 *
 * Configuration-only foundation. Nothing here sends a customer message:
 *  - GET/PUT /api/whatsapp/settings        - masked config view / gated save
 *  - POST /api/whatsapp/test-connection    - REAL credentials probe (Meta
 *    Graph GET /{phone-number-id}) that MUST succeed before activation
 *  - POST /api/whatsapp/test-invoice       - exercises the existing T9P
 *    delivery contract (createInvoiceDeliveryLink + buildInvoiceDeliveryMessage)
 *    WITHOUT transmitting anything to WhatsApp
 *
 * Reuses the existing credential scheme: WhatsApp secrets live in the
 * `integrations` table (provider = 'whatsapp') encrypted with the same
 * enc:v1 AES-256-GCM scheme as the online platforms - no second encryption
 * system and no new tables. Secrets are never returned; GET/PUT respond with
 * the masked configuration only.
 *
 * Activation gating is enforced SERVER-SIDE: enabling requires a test token
 * issued by a successful test-connection call whose credential fingerprint
 * still matches the credentials being saved.
 */
import express from "express";
import crypto from "crypto";

import {
  buildWhatsAppConfiguration,
  maskWhatsAppConfiguration,
  loadWhatsAppConfig,
  decryptSecret,
} from "../services/onlineOrders/platformConfig.js";
import {
  createInvoiceDeliveryLink,
  buildInvoiceDeliveryMessage,
} from "../services/secureInvoiceLinks.js";
import { sendWhatsAppTestInvoice, resendWhatsAppInvoice } from "../services/whatsappDelivery.js";

/* Test-connection rate limit: per company, fixed 1-minute window (in-memory,
 * no new dependencies). 256-bit tokens/credentials are not brute-forceable,
 * so this only stops hammering the provider API. */
const TEST_WINDOW_MS = 60_000;
const TEST_MAX_PER_WINDOW = 10;
const testBuckets = new Map();
function testRateLimited(companyId) {
  const now = Date.now();
  const bucket = testBuckets.get(companyId);
  if (!bucket || now > bucket.reset) {
    testBuckets.set(companyId, { count: 1, reset: now + TEST_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > TEST_MAX_PER_WINDOW;
}

const PHONE_NUMBER_ID_RE = /^\d{6,20}$/;
const FINGERPRINT_PREFIX = "sha256:";

/*
 * Sale reference resolver for the manual test endpoints.
 *
 * Admins type the human-readable receipt (e.g. "Sale 01-20260917-0001" or
 * "T01-20260917-0001"), not the internal UUID. A receipt-like string must
 * NEVER reach a PostgreSQL uuid comparison (it 22P02s the whole query), so:
 *   - strictly UUID-shaped input resolves by sale id (byte-equal, cast-safe);
 *   - anything else is resolved by receipt_number ILIKE, tenant-scoped.
 * Both branches are company + store scoped and collapse to the same generic
 * "not found" so foreign tenants cannot be probed.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractReceiptNumber(rawInput) {
  const raw = String(rawInput || "").trim();
  // Tolerate copy/paste variants: "Sale 01-20260917-0001" (display prefix
  // with spaces) and "Sale01-..." - the receipt system stores T01-/T- forms.
  const stripped = raw.replace(/^sale\s*/i, "");
  const match = stripped.match(/([A-Za-z0-9]{1,8}-\d{8}-\d{1,8})/);
  return match ? match[1] : null;
}

async function resolveSaleReference(db, { rawReference, user }) {
  const raw = String(rawReference || "").trim();
  if (!raw) return { saleId: null };

  // 1. Strict UUID: resolve by id. Never cast non-UUID text.
  if (UUID_RE.test(raw)) {
    const result = user.storeId
      ? await db(
          `SELECT id, receipt_number FROM sales
           WHERE id = $1 AND company_id = $2 AND store_id = $3 LIMIT 1`,
          [raw, user.companyId, user.storeId]
        )
      : await db(
          `SELECT id, receipt_number FROM sales
           WHERE id = $1 AND company_id = $2 LIMIT 1`,
          [raw, user.companyId]
        );
    if (result.rows.length) return { saleId: result.rows[0].id, receiptNumber: result.rows[0].receipt_number };
    return { saleId: null };
  }

  // 2. Receipt-shaped text: exact receipt_number match first, then the
  //    pasted display form ("Sale 01-..." etc.). ILIKE runs on a text
  //    column only - no uuid cast can ever see this value.
  const receiptNumber = extractReceiptNumber(raw);
  if (receiptNumber) {
    const result = user.storeId
      ? await db(
          `SELECT id, receipt_number FROM sales
           WHERE company_id = $1 AND store_id = $2
             AND (receipt_number = $3 OR receipt_number ILIKE $4)
           LIMIT 1`,
          [user.companyId, user.storeId, receiptNumber, `%${receiptNumber}%`]
        )
      : await db(
          `SELECT id, receipt_number FROM sales
           WHERE company_id = $1
             AND (receipt_number = $2 OR receipt_number ILIKE $3)
           LIMIT 1`,
          [user.companyId, receiptNumber, `%${receiptNumber}%`]
        );
    if (result.rows.length) return { saleId: result.rows[0].id, receiptNumber: result.rows[0].receipt_number };
  }

  return { saleId: null };
}

/*
 * Fingerprint of the tested secret MATERIAL. Covers BOTH the access token
 * and the phone number ID: swapping the phone number ID while keeping the
 * same token must invalidate the previous test, otherwise activation could
 * target a phone number that was never successfully verified.
 */
function fingerprintSecret(...values) {
  return `${FINGERPRINT_PREFIX}${crypto.createHash("sha256").update(values.map((v) => String(v ?? "")).join("\n"), "utf8").digest("hex")}`;
}

/** Only absolute https Graph endpoints are ever called; the token never appears in any log or error. */
function assertSafeGraphUrl(phoneNumberId) {
  if (!PHONE_NUMBER_ID_RE.test(String(phoneNumberId || ""))) return null;
  return `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}?fields=id,verified_name,display_phone_number`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default function createWhatsAppSettingsRouter({ db, pool, authenticate, authorize, writeAudit }) {
  const router = express.Router();

  const upsertRow = async (client, companyId, active, configuration, userId) => {
    const existing = await client.query(
      `SELECT id FROM integrations WHERE company_id = $1 AND provider = 'whatsapp' FOR UPDATE`,
      [companyId]
    );
    if (existing.rows.length) {
      await client.query(
        `UPDATE integrations SET active = $2, configuration = $3, updated_at = NOW() WHERE id = $1`,
        [existing.rows[0].id, active, JSON.stringify(configuration)]
      );
      return existing.rows[0].id;
    }
    const inserted = await client.query(
      `INSERT INTO integrations (company_id, name, provider, configuration, active)
       VALUES ($1, 'WhatsApp Business', 'whatsapp', $2, $3)
       RETURNING id`,
      [companyId, JSON.stringify(configuration), active]
    );
    // Audit the creator when we can attribute it.
    if (userId) {
      /* created_by is not part of the platform `integrations` table; the
       * audit log below carries the actor instead. */
    }
    return inserted.rows[0].id;
  };

  /* ------------------------------- GET: masked configuration ------------------------------- */
  router.get("/whatsapp/settings", authenticate, async (req, res) => {
    try {
      const { enabled, configuration } = await loadWhatsAppConfig(db, req.user.companyId);
      res.json({
        success: true,
        data: { enabled, configuration: maskWhatsAppConfiguration(configuration) },
      });
    } catch (error) {
      console.error("Load WhatsApp settings error:", error.message);
      res.status(500).json({ success: false, message: "Unable to load WhatsApp settings" });
    }
  });

  /* ------------------------- PUT: save (activation gated server-side) ---------------------- */
  router.put("/whatsapp/settings", authenticate, authorize("settings.manage"), async (req, res) => {
    const client = await pool.connect();
    try {
      const {
        enabled = false,
        accessToken, // undefined = keep, null = clear, string = replace
        webhookVerifyToken,
        phoneNumberId,
        businessAccountId,
        displayName,
        defaultCountryCode,
        invoiceMessageTemplate,
        deliveryMode, // "link" | "pdf"
        autoSendEnabled, // automatic sending after sale completion
        testToken, // issued by a successful POST /whatsapp/test-connection
      } = req.body || {};

      const existing = await loadWhatsAppConfig(db, req.user.companyId);
      const candidateConfiguration = buildWhatsAppConfiguration(
        {
          phone_number_id: phoneNumberId,
          business_account_id: businessAccountId,
          display_name: displayName,
          default_country_code: defaultCountryCode,
          invoice_message_template: invoiceMessageTemplate,
          delivery_mode: deliveryMode,
          auto_send_enabled: autoSendEnabled,
          access_token: accessToken,
          webhook_verify_token: webhookVerifyToken,
        },
        existing.configuration
      );

      if (enabled === true) {
        // The credential that would be activated.
        const candidateToken = decryptSecret(candidateConfiguration.access_token);
        if (!candidateToken) {
          return res.status(400).json({
            success: false,
            message: "An access token is required before WhatsApp can be enabled.",
          });
        }

        /*
         * Server-side activation gate: a successful test must exist, be
         * referenced by testToken, and apply to THESE credentials.
         * The gate applies when ACTIVATING (OFF -> ON) or when the secret
         * material changes; already-enabled integrations can save delivery
         * settings (mode / auto-send / template) without a fresh test, and
         * never get silently deactivated by an ordinary save.
         */
        const wasEnabled = existing.enabled === true;
        const credentialsChanged =
          accessToken !== undefined ||
          (phoneNumberId !== undefined && phoneNumberId !== null &&
            String(phoneNumberId) !== String(existing.configuration.phone_number_id || ""));
        const gateApplies = !wasEnabled || credentialsChanged;

        if (gateApplies) {
          const testedToken = existing.configuration.last_test_token;
          const testedFingerprint = existing.configuration.last_test_token_fp;
          const testedAt = existing.configuration.last_tested_at;
          const testStillCurrent =
            Boolean(testToken) &&
            testedToken &&
            testToken === testedToken &&
            testedFingerprint === fingerprintSecret(candidateToken, candidateConfiguration.phone_number_id) &&
            testedAt &&
            Date.now() - new Date(testedAt).getTime() < 24 * 60 * 60 * 1000;

          if (!testStillCurrent) {
            return res.status(400).json({
              success: false,
              message:
                "A successful connection test with these credentials is required before activation. Use Test Connection first.",
            });
          }
        }

        if (!PHONE_NUMBER_ID_RE.test(String(candidateConfiguration.phone_number_id || ""))) {
          return res.status(400).json({
            success: false,
            message: "A valid numeric Phone Number ID is required before WhatsApp can be enabled.",
          });
        }
      }

      const rowId = await upsertRow(client, req.user.companyId, enabled === true, candidateConfiguration, req.user.id);
      await writeAudit(req.user.companyId, req.user.id, "whatsapp_settings_saved", "integration", rowId, {
        enabled: enabled === true,
        credentialsReplaced: accessToken !== undefined,
        webhookVerifyTokenReplaced: webhookVerifyToken !== undefined,
      });

      const { enabled: savedEnabled } = await loadWhatsAppConfig(db, req.user.companyId);
      return res.json({
        success: true,
        message: enabled === true ? "WhatsApp settings saved and activated." : "WhatsApp settings saved.",
        data: { enabled: savedEnabled, configuration: maskWhatsAppConfiguration(candidateConfiguration) },
      });
    } catch (error) {
      console.error("Save WhatsApp settings error:", error.message);
      return res.status(500).json({ success: false, message: "Unable to save WhatsApp settings" });
    } finally {
      client.release();
    }
  });

  /* --------------------------- POST: real connection test (pre-activation) ----------------- */
  router.post("/whatsapp/test-connection", authenticate, authorize("settings.manage"), async (req, res) => {
    if (testRateLimited(req.user.companyId)) {
      return res.status(429).json({ success: false, message: "Too many test attempts. Please wait a minute." });
    }

    try {
      const { accessToken, webhookVerifyToken, phoneNumberId } = req.body || {};
      const existing = await loadWhatsAppConfig(db, req.user.companyId);
      const candidate = buildWhatsAppConfiguration(
        {
          phone_number_id: phoneNumberId,
          access_token: accessToken,
          webhook_verify_token: webhookVerifyToken,
        },
        existing.configuration
      );

      const token = decryptSecret(candidate.access_token);
      const phoneId = candidate.phone_number_id;
      const startedAt = Date.now();

      if (!token) {
        return res.status(400).json({
          success: false,
          data: { status: "failed", error: "An access token is required to test the connection." },
        });
      }
      if (!PHONE_NUMBER_ID_RE.test(String(phoneId || ""))) {
        return res.status(400).json({
          success: false,
          data: { status: "failed", error: "A numeric Phone Number ID (from the Meta developer dashboard) is required." },
        });
      }

      const url = assertSafeGraphUrl(phoneId);
      if (!url) {
        return res.status(400).json({
          success: false,
          data: { status: "failed", error: "Phone Number ID must be numeric." },
        });
      }

      // REAL credential probe - GET /v21.0/{phone-number-id} with the bearer
      // token. The token travels in the query string per Meta's spec for this
      // endpoint; it is never logged, stored or returned.
      let httpStatus = 0;
      let verifiedName = null;
      let displayPhoneNumber = null;
      let failure = null;
      try {
        const response = await fetchWithTimeout(`${url}&access_token=${encodeURIComponent(token)}`);
        httpStatus = response.status;
        if (response.ok) {
          const payload = await response.json();
          if (payload && (payload.id === String(phoneId) || payload.id)) {
            verifiedName = payload.verified_name || null;
            displayPhoneNumber = payload.display_phone_number || null;
          } else {
            failure = "WhatsApp returned an unexpected response for this Phone Number ID.";
          }
        } else if (httpStatus === 401) {
          failure = "WhatsApp rejected the access token (HTTP 401). Generate a fresh token in the Meta developer dashboard.";
        } else if (httpStatus === 404) {
          failure = "Phone Number ID was not found for this access token (HTTP 404). Check the ID and token permissions.";
        } else {
          failure = `WhatsApp test failed (HTTP ${httpStatus}).`;
        }
      } catch (error) {
        failure =
          error && error.name === "AbortError"
            ? "The connection test timed out. Check the server's internet connection."
            : "The connection test could not reach WhatsApp. Check the server's internet connection.";
      }

      const durationMs = Date.now() - startedAt;
      // Audit WITHOUT any credential material: outcome + metadata only.
      await writeAudit(req.user.companyId, req.user.id, "whatsapp_connection_tested", "integration", null, {
        outcome: failure ? "failed" : "success",
        httpStatus,
        durationMs,
        phoneNumberIdFormatValid: PHONE_NUMBER_ID_RE.test(String(phoneId || "")),
      });

      if (failure) {
        return res.json({ success: false, data: { status: "failed", httpStatus, durationMs, error: failure } });
      }

      // Success: mint a one-use-ish activation reference bound to THESE
      // credentials (access token AND phone number ID - see fingerprintSecret).
      // Only the fingerprint of the tested material is stored.
      // `candidate` already carries the merged config (kept + just-tested
      // values), so persisting it makes activation validate the same secret.
      const testToken = crypto.randomUUID();
      const merged = {
        ...candidate,
        last_test_token: testToken,
        last_test_token_fp: fingerprintSecret(token, candidate.phone_number_id),
        last_tested_at: new Date().toISOString(),
        last_test_result: true,
      };
      const client = await pool.connect();
      try {
        await upsertRow(client, req.user.companyId, existing.enabled === true, merged, req.user.id);
      } finally {
        client.release();
      }

      return res.json({
        success: true,
        message: "Connection successful.",
        data: {
          status: "connected",
          httpStatus,
          durationMs,
          testedAt: merged.last_tested_at,
          testToken,
          verifiedName,
          displayPhoneNumber,
        },
      });
    } catch (error) {
      console.error("WhatsApp connection test error:", error.message);
      return res.status(500).json({
        success: false,
        data: { status: "failed", error: "Unable to run the connection test." },
      });
    }
  });

  /* ---------------------- POST: test-invoice via the T9P delivery contract ----------------- */
  router.post("/whatsapp/test-invoice", authenticate, authorize("settings.manage"), async (req, res) => {
    try {
      const { saleId } = req.body || {};
      const NOTE = "No message was sent to WhatsApp - this is a configuration test only.";

      if (!saleId) {
        // Pure formatting demo: exercises buildInvoiceDeliveryMessage with a
        // clearly-marked sample URL. No database rows, no claimable link.
        const sampleUrl = "https://your-onepos-domain/i/<sample-secure-token>";
        const message = `[WhatsApp TEST - not sent]\n${buildInvoiceDeliveryMessage({
          url: sampleUrl,
          invoiceNumber: "TEST-RECEIPT",
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        })}`;
        return res.json({
          success: true,
          data: { mode: "demo", sent: false, note: NOTE, message },
        });
      }

      // Real contract test against an ADMIN-CHOSEN sale. The reference may
      // be a sale UUID or a human-readable receipt number; either way it is
      // strictly tenant scoped (company + store when the user has one).
      const resolved = await resolveSaleReference(db, { rawReference: saleId, user: req.user });
      if (!resolved.saleId) {
        return res.status(404).json({ success: false, message: "Sale not found in your company" });
      }
      const resolvedSaleId = resolved.saleId;

      const link = await createInvoiceDeliveryLink({
        db,
        saleId: resolvedSaleId,
        companyId: req.user.companyId,
        storeId: req.user.storeId ?? null,
        createdBy: req.user.id ?? null,
        expiryDays: 1, // test links are deliberately short-lived
      });
      if (!link.ok) {
        return res.status(link.status || 500).json({ success: false, message: link.message });
      }

      const message = `[WhatsApp TEST - not sent]\n${buildInvoiceDeliveryMessage({
        url: link.url,
        invoiceNumber: resolved.receiptNumber || undefined,
        expiresAt: link.expiresAt,
      })}`;

      await writeAudit(req.user.companyId, req.user.id, "whatsapp_test_invoice_previewed", "sale", resolvedSaleId, {
        mode: "real-contract",
        sent: false,
      });

      return res.json({
        success: true,
        data: {
          mode: "real-contract",
          sent: false,
          note: NOTE,
          url: link.url,
          expiresAt: link.expiresAt,
          message,
        },
      });
    } catch (error) {
      console.error("WhatsApp test invoice error:", error.message);
      return res.status(500).json({ success: false, message: "Unable to build the test invoice" });
    }
  });

  /* ------------- POST: REAL test send to an admin-supplied demo number ------------- */
  /*
   * T9Q-NEXT: sends a REAL WhatsApp message through the exact same pipeline
   * as automatic delivery (sendWhatsAppTestInvoice). The recipient is ALWAYS
   * the admin-supplied demo/test number - never a stored customer number.
   * Respects the configured delivery_mode (link|pdf) unless overridden.
   */
  router.post("/whatsapp/test-send", authenticate, authorize("settings.manage"), async (req, res) => {
    try {
      const { saleId, recipientPhone, deliveryMode } = req.body || {};
      if (!recipientPhone || typeof recipientPhone !== "string") {
        return res.status(400).json({
          success: false,
          message: "A test recipient phone number is required.",
        });
      }
      if (!saleId) {
        return res.status(400).json({
          success: false,
          message: "A sale must be selected to send a real test invoice.",
        });
      }

      // Tenant-scoped resolution: UUID or human-readable receipt number.
      const resolved = await resolveSaleReference(db, { rawReference: saleId, user: req.user });
      if (!resolved.saleId) {
        return res.status(404).json({ success: false, message: "Sale not found in your company" });
      }
      const resolvedSaleId = resolved.saleId;

      const result = await sendWhatsAppTestInvoice({
        db,
        companyId: req.user.companyId,
        storeId: req.user.storeId ?? null,
        userId: req.user.id ?? null,
        saleId: resolvedSaleId,
        recipientPhone,
        deliveryMode: deliveryMode === "pdf" || deliveryMode === "link" ? deliveryMode : null,
      });

      await writeAudit(
        req.user.companyId,
        req.user.id,
        result.ok ? "whatsapp_test_sent" : "whatsapp_test_send_failed",
        "sale",
        resolvedSaleId,
        { mode: result.deliveryMode ?? deliveryMode ?? null, outcome: result.outcome ?? null }
      );

      if (!result.ok) {
        const status = result.reason === "not_configured" ? 400 : 502;
        return res.status(status).json({
          success: false,
          message:
            result.reason === "not_configured"
              ? "WhatsApp is not enabled/configured. Run the connection test and activate first."
              : result.reason === "invalid_recipient"
                ? "The test phone number is not a valid WhatsApp number."
                : result.reason === "sale_not_found"
                  ? "Sale not found in your company"
                  : `Test send failed: ${result.error || result.reason || "provider error"}`,
        });
      }

      return res.json({
        success: true,
        data: {
          mode: result.deliveryMode,
          sent: true,
          durationMs: result.durationMs ?? null,
        },
      });
    } catch (error) {
      console.error("WhatsApp test send error:", error.message);
      return res.status(500).json({ success: false, message: "Unable to send the test invoice" });
    }
  });

  /* ------------------------ GET: recent invoice delivery history -------------------------- */
  /*
   * T9Q-NEXT-SMALL: tenant-scoped delivery history for the WhatsApp settings
   * page. Reads ONLY the whatsapp_invoice_delivery audit records (which by
   * construction contain no secrets - see logDeliveryOutcome) and returns a
   * whitelist of safe presentation fields. Full phone numbers, tokens, token
   * hashes, ciphertext and internal IDs never cross the boundary.
   */
  router.get("/whatsapp/delivery-history", authenticate, authorize("settings.manage"), async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
      const params = [req.user.companyId, "whatsapp_invoice_delivery", limit];
      let storeClause = "";
      if (req.user.storeId) {
        // Store-scoped sessions only see deliveries for their own store's sales.
        params.push(req.user.storeId);
        storeClause = `AND s.store_id = $${params.length}`;
      }

      const result = await db(
        `SELECT al.details, al.created_at, s.receipt_number
         FROM audit_logs al
         INNER JOIN sales s ON s.id = al.entity_id AND s.company_id = al.company_id
         WHERE al.company_id = $1 AND al.action = $2 ${storeClause}
         ORDER BY al.created_at DESC
         LIMIT $3`,
        params
      );

      const d = (v) => (v === null || v === undefined ? null : String(v));
      const history = result.rows.map((row) => {
        const details = row.details && typeof row.details === "object" ? row.details : {};
        const mode = details.delivery_mode === "pdf" ? "pdf" : details.delivery_mode === "link" ? "link" : null;
        return {
          // Short public receipt reference only - never the internal sale UUID.
          receiptNumber: row.receipt_number || null,
          createdAt: row.created_at,
          outcome: d(details.outcome) || "unknown",
          trigger: d(details.trigger) || "auto",
          mode,
          modeLabel: mode === "pdf" ? "PDF" : mode === "link" ? "Secure link" : "-",
          recipientMasked: details.recipient_masked || null,
          providerMessageId: details.provider_message_id
            ? `${String(details.provider_message_id).slice(0, 10)}…`
            : null,
          httpStatus: details.http_status ?? null,
          durationMs: details.duration_ms ?? null,
          error: details.error || details.reason || null,
        };
      });

      return res.json({ success: true, data: { history } });
    } catch (error) {
      console.error("WhatsApp delivery history error:", error.message);
      return res.status(500).json({ success: false, message: "Unable to load delivery history" });
    }
  });

  /* -------------------------- POST: manual resend from the sale view ---------------------- */
  /*
   * T9Q-NEXT-SMALL: manual "Resend invoice via WhatsApp" for an existing
   * sale. Strictly tenant-scoped; reuses the EXISTING delivery pipeline
   * (resendWhatsAppInvoice); respects the configured mode incl. the
   * PDF -> link fallback; never touches auto_send_enabled; records the
   * outcome in the existing audit trail via the service.
   */
  router.post("/whatsapp/resend-invoice", authenticate, authorize("settings.manage"), async (req, res) => {
    try {
      const { saleId } = req.body || {};
      if (!saleId || typeof saleId !== "string") {
        return res.status(400).json({ success: false, message: "A sale ID is required." });
      }

      // Pre-flight tenant scope check (the service loader re-verifies).
      const saleCheck = await db(
        `SELECT id FROM sales
         WHERE id = $1 AND company_id = $2
         ${req.user.storeId ? "AND store_id = $3" : ""}
         LIMIT 1`,
        req.user.storeId ? [saleId, req.user.companyId, req.user.storeId] : [saleId, req.user.companyId]
      );
      if (!saleCheck.rows.length) {
        return res.status(404).json({ success: false, message: "Sale not found in your company" });
      }

      const result = await resendWhatsAppInvoice({
        db,
        saleId,
        companyId: req.user.companyId,
        storeId: req.user.storeId ?? null,
        userId: req.user.id ?? null,
      });

      await writeAudit(
        req.user.companyId,
        req.user.id,
        result.ok ? "whatsapp_invoice_resent" : "whatsapp_invoice_resend_failed",
        "sale",
        saleId,
        { mode: result.deliveryMode ?? null, outcome: result.outcome ?? null }
      );

      if (result.outcome === "skipped") {
        const status = result.reason === "sale_not_found" ? 404 : 400;
        const message =
          result.reason === "sale_not_found"
            ? "Sale not found in your company"
            : result.reason === "no_customer_phone"
              ? "The sale has no usable customer phone number for WhatsApp."
              : "WhatsApp is not activated/configured. Enable it in Settings first.";
        return res.status(status).json({ success: false, message });
      }
      if (!result.ok) {
        return res.status(502).json({
          success: false,
          message: `Resend failed: ${result.error || result.reason || "provider error"}`,
        });
      }

      return res.json({
        success: true,
        message: "Invoice sent via WhatsApp.",
        data: { mode: result.deliveryMode, durationMs: result.durationMs ?? null },
      });
    } catch (error) {
      console.error("WhatsApp resend error:", error.message);
      return res.status(500).json({ success: false, message: "Unable to resend the invoice" });
    }
  });

  return router;
}
