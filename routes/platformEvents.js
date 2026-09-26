import express from "express";
import {
  acceptInboundWebhook,
  createInboundWebhookEndpoint,
  createWebhookSubscription,
  deactivateWebhookSubscription,
  listInboundWebhookEndpoints,
  listWebhookDeliveries,
  publishPlatformEvent,
  updateInboundWebhookEndpoint,
  updateWebhookSubscription,
} from "../services/platformEvents.js";

function publicSubscription(row) {
  if (!row) return row;
  const { signing_secret_ciphertext: _secret, ...safe } = row;
  return safe;
}

export default function createPlatformEventsRouter({
  authenticate,
  authorize,
  db,
  encryptSecret = null,
  authenticateInbound = null,
}) {
  const router = express.Router();
  const manage = [authenticate, authorize("settings.manage")];

  router.get("/platform/event-types", ...manage, async (_req, res) => {
    try {
      const result = await db("SELECT event_type,description,source_package_id,active,created_at FROM platform_event_types WHERE active=TRUE ORDER BY event_type");
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Platform event type list error:", error);
      res.status(500).json({ success: false, message: "Unable to load event types" });
    }
  });

  router.get("/platform/events", ...manage, async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const result = await db(
        `SELECT id,company_id,event_type,payload,actor_user_id,idempotency_key,created_at
         FROM platform_events WHERE company_id=$1 ORDER BY created_at DESC LIMIT $2`,
        [req.user.companyId, limit]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Platform event list error:", error);
      res.status(500).json({ success: false, message: "Unable to load events" });
    }
  });

  router.post("/platform/events", ...manage, async (req, res) => {
    try {
      const body = req.body || {};
      const result = await publishPlatformEvent({
        db,
        companyId: req.user.companyId,
        eventType: body.eventType,
        payload: body.payload || {},
        actorUserId: req.user.id || null,
        idempotencyKey: body.idempotencyKey || req.get("idempotency-key") || null,
      });
      res.status(result.inserted ? 201 : 200).json({ success: true, data: result.event, inserted: result.inserted });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message || "Unable to publish event" });
    }
  });

  router.get("/platform/webhook-subscriptions", ...manage, async (req, res) => {
    try {
      const result = await db(
        `SELECT id,company_id,event_type,target_url,credential_id,headers,payload_template,retry_policy,active,created_by,created_at,updated_at
         FROM platform_webhook_subscriptions WHERE company_id=$1 ORDER BY created_at DESC`,
        [req.user.companyId]
      );
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Webhook subscription list error:", error);
      res.status(500).json({ success: false, message: "Unable to load webhook subscriptions" });
    }
  });

  router.post("/platform/webhook-subscriptions", ...manage, async (req, res) => {
    try {
      const body = req.body || {};
      let signingSecretCiphertext = null;
      if (body.signingSecret) {
        if (typeof encryptSecret !== "function") return res.status(503).json({ success: false, message: "Webhook secret encryption is not configured" });
        signingSecretCiphertext = await encryptSecret(String(body.signingSecret), { companyId: req.user.companyId });
      }
      const data = await createWebhookSubscription({
        db,
        companyId: req.user.companyId,
        eventType: body.eventType,
        targetUrl: body.targetUrl,
        headers: body.headers || {},
        payloadTemplate: body.payloadTemplate || {},
        retryPolicy: body.retryPolicy || {},
        credentialId: body.credentialId || null,
        signingSecretCiphertext,
        createdBy: req.user.id || null,
      });
      res.status(201).json({ success: true, data: publicSubscription(data) });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message || "Invalid webhook subscription" });
    }
  });

  router.put("/platform/webhook-subscriptions/:id", ...manage, async (req, res) => {
    try {
      const body = req.body || {};
      let signingSecretCiphertext;
      if (body.signingSecret !== undefined) {
        if (typeof encryptSecret !== "function") return res.status(503).json({ success: false, message: "Webhook secret encryption is not configured" });
        signingSecretCiphertext = body.signingSecret ? await encryptSecret(String(body.signingSecret), { companyId: req.user.companyId }) : null;
      }
      const data = await updateWebhookSubscription({
        db,
        companyId: req.user.companyId,
        subscriptionId: req.params.id,
        patch: body,
        signingSecretCiphertext,
      });
      if (!data) return res.status(404).json({ success: false, message: "Webhook subscription not found" });
      res.json({ success: true, data: publicSubscription(data) });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message || "Invalid webhook subscription" });
    }
  });

  router.delete("/platform/webhook-subscriptions/:id", ...manage, async (req, res) => {
    try {
      const result = await deactivateWebhookSubscription({ db, companyId: req.user.companyId, subscriptionId: req.params.id });
      if (!result) return res.status(404).json({ success: false, message: "Webhook subscription not found" });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error("Webhook subscription update error:", error);
      res.status(500).json({ success: false, message: "Unable to deactivate webhook subscription" });
    }
  });

  router.get("/platform/webhook-deliveries", ...manage, async (req, res) => {
    try {
      const data = await listWebhookDeliveries({ db, companyId: req.user.companyId, limit: req.query.limit });
      res.json({ success: true, data });
    } catch (error) {
      console.error("Webhook delivery list error:", error);
      res.status(500).json({ success: false, message: "Unable to load webhook deliveries" });
    }
  });

  router.get("/platform/inbound-webhook-endpoints", ...manage, async (req, res) => {
    try {
      const data = await listInboundWebhookEndpoints({ db, companyId: req.user.companyId });
      res.json({ success: true, data });
    } catch (error) {
      console.error("Inbound endpoint list error:", error);
      res.status(500).json({ success: false, message: "Unable to load inbound endpoints" });
    }
  });

  router.post("/platform/inbound-webhook-endpoints", ...manage, async (req, res) => {
    try {
      const body = req.body || {};
      const data = await createInboundWebhookEndpoint({
        db,
        companyId: req.user.companyId,
        connectorId: body.connectorId || null,
        authType: body.authType || "none",
        credentialId: body.credentialId || null,
        eventType: body.eventType,
        mapping: body.mapping || {},
        active: body.active !== false,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message || "Invalid inbound endpoint" });
    }
  });

  router.patch("/platform/inbound-webhook-endpoints/:id", ...manage, async (req, res) => {
    try {
      const data = await updateInboundWebhookEndpoint({
        db,
        companyId: req.user.companyId,
        endpointId: req.params.id,
        patch: req.body || {},
      });
      if (!data) return res.status(404).json({ success: false, message: "Inbound endpoint not found" });
      res.json({ success: true, data });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message || "Invalid inbound endpoint" });
    }
  });

  // This route must be mounted before express.json(), or the host must preserve
  // the original request bytes on req.rawBody for signature verification.
  router.post("/webhooks/inbound/:endpointKey", async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
      const result = await acceptInboundWebhook({
        db,
        endpointKey: req.params.endpointKey,
        rawBody,
        headers: req.headers || {},
        request: req,
        authenticateInbound,
      });
      if (!result.accepted) return res.status(result.status).json({ success: false, message: result.message });
      res.status(result.status).json({ success: true, duplicate: result.duplicate, inboundEventId: result.inboundEventId });
    } catch (error) {
      console.error("Inbound webhook acceptance error:", error);
      res.status(500).json({ success: false, message: "Unable to accept inbound webhook" });
    }
  });

  return router;
}
