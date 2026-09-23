import { evaluateCondition } from "./platformConditions.js";
import { enqueuePlatformJob } from "./platformJobs.js";

const IRREVERSIBLE_ACTIONS = new Set(["SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP", "CALL_WEBHOOK", "HTTP_REQUEST", "WEBHOOK"]);
const SECRET_KEY = /(password|token|secret|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;

function redact(value, depth = 0) {
  if (depth > 5 || value == null) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value !== "object") return String(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1)]));
}

function errorDetails(error) {
  return redact({
    message: String(error?.message || error || "Workflow execution failed").slice(0, 2000),
    code: error?.code || null,
    status: error?.status || error?.statusCode || null,
    retryable: error?.retryable ?? null,
  });
}

export class WorkflowExecutionError extends Error {
  constructor(details, compensationFailures = []) {
    super(details.message);
    this.name = "WorkflowExecutionError";
    this.code = details.code || "WORKFLOW_EXECUTION_FAILED";
    this.details = details;
    this.compensationFailures = compensationFailures;
  }
}

const COMMUNICATION_PROVIDER_ALIASES = {
  EMAIL: ["email", "smtp", "mail", "sendgrid", "mailgun", "postmark", "ses"],
  SMS: ["sms", "twilio", "textlocal", "messagebird", "vonage", "nexmo", "clickatell"],
  WHATSAPP: ["whatsapp", "whatsapp_business", "meta_whatsapp"],
};

function normalizeProviderName(value) {
  return String(value || "").trim().toLowerCase();
}

export async function hasConfiguredCommunicationProvider({ db, companyId, providerKind }) {
  if (!db || typeof db !== "function" || !companyId || !providerKind) return false;
  const providerName = String(providerKind).trim().toUpperCase();
  const providers = COMMUNICATION_PROVIDER_ALIASES[providerName] || [normalizeProviderName(providerKind)];
  if (!providers.length) return false;

  const result = await db(
    `SELECT provider, active, configuration FROM integrations WHERE company_id = $1 AND lower(provider) = ANY($2::text[]) LIMIT 1`,
    [companyId, providers]
  );

  if (!result.rows.length) return false;
  const row = result.rows[0];
  const config = row.configuration && typeof row.configuration === "object" ? row.configuration : {};
  if (row.active !== true) return false;

  const hasConfig = Object.keys(config).length > 0;
  if (providerName === "EMAIL") {
    return hasConfig && ["host", "server", "api_key", "auth_token", "username", "smtp_host", "from_email", "from", "sender"].some((key) => config[key] != null && String(config[key]).trim() !== "");
  }
  if (providerName === "SMS") {
    return hasConfig && ["account_sid", "auth_token", "api_key", "from", "sender", "phone_number", "provider_key", "sid"].some((key) => config[key] != null && String(config[key]).trim() !== "");
  }
  if (providerName === "WHATSAPP") {
    return hasConfig && ["phone_number_id", "app_id", "access_token", "webhook_verify_token", "business_account_id", "token"].some((key) => config[key] != null && String(config[key]).trim() !== "");
  }
  return hasConfig;
}

export async function updateWorkflowStepRunStatus({ db, stepRunId, status, errorText = null, metadata = {} }) {
  if (!db || typeof db !== "function" || !stepRunId) return null;
  const row = await db(
    `UPDATE platform_workflow_step_runs SET status=$1, completed_at=COALESCE(completed_at, NOW()), error_text=$2, metadata=COALESCE(metadata,'{}'::jsonb) || $3::jsonb, updated_at=NOW() WHERE id=$4 RETURNING *`,
    [String(status || "FAILED").toUpperCase(), errorText || null, JSON.stringify(metadata || {}), stepRunId]
  );
  return row.rows[0] || null;
}

export async function ensureCommunicationProvider({ db, companyId, providerKind, stepRunId = null }) {
  const configured = await hasConfiguredCommunicationProvider({ db, companyId, providerKind });
  if (configured) return { configured: true, providerKind };
  const label = String(providerKind || "provider").toUpperCase();
  const message = `${label} provider not configured`;
  if (stepRunId) {
    await updateWorkflowStepRunStatus({ db, stepRunId, status: "FAILED", errorText: message, metadata: { provider: label, providerConfigured: false } });
  }
  return { configured: false, providerKind: label, error: message };
}

export const WORKFLOW_ACTION_REGISTRY = Object.freeze([
  {
    key: "WORKFLOW",
    displayName: "Workflow",
    description: "A wrapper action grouping a collection of step actions.",
    schema: { type: "object", properties: { actions: { type: "array" } }, required: ["actions"] },
    validation: (action) => {
      if (!action || typeof action !== "object") throw new Error("Workflow action requires an object");
      if (!Array.isArray(action.actions) || action.actions.length === 0) throw new Error("Workflow actions require at least one action");
    },
    async: false,
    requiredPermissions: ["workflow.execute"],
    executor: async ({ action, ...context }) => ({ status: "completed", actions: action.actions || [] }),
  },
  {
    key: "VALIDATION",
    displayName: "Validation",
    description: "Validation gate before save.",
    validation: () => undefined,
    async: false,
    requiredPermissions: ["records.validate"],
    executor: async () => ({ status: "completed" }),
  },
  {
    key: "SET_FIELD",
    displayName: "Set Field",
    description: "Set a field value on the current record.",
    validation: (action) => {
      if (!action?.field) throw new Error("Set Field requires a field");
      if (action.value === undefined) throw new Error("Set Field requires a value");
    },
    async: false,
    requiredPermissions: ["records.update"],
    executor: async ({ action, object }) => ({ status: "completed", field: action.field, value: action.value, objectId: object?.id || null }),
  },
  {
    key: "SHOW_MESSAGE",
    displayName: "Show Message",
    description: "Show a transient user-facing message.",
    validation: (action) => {
      if (!action?.message || typeof action.message !== "string") throw new Error("Show Message requires a message string");
    },
    async: false,
    requiredPermissions: ["notifications.write"],
    executor: async ({ action }) => ({ status: "completed", message: action.message }),
  },
  {
    key: "CREATE_RECORD",
    displayName: "Create Record",
    description: "Create a record on an object using field mappings.",
    schema: {
      type: "object",
      properties: {
        objectKey: { type: "string" },
        objectId: { type: "string" },
        fieldValues: { type: "object" },
      },
      required: ["fieldValues"],
    },
    validation: (action) => {
      if (!action || typeof action !== "object") throw new Error("Create Record requires an action object");
      if (!action.fieldValues || typeof action.fieldValues !== "object" || Array.isArray(action.fieldValues)) {
        throw new Error("Create Record requires fieldValues to be an object");
      }
    },
    async: false,
    requiredPermissions: ["records.create"],
    executor: async ({ db, action, req, object, companyId }) => {
      const targetObject = object || { source_table: action.sourceTable || null, company_scoped: !!action.companyScoped, store_scoped: !!action.storeScoped };
      const table = targetObject.source_table || action.objectKey || null;
      if (!table) throw new Error("Create Record requires a target object or source table");
      const entries = Object.entries(action.fieldValues || {});
      if (!entries.length) return { status: "completed", created: null };
      const keys = entries.map(([field]) => `"${String(field).replace(/"/g, "")}"`).join(", ");
      const values = entries.map((_, index) => `$${index + 1}`).join(", ");
      const params = entries.map(([, value]) => value);
      if (req?.user?.companyId && targetObject.company_scoped) {
        params.push(req.user.companyId);
        keys.length && (void 0);
      }
      const query = `INSERT INTO "${table}" (${keys}) VALUES (${values}) RETURNING *`;
      const result = await db(query, params);
      return { status: "completed", created: result.rows[0] || null };
    },
  },
  {
    key: "UPDATE_RECORD",
    displayName: "Update Record",
    description: "Update an existing record using field mappings.",
    schema: {
      type: "object",
      properties: {
        recordId: { type: "string" },
        fieldValues: { type: "object" },
      },
      required: ["recordId", "fieldValues"],
    },
    validation: (action) => {
      if (!action || typeof action !== "object") throw new Error("Update Record requires an action object");
      if (!action.recordId) throw new Error("Update Record requires a recordId");
      if (!action.fieldValues || typeof action.fieldValues !== "object" || Array.isArray(action.fieldValues)) {
        throw new Error("Update Record requires fieldValues to be an object");
      }
    },
    async: false,
    requiredPermissions: ["records.update"],
    executor: async ({ db, action, object, req, companyId }) => {
      const table = object?.source_table || action.sourceTable;
      if (!table) throw new Error("Update Record requires an object with a source table");
      const entries = Object.entries(action.fieldValues || {});
      if (!entries.length) return { status: "completed", updated: null };
      const sets = entries.map(([field], index) => `"${String(field).replace(/"/g, "")}"=$${index + 1}`).join(", ");
      const params = [...entries.map(([, value]) => value), action.recordId];
      const clauses = ["id=$" + params.length];
      if (object?.company_scoped || action.companyScoped) {
        params.push(req?.user?.companyId || action.companyId || companyId || null);
        clauses.push(`company_id=$${params.length}`);
      }
      if (object?.store_scoped || action.storeScoped) {
        params.push(req?.user?.storeId || action.storeId || null);
        clauses.push(`store_id=$${params.length}`);
      }
      const query = `UPDATE "${table}" SET ${sets} WHERE ${clauses.join(" AND ")} RETURNING *`;
      const result = await db(query, params);
      return { status: result.rows.length ? "completed" : "skipped", updated: result.rows[0] || null };
    },
  },
  {
    key: "UPDATE_RELATED_RECORD",
    displayName: "Update Related Record",
    description: "Update a child or related record via a relationship.",
    validation: (action) => {
      if (!action?.relationshipKey) throw new Error("Update Related Record requires a relationshipKey");
      if (!action.recordId) throw new Error("Update Related Record requires a recordId");
    },
    async: false,
    requiredPermissions: ["records.update"],
    executor: async ({ db, action, object, req }) => {
      if (!action.recordId) throw new Error("Update Related Record requires a recordId");
      const table = object?.source_table || action.relatedTable || action.sourceTable;
      if (!table) throw new Error("Update Related Record requires a target table");
      const entries = Object.entries(action.fieldValues || {});
      if (!entries.length) return { status: "completed", recordId: action.recordId, updated: null };
      const sets = entries.map(([field], index) => `"${String(field).replace(/"/g, "")}"=$${index + 1}`).join(", ");
      const params = [...entries.map(([, value]) => value), action.recordId];
      const clauses = ["id=$" + params.length];
      if (req?.user?.companyId) {
        params.push(req.user.companyId);
        clauses.push(`company_id=$${params.length}`);
      }
      const result = await db(`UPDATE "${table}" SET ${sets} WHERE ${clauses.join(" AND ")} RETURNING *`, params);
      return { status: result.rows.length ? "completed" : "skipped", recordId: action.recordId, updated: result.rows[0] || null };
    },
  },
  {
    key: "CREATE_RELATED_RECORD",
    displayName: "Create Related Record",
    description: "Create a child record through a defined relationship.",
    validation: (action) => {
      if (!action?.relationshipKey) throw new Error("Create Related Record requires a relationshipKey");
      if (!action.fieldValues || typeof action.fieldValues !== "object") throw new Error("Create Related Record requires fieldValues");
    },
    async: false,
    requiredPermissions: ["records.create"],
    executor: async ({ db, action, req, object }) => {
      const table = object?.source_table || action.relatedTable || action.sourceTable;
      if (!table) throw new Error("Create Related Record requires a target table");
      const entries = Object.entries(action.fieldValues || {});
      if (!entries.length) return { status: "completed", created: null };
      const keys = entries.map(([field]) => `"${String(field).replace(/"/g, "")}"`).join(", ");
      const params = entries.map(([, value]) => value);
      const query = `INSERT INTO "${table}" (${keys}) VALUES (${entries.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`;
      const result = await db(query, params);
      return { status: "completed", created: result.rows[0] || null, relationshipKey: action.relationshipKey };
    },
  },
  {
    key: "DELETE_RECORD",
    displayName: "Delete Record",
    description: "Delete or soft delete a record using the object's existing semantics.",
    validation: (action) => {
      if (!action?.recordId) throw new Error("Delete Record requires a recordId");
    },
    async: false,
    requiredPermissions: ["records.delete"],
    executor: async ({ db, action, object, req }) => {
      const table = object?.source_table || action.sourceTable;
      if (!table) throw new Error("Delete Record requires a target object");
      const hasActive = await db(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'active'`, [table]);
      const result = hasActive.rows.length
        ? await db(`UPDATE "${table}" SET active=false WHERE id=$1 RETURNING *`, [action.recordId])
        : await db(`DELETE FROM "${table}" WHERE id=$1 RETURNING *`, [action.recordId]);
      return { status: result.rows.length ? "completed" : "skipped", deleted: result.rows[0] || null };
    },
  },
  {
    key: "ASSIGN_RECORD",
    displayName: "Assign Record",
    description: "Assign a record to a user, team or queue.",
    validation: (action) => {
      if (!action?.recordId) throw new Error("Assign Record requires a recordId");
      if (!action.assignee && !action.assignedTo) throw new Error("Assign Record requires assignee information");
    },
    async: false,
    requiredPermissions: ["records.update"],
    executor: async ({ db, action, object, req }) => {
      const table = object?.source_table || action.sourceTable;
      if (!table) throw new Error("Assign Record requires a target object");
      const assignee = action.assignee ?? action.assignedTo;
      const result = await db(`UPDATE "${table}" SET assigned_to=$1 WHERE id=$2 RETURNING *`, [assignee, action.recordId]);
      return { status: result.rows.length ? "completed" : "skipped", updated: result.rows[0] || null };
    },
  },
  {
    key: "ADD_RELATIONSHIP",
    displayName: "Add Relationship",
    description: "Associate a record with a related record.",
    validation: (action) => {
      if (!action?.relationshipKey) throw new Error("Add Relationship requires a relationshipKey");
      if (!action.relatedRecordId && !action.recordId) throw new Error("Add Relationship requires a target record");
    },
    async: false,
    requiredPermissions: ["records.update"],
    executor: async ({ db, action, req }) => {
      const relatedRecordId = action.relatedRecordId || action.recordId;
      if (!db || typeof db !== "function") return { status: "completed", relationshipKey: action.relationshipKey, relatedRecordId };
      const result = await db(
        `INSERT INTO platform_relationships (company_id, parent_record_id, relationship_key, related_record_id, created_at)
         VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT DO NOTHING RETURNING *`,
        [req?.user?.companyId || action.companyId || null, action.parentRecordId || action.recordId || null, action.relationshipKey, relatedRecordId]
      );
      return { status: result.rows.length ? "completed" : "skipped", relationshipKey: action.relationshipKey, relatedRecordId };
    },
  },
  {
    key: "REMOVE_RELATIONSHIP",
    displayName: "Remove Relationship",
    description: "Remove a relationship between records.",
    validation: (action) => {
      if (!action?.relationshipKey) throw new Error("Remove Relationship requires a relationshipKey");
      if (!action.relatedRecordId && !action.recordId) throw new Error("Remove Relationship requires a target record");
    },
    async: false,
    requiredPermissions: ["records.update"],
    executor: async ({ db, action, req }) => {
      const relatedRecordId = action.relatedRecordId || action.recordId;
      if (!db || typeof db !== "function") return { status: "completed", relationshipKey: action.relationshipKey, relatedRecordId };
      const result = await db(
        `DELETE FROM platform_relationships WHERE company_id = COALESCE($1, company_id) AND relationship_key=$2 AND related_record_id=$3 AND (parent_record_id=$4 OR $4 IS NULL) RETURNING *`,
        [req?.user?.companyId || action.companyId || null, action.relationshipKey, relatedRecordId, action.parentRecordId || action.recordId || null]
      );
      return { status: result.rows.length ? "completed" : "skipped", relationshipKey: action.relationshipKey, relatedRecordId };
    },
  },
  {
    key: "IN_APP_NOTIFICATION",
    displayName: "In-App Notification",
    description: "Create a persistent internal notification for a user or team.",
    validation: (action) => {
      if (!action?.message && !action?.templateKey) throw new Error("In-App Notification requires a message or template");
    },
    async: false,
    requiredPermissions: ["notifications.write"],
    executor: async ({ db, action, req }) => {
      if (typeof db !== "function") return { status: "completed", notice: action.message || action.templateKey };
      try {
        await db(
          "INSERT INTO platform_notifications (company_id, user_id, message, status, created_at) VALUES ($1,$2,$3,'UNREAD',NOW())",
          [req?.user?.companyId || null, req?.user?.id || null, action.message || action.templateKey || ""]
        );
      } catch (error) {
        return { status: "completed", notice: action.message || action.templateKey || "notification", persistent: false, note: error.message };
      }
      return { status: "completed", notice: action.message || action.templateKey || "notification", persistent: true };
    },
  },
  {
    key: "SEND_EMAIL",
    displayName: "Send Email",
    description: "Queue an email using the configured email provider.",
    validation: (action) => {
      if (!action?.recipient && !action?.to) throw new Error("Send Email requires a recipient");
    },
    async: true,
    requiredPermissions: ["communications.send"],
    executor: async ({ db, action, req, companyId, stepRunId }) => {
      const company = companyId || req?.user?.companyId;
      const provider = await ensureCommunicationProvider({ db, companyId: company, providerKind: "EMAIL", stepRunId });
      if (!provider.configured) {
        return { status: "failed", provider: "EMAIL", error: provider.error, jobId: null };
      }
      const job = await enqueuePlatformJob({ db, companyId: company, kind: "SEND_EMAIL", payload: action, runAt: new Date(), idempotencyKey: action.idempotencyKey || `${company}:${stepRunId || action.id || JSON.stringify(action)}` });
      return { status: job ? "queued" : "skipped", jobId: job?.id || null };
    },
  },
  {
    key: "SEND_SMS",
    displayName: "Send SMS",
    description: "Queue an SMS using the configured SMS provider.",
    validation: (action) => {
      if (!action?.recipient && !action?.to) throw new Error("Send SMS requires a recipient");
    },
    async: true,
    requiredPermissions: ["communications.send"],
    executor: async ({ db, action, req, companyId, stepRunId }) => {
      const company = companyId || req?.user?.companyId;
      const provider = await ensureCommunicationProvider({ db, companyId: company, providerKind: "SMS", stepRunId });
      if (!provider.configured) {
        return { status: "failed", provider: "SMS", error: provider.error, jobId: null };
      }
      const job = await enqueuePlatformJob({ db, companyId: company, kind: "SEND_SMS", payload: action, runAt: new Date(), idempotencyKey: action.idempotencyKey || `${company}:${stepRunId || action.id || JSON.stringify(action)}` });
      return { status: job ? "queued" : "skipped", jobId: job?.id || null };
    },
  },
  {
    key: "SEND_WHATSAPP",
    displayName: "Send WhatsApp",
    description: "Queue a WhatsApp message using the configured provider.",
    validation: (action) => {
      if (!action?.recipient && !action?.to) throw new Error("Send WhatsApp requires a recipient");
    },
    async: true,
    requiredPermissions: ["communications.send"],
    executor: async ({ db, action, req, companyId, stepRunId }) => {
      const company = companyId || req?.user?.companyId;
      const provider = await ensureCommunicationProvider({ db, companyId: company, providerKind: "WHATSAPP", stepRunId });
      if (!provider.configured) {
        return { status: "failed", provider: "WHATSAPP", error: provider.error, jobId: null };
      }
      const job = await enqueuePlatformJob({ db, companyId: company, kind: "SEND_WHATSAPP", payload: action, runAt: new Date(), idempotencyKey: action.idempotencyKey || `${company}:${stepRunId || action.id || JSON.stringify(action)}` });
      return { status: job ? "queued" : "skipped", jobId: job?.id || null };
    },
  },
  {
    key: "CALL_FUNCTION",
    displayName: "Call Function",
    description: "Invoke a registered, approved onePOS function.",
    validation: (action) => {
      if (!action?.functionKey && !action?.key) throw new Error("Call Function requires a functionKey");
    },
    async: false,
    requiredPermissions: ["functions.execute"],
    executor: async ({ action }) => {
      const functionKey = action.functionKey || action.key;
      const functionDefinition = getRegisteredFunction(functionKey);
      if (!functionDefinition) throw new Error(`Function "${functionKey}" is not registered`);
      if (typeof functionDefinition.handler !== "function") {
        throw new Error(`Function "${functionKey}" has no handler`);
      }
      return functionDefinition.handler({ action, inputs: action.inputs || {} });
    },
  },
  {
    key: "RUN_SUBFLOW",
    displayName: "Run Subflow",
    description: "Run another approved workflow as a child workflow.",
    validation: (action) => {
      if (!action?.workflowId && !action?.subflowId && !(action?.workflow && Array.isArray(action.workflow.actions))) throw new Error("Run Subflow requires a workflowId");
    },
    async: true,
    requiredPermissions: ["workflow.execute"],
    executor: async ({ action, db, companyId, req, record, previousRecord, object, fields, workflowDepth = 0, workflowStack = [], runId = null, stepRunId = null, ...context }) => {
      const workflowKey = action.workflowId || action.subflowId || action.workflow?.id || action.workflow?.key || "inline-subflow";
      const stack = Array.isArray(workflowStack) ? workflowStack.slice() : [];
      if (stack.includes(workflowKey)) {
        throw new Error(`Workflow recursion detected for subflow "${workflowKey}"`);
      }
      const nextDepth = Number(workflowDepth || 0) + 1;
      if (nextDepth > 8) {
        throw new Error(`Maximum workflow depth exceeded for subflow "${workflowKey}"`);
      }
      const subflowDefinition = action.workflow && Array.isArray(action.workflow.actions)
        ? action.workflow
        : (() => {
            if (!db || typeof db !== "function") return null;
            const id = action.workflowId || action.subflowId;
            if (!id) return null;
            return db(`SELECT * FROM platform_rules WHERE id=$1 AND active=true LIMIT 1`, [id]).then((result) => result.rows[0] || null);
          })();
      const definition = await Promise.resolve(subflowDefinition);
      if (!definition) {
        throw new Error(`Subflow "${workflowKey}" was not found or is not active`);
      }
      const targetCompanyId = action.companyId || definition.company_id || companyId || req?.user?.companyId;
      const runtimeCompanyId = companyId || req?.user?.companyId;
      if (targetCompanyId && runtimeCompanyId && targetCompanyId !== runtimeCompanyId) {
        throw new Error("Cross-company subflow execution is not allowed");
      }
      const childActions = Array.isArray(definition.actions) ? definition.actions : Array.isArray(definition.action?.actions) ? definition.action.actions : [];
      if (!childActions.length) {
        return { status: "skipped", workflowId: workflowKey, reason: "Subflow contains no actions" };
      }
      const mappedInputs = {};
      const mappings = action.inputs || action.inputMap || action.mappings || {};
      for (const [sourceKey, targetKey] of Object.entries(mappings)) {
        const sourceValue = sourceKey in (context || {}) ? context[sourceKey] : (record && Object.prototype.hasOwnProperty.call(record, sourceKey) ? record[sourceKey] : undefined);
        if (sourceValue !== undefined) {
          mappedInputs[targetKey] = sourceValue;
        }
      }
      const mergedRecord = { ...(record || {}), ...mappedInputs };
      const childRun = db && typeof db === "function"
        ? await createWorkflowRun({
            db,
            companyId: targetCompanyId || runtimeCompanyId,
            workflowId: workflowKey,
            workflowName: definition.name || action.workflowName || "Subflow",
            objectId: object?.id || action.objectId || null,
            recordId: record?.id || action.recordId || null,
            triggerKey: "subflow",
            parentRunId: runId || null,
            status: "RUNNING",
            metadata: { parentWorkflow: workflowKey, inputMappings: mappings },
          })
        : null;
      const childStep = childRun && db && typeof db === "function"
        ? await createWorkflowStepRun({
            db,
            runId: childRun.id,
            stepIdentifier: `subflow:${workflowKey}`,
            stepOrder: 0,
            actionType: "RUN_SUBFLOW",
            status: "RUNNING",
            metadata: { parentRunId: runId || null },
          })
        : null;
      const childResult = await executeWorkflowActions({
        actions: childActions,
        db,
        object,
        fields,
        record: mergedRecord,
        previousRecord,
        req,
        companyId: targetCompanyId || runtimeCompanyId,
        workflowDepth: nextDepth,
        workflowStack: [...stack, workflowKey],
        runId: childRun?.id || runId || null,
        stepRunId: childStep?.id || stepRunId || null,
      });
      if (childRun && db && typeof db === "function") {
        await db(
          `UPDATE platform_workflow_runs SET status=$1, completed_at=NOW(), metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$3`,
          [childResult.some((item) => item.result?.status === "failed") ? "FAILED" : "COMPLETED", JSON.stringify({ childResults: childResult }), childRun.id]
        );
      }
      if (stepRunId) {
        await updateWorkflowStepRunStatus({
          db,
          stepRunId,
          status: childResult.some((item) => item.result?.status === "failed") ? "FAILED" : "COMPLETED",
          errorText: childResult.find((item) => item.result?.error)?.result?.error || null,
          metadata: { childRunId: childRun?.id || null, childResults: childResult },
        });
      }
      return {
        status: childResult.some((item) => item.result?.status === "failed") ? "failed" : "completed",
        workflowId: workflowKey,
        runId: childRun?.id || null,
        results: childResult,
      };
    },
  },
  {
    key: "CALL_WEBHOOK",
    displayName: "Call Webhook",
    description: "Send a webhook to an approved endpoint.",
    validation: (action) => {
      if (!action?.url && !action?.endpoint) throw new Error("Call Webhook requires a url or endpoint");
    },
    async: true,
    requiredPermissions: ["integrations.execute"],
    executor: async ({ action }) => ({ status: "queued", endpoint: action.url || action.endpoint || null }),
  },
  {
    key: "HTTP_REQUEST",
    displayName: "HTTP Request",
    description: "Send an HTTP request to an approved endpoint.",
    validation: (action) => {
      if (!action?.url && !action?.endpoint) throw new Error("HTTP Request requires a url or endpoint");
    },
    async: true,
    requiredPermissions: ["integrations.execute"],
    executor: async ({ action }) => ({ status: "queued", endpoint: action.url || action.endpoint || null }),
  },
  {
    key: "WEBHOOK",
    displayName: "Webhook",
    description: "Send a webhook to an approved endpoint.",
    validation: (action) => {
      if (!action?.url && !action?.endpoint) throw new Error("Webhook requires a url or endpoint");
    },
    async: true,
    requiredPermissions: ["integrations.execute"],
    executor: async ({ action }) => ({ status: "queued", endpoint: action.url || action.endpoint || null }),
  },
  {
    key: "CONDITION",
    displayName: "Condition",
    description: "Evaluate a branch condition and select flow path.",
    validation: (action) => {
      if (!action?.condition) throw new Error("Condition requires a condition");
    },
    async: false,
    requiredPermissions: ["workflow.execute"],
    executor: async ({ action, fields, record, previousRecord }) => {
      const condition = action.condition;
      const result = evaluateCondition(condition, fields || [], record || {}, previousRecord || null);
      return { status: result ? "completed" : "skipped", matched: Boolean(result) };
    },
  },
  {
    key: "WAIT",
    displayName: "Wait",
    description: "Pause a workflow without blocking an HTTP request.",
    validation: (action) => {
      if (!action?.durationSeconds && !action?.waitSeconds && !action?.until) {
        throw new Error("Wait requires a durationSeconds or until value");
      }
    },
    async: true,
    requiredPermissions: ["workflow.execute"],
    executor: async ({ db, action, companyId, req }) => {
      const waitSeconds = Number(action.durationSeconds ?? action.waitSeconds ?? 0);
      const runAt = new Date(Date.now() + Math.max(0, waitSeconds || 0) * 1000);
      const job = await enqueuePlatformJob({
        db,
        companyId: companyId || req?.user?.companyId,
        kind: "WAIT",
        payload: { waitSeconds, action },
        runAt,
        idempotencyKey: `${companyId || req?.user?.companyId || "workflow"}:wait:${Date.now()}`,
      });
      return { status: job ? "waiting" : "skipped", jobId: job?.id || null, resumeAt: runAt.toISOString() };
    },
  },
  {
    key: "STOP",
    displayName: "Stop",
    description: "Stop workflow execution cleanly and record the reason.",
    validation: () => undefined,
    async: false,
    requiredPermissions: ["workflow.execute"],
    executor: async ({ action }) => ({ status: "stopped", reason: action?.reason || "Workflow stopped by action" }),
  },
]);

export const WORKFLOW_ACTION_MAP = new Map(WORKFLOW_ACTION_REGISTRY.map((definition) => [definition.key, definition]));

export const REGISTERED_FUNCTIONS = Object.freeze([
  {
    key: "safe_echo",
    description: "Example safe function used by workflow tests.",
    inputs: { type: "object", properties: { value: { type: "string" } } },
    outputs: { type: "object" },
    permissions: ["functions.execute"],
    validation: (input) => {
      if (!input || typeof input !== "object") throw new Error("safe_echo requires an object input");
      if (typeof input.value !== "string") throw new Error("safe_echo requires a string value");
    },
    handler: ({ inputs = {} }) => ({ ok: true, value: inputs.value || "" }),
  },
]);

export const REGISTERED_FUNCTIONS_MAP = new Map(REGISTERED_FUNCTIONS.map((definition) => [definition.key, definition]));

export function getWorkflowActionRegistry() {
  return WORKFLOW_ACTION_REGISTRY.slice();
}

export function getWorkflowActionDefinition(key) {
  const normalized = String(key || "").toUpperCase();
  return WORKFLOW_ACTION_MAP.get(normalized) || null;
}

export function validateWorkflowAction(action) {
  if (!action || typeof action !== "object") {
    throw new Error("Workflow action must be an object");
  }
  const type = String(action.type || action.key || "").toUpperCase();
  const definition = WORKFLOW_ACTION_MAP.get(type) || WORKFLOW_ACTION_MAP.get(action.type || action.key);
  if (!definition) {
    throw new Error(`Unsupported workflow action: ${action.type || action.key}`);
  }
  if (typeof definition.validation === "function") {
    definition.validation(action);
  }
  return definition;
}

export function getRegisteredFunction(functionKey) {
  return REGISTERED_FUNCTIONS_MAP.get(String(functionKey || "")) || null;
}

export function getRegisteredFunctionsRegistry() {
  return REGISTERED_FUNCTIONS.slice();
}

export function createWorkflowRun({ db, companyId, workflowId, workflowName, objectId, recordId, triggerKey, parentRunId = null, startedAt = new Date(), status = "PENDING", metadata = {} }) {
  if (!db || typeof db !== "function") return null;
  const payload = { workflowId, workflowName, objectId, recordId, triggerKey, parentRunId, status, metadata: metadata || {} };
  return db(
    `INSERT INTO platform_workflow_runs (company_id, workflow_id, workflow_name, object_id, record_id, trigger_key, parent_run_id, status, started_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) RETURNING *`,
    [companyId, workflowId || null, workflowName || null, objectId || null, recordId || null, triggerKey || null, parentRunId || null, status, startedAt, JSON.stringify(payload.metadata || {})]
  ).then((result) => result.rows[0] || null);
}

export function createWorkflowStepRun({ db, runId, stepIdentifier, stepOrder = 0, actionType, status = "PENDING", metadata = {}, jobId = null, childRunId = null }) {
  if (!db || typeof db !== "function") return null;
  return db(
    `INSERT INTO platform_workflow_step_runs (run_id, step_identifier, step_order, action_type, status, metadata, job_id, child_run_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,
    [runId, stepIdentifier || null, stepOrder, actionType || null, status, JSON.stringify(metadata || {}), jobId || null, childRunId || null]
  ).then((result) => result.rows[0] || null);
}

export function resolveWorkflowActionType(action) {
  const normalized = action && (action.type || action.key || action.actionType || "");
  return String(normalized || "").toUpperCase();
}

export async function executeWorkflowAction(context) {
  const action = context?.action;
  const definition = validateWorkflowAction(action);
  if (typeof definition.executor !== "function") {
    return { status: "skipped", reason: "No executor configured" };
  }
  return definition.executor(context);
}

async function recordCompensationFailure({ db, runId, stepRunId, action, error, context }) {
  const details = errorDetails(error);
  if (!db || !runId) return details;
  await db(
    `INSERT INTO platform_workflow_compensation_runs
       (run_id, step_run_id, company_id, action_type, status, error_text, metadata)
     VALUES ($1,$2,$3,$4,'FAILED',$5,$6::jsonb)`,
    [runId, stepRunId || null, context.companyId || context.req?.user?.companyId || null, resolveWorkflowActionType(action), details.message, JSON.stringify({ error: details })]
  );
  return details;
}

async function getOrCreateWorkflowStepRun({ db, runId, stepIdentifier, stepOrder, actionType }) {
  const existing = await db(
    "SELECT * FROM platform_workflow_step_runs WHERE run_id=$1 AND step_identifier=$2 ORDER BY created_at DESC LIMIT 1",
    [runId, stepIdentifier]
  );
  if (existing.rows?.[0]) return existing.rows[0];
  return createWorkflowStepRun({
    db,
    runId,
    stepIdentifier,
    stepOrder,
    actionType,
    status: "RUNNING",
    metadata: { irreversible: IRREVERSIBLE_ACTIONS.has(actionType) },
  });
}

async function compensateCompletedSteps(completed, context, originalError) {
  const failures = [];
  for (const item of completed.reverse()) {
    const compensation = item.action?.compensation;
    if (!compensation || !context.db || !context.runId) continue;
    try {
      const existing = await context.db(
        "SELECT id,status FROM platform_workflow_compensation_runs WHERE run_id=$1 AND step_run_id=$2 AND company_id=$3 LIMIT 1",
        [context.runId, item.stepRunId || null, context.companyId || context.req?.user?.companyId || null]
      );
      if (existing.rows?.length) continue;
      const result = await executeWorkflowAction({ ...context, action: compensation, stepRunId: item.stepRunId || null, compensationFor: item.stepRunId || item.index });
      if (result?.status === "failed") throw new Error(result.error || "Compensation failed");
    } catch (error) {
      failures.push(await recordCompensationFailure({ db: context.db, runId: context.runId, companyId: context.companyId, req: context.req, context, stepRunId: item.stepRunId, action: compensation, error }));
    }
  }
  return failures;
}

export async function executeWorkflowActions({ actions, ...context }) {
  if (!Array.isArray(actions)) return [];
  const results = [];
  const completed = [];
  for (const item of actions) {
    if (!item || typeof item !== "object") continue;
    const index = results.length;
    let stepRun = null;
    if (context.db && context.runId) {
      stepRun = await getOrCreateWorkflowStepRun({
        db: context.db,
        runId: context.runId,
        stepIdentifier: item.id || `step-${index + 1}`,
        stepOrder: index + 1,
        actionType: resolveWorkflowActionType(item),
      });
    }
    if (stepRun?.status === "COMPLETED" || stepRun?.status === "WAITING") {
      const priorResult = stepRun.metadata?.result || { status: stepRun.status === "WAITING" ? "waiting" : "completed", idempotentReplay: true };
      results.push({ action: item.type || item.key, result: priorResult, stepRunId: stepRun.id, idempotentReplay: true });
      completed.push({ action: item, stepRunId: stepRun.id, index });
      continue;
    }
    try {
      const result = await executeWorkflowAction({ ...context, action: item, stepRunId: stepRun?.id || null });
      const entry = { action: item.type || item.key, result, stepRunId: stepRun?.id || null };
      results.push(entry);
      if (result?.status === "failed") throw new WorkflowExecutionError(errorDetails(result.error || result), []);
      if (result?.status === "completed" || result?.status === "queued" || result?.status === "waiting") {
        completed.push({ action: item, stepRunId: stepRun?.id || null, index });
      }
      if (stepRun?.id) await updateWorkflowStepRunStatus({ db: context.db, stepRunId: stepRun.id, status: result?.status === "stopped" ? "STOPPED" : result?.status === "waiting" ? "WAITING" : result?.status === "queued" ? "WAITING" : "COMPLETED", metadata: { result: redact(result), irreversible: IRREVERSIBLE_ACTIONS.has(resolveWorkflowActionType(item)) } });
      if (result?.status === "stopped") break;
    } catch (error) {
      const details = errorDetails(error);
      if (stepRun?.id) await updateWorkflowStepRunStatus({ db: context.db, stepRunId: stepRun.id, status: "FAILED", errorText: details.message, metadata: { error: details } });
      const compensationFailures = await compensateCompletedSteps(completed, context, error);
      if (context.runId && context.db) {
        await context.db(
          "UPDATE platform_workflow_runs SET status='FAILED', completed_at=NOW(), error_text=$1, metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb, updated_at=NOW() WHERE id=$3 AND company_id=$4",
          [details.message, JSON.stringify({ rootError: details, compensationFailures }), context.runId, context.companyId || context.req?.user?.companyId]
        );
      }
      throw new WorkflowExecutionError(details, compensationFailures);
    }
  }
  return results;
}
