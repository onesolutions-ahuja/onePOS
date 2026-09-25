import express from "express";
import { CHANNELS, extractMergeFields, renderMessageTemplate, validateTemplateChannel } from "../services/messageTemplates.js";
import { toSafeApiName } from "../services/platformMetadata.js";

export default function createAdvancedPlatformRouter({ authenticate, authorize, db }) {
  const router = express.Router();
  const manage = [authenticate, authorize("settings.manage")];

  router.get("/platform/message-templates", ...manage, async (req, res) => {
    const result = await db("SELECT t.id,t.company_id,t.name,t.api_key,t.description,t.channel,t.object_id,o.object_key,t.subject,t.body,t.active,t.created_by,t.created_at,t.updated_at FROM platform_message_templates t LEFT JOIN platform_objects o ON o.id=t.object_id WHERE t.company_id=$1 ORDER BY t.name", [req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.post("/platform/message-templates", ...manage, async (req, res) => {
    const { name, channel, subject = "", body = "", description = "", objectId = null, active = true } = req.body || {};
    const normalizedChannel = String(channel || "").toUpperCase();
    if (!name?.trim() || !validateTemplateChannel(normalizedChannel) || !String(body).trim() || (normalizedChannel === "EMAIL" && !String(subject).trim())) {
      return res.status(400).json({ success: false, message: "Name, valid channel and message content are required" });
    }
    try {
      if (objectId) {
        const object = await db("SELECT id FROM platform_objects WHERE id=$1 AND (company_id IS NULL OR company_id=$2) AND active=true", [objectId, req.user.companyId]);
        if (!object.rows.length) return res.status(400).json({ success: false, message: "Selected Platform object is unavailable" });
      }
      const result = await db("INSERT INTO platform_message_templates (company_id,name,api_key,description,channel,object_id,subject,body,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,company_id,name,api_key,description,channel,object_id,subject,body,active,created_by,created_at,updated_at", [req.user.companyId, name.trim(), toSafeApiName(name, "template"), description || null, normalizedChannel, objectId || null, subject || null, body, active !== false, req.user.id || null]);
      const data = { ...result.rows[0], object_key: objectId ? (await db("SELECT object_key FROM platform_objects WHERE id=$1", [objectId])).rows[0]?.object_key || null : null };
      res.status(201).json({ success: true, data, mergeFields: [...new Set([...extractMergeFields(subject), ...extractMergeFields(body)])] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A template with this API key already exists" });
      console.error("Message template create error:", error);
      res.status(500).json({ success: false, message: "Unable to create message template" });
    }
  });

  router.put("/platform/message-templates/:id", ...manage, async (req, res) => {
    const existing = await db("SELECT * FROM platform_message_templates WHERE id=$1 AND company_id=$2", [req.params.id, req.user.companyId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: "Message template not found" });
    const current = existing.rows[0];
    const next = { ...current, ...req.body };
    const channel = String(next.channel || "").toUpperCase();
    if (!next.name?.trim() || !validateTemplateChannel(channel) || !String(next.body || "").trim() || (channel === "EMAIL" && !String(next.subject || "").trim())) return res.status(400).json({ success: false, message: "Invalid message template" });
    if (next.objectId || next.object_id) {
      const object = await db("SELECT id FROM platform_objects WHERE id=$1 AND (company_id IS NULL OR company_id=$2) AND active=true", [next.objectId || next.object_id, req.user.companyId]);
      if (!object.rows.length) return res.status(400).json({ success: false, message: "Selected Platform object is unavailable" });
    }
    const nextObjectId = next.objectId ?? next.object_id ?? null;
    const result = await db("UPDATE platform_message_templates SET name=$1,description=$2,channel=$3,object_id=$4,subject=$5,body=$6,active=$7,updated_at=NOW() WHERE id=$8 AND company_id=$9 RETURNING id,company_id,name,api_key,description,channel,object_id,subject,body,active,created_by,created_at,updated_at", [next.name.trim(), next.description || null, channel, nextObjectId, next.subject || null, next.body, next.active !== false, req.params.id, req.user.companyId]);
    const data = { ...result.rows[0], object_key: nextObjectId ? (await db("SELECT object_key FROM platform_objects WHERE id=$1", [nextObjectId])).rows[0]?.object_key || null : null };
    res.json({ success: true, data });
  });

  router.delete("/platform/message-templates/:id", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_message_templates SET active=false,updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING id,active", [req.params.id, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Message template not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.post("/platform/message-templates/:id/preview", ...manage, async (req, res) => {
    const result = await db("SELECT * FROM platform_message_templates WHERE id=$1 AND company_id=$2 AND active=true", [req.params.id, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Active message template not found" });
    const template = result.rows[0];
    try {
      const allowed = new Set(Object.keys(req.body?.record || {}));
      res.json({ success: true, data: { subject: renderMessageTemplate(template.subject, req.body.record || {}, allowed), body: renderMessageTemplate(template.body, req.body.record || {}, allowed) } });
    } catch (error) {
      res.status(422).json({ success: false, code: error.code || "INVALID_TEMPLATE", message: error.message });
    }
  });

  router.get("/platform/communication-deliveries", ...manage, async (req, res) => {
    const result = await db("SELECT id,company_id,store_id,channel,template_id,object_id,record_id,recipient,provider_name,status,attempts,failure_reason,provider_message_id,triggered_by_rule,attempted_at,sent_at,created_at FROM platform_communication_deliveries WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200", [req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.get("/platform/action-jobs", ...manage, async (req, res) => {
    const result = await db("SELECT id,company_id,kind,status,attempts,last_error,next_attempt_at,completed_at,created_at,updated_at FROM platform_action_jobs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200", [req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.get("/platform/workflow-runs", ...manage, async (req, res) => {
    const limit = Number.parseInt(req.query.limit || "50", 10);
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    const result = await db(
      `SELECT id, company_id, workflow_id, workflow_name, object_id, record_id, trigger_key, parent_run_id, status, started_at, completed_at, created_at, updated_at, metadata
       FROM platform_workflow_runs
       WHERE company_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user.companyId, safeLimit]
    );
    res.json({ success: true, data: result.rows || [] });
  });

  router.get("/platform/workflow-runs/:runId", ...manage, async (req, res) => {
    const runResult = await db(
      `SELECT id, company_id, workflow_id, workflow_name, object_id, record_id, trigger_key, parent_run_id, status, started_at, completed_at, created_at, updated_at, metadata
       FROM platform_workflow_runs
       WHERE id=$1 AND company_id=$2`,
      [req.params.runId, req.user.companyId]
    );
    if (!runResult.rows.length) return res.status(404).json({ success: false, message: "Workflow run not found" });

    const stepResult = await db(
      `SELECT s.id, s.run_id, s.step_identifier, s.step_order, s.action_type, s.status, s.started_at, s.completed_at, s.error_text, s.metadata, s.durable_job_id, s.child_run_id,
              j.kind AS job_kind, j.status AS job_status, j.attempts AS job_attempts, j.last_error AS job_last_error, j.next_attempt_at AS job_next_attempt_at
       FROM platform_workflow_step_runs s
       LEFT JOIN platform_action_jobs j ON j.id = s.durable_job_id
       WHERE s.run_id=$1
       ORDER BY s.step_order ASC, s.created_at ASC`,
      [runResult.rows[0].id]
    );

    const steps = (stepResult.rows || []).map((step) => ({
      ...step,
      metadata: step.metadata || {},
      job: step.job_kind || step.job_status || step.job_attempts != null ? {
        kind: step.job_kind || null,
        status: step.job_status || null,
        attempts: step.job_attempts ?? 0,
        last_error: step.job_last_error || null,
        next_attempt_at: step.job_next_attempt_at || null,
      } : null,
    }));

    res.json({ success: true, data: { run: runResult.rows[0], steps } });
  });

  return router;
}

export { CHANNELS };
