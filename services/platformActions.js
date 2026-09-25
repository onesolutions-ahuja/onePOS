import { decryptSecret } from "./onlineOrders/platformConfig.js";
import { getCompanyEntitlements, hasEntitlement } from "./licensing.js";
import { sendEmailViaProvider, sendSmsViaProvider } from "./invoiceDelivery.js";

const ACTIONS = {
  SEND_EMAIL: { provider: "EMAIL", entitlement: "communications.email" },
  SEND_SMS: { provider: "SMS", entitlement: "communications.sms" },
  SEND_WHATSAPP: { provider: "WHATSAPP", entitlement: "communications.whatsapp" },
};
const PERMISSIONS = "communications.send";

const SECRET = /(token|secret|password|api[_-]?key|credential|authorization)/i;
const safeError = (error) => ({ message: String(error?.message || error).slice(0, 500), retryable: error?.retryable === true });

async function provider(db, companyId, kind) {
  const aliases = { EMAIL: ["email_invoice", "email", "smtp", "mail"], SMS: ["sms_invoice", "sms", "twilio"], WHATSAPP: ["whatsapp", "whatsapp_business"] }[kind] || [kind.toLowerCase()];
  const result = await db("SELECT provider,configuration,active FROM integrations WHERE company_id=$1 AND lower(provider)=ANY($2::text[]) ORDER BY array_position($2::text[], lower(provider)) LIMIT 1", [companyId, aliases]);
  const row = result.rows[0];
  const config = row?.configuration && typeof row.configuration === "object" ? row.configuration : {};
  if (!row || row.active !== true || !Object.keys(config).length) return null;
  const endpoint = config.endpoint || config.api_base_url || config.url;
  const apiKey = decryptSecret(config.auth_token) || decryptSecret(config.api_key) || null;
  if (!endpoint || !apiKey) return null;
  return { endpoint, apiKey, authScheme: config.auth_scheme === "bearer" ? "bearer" : "raw", config };
}

async function loadMessageTemplate(db, companyId, templateId) {
  if (!templateId) return null;
  const result = await db(
    "SELECT subject,body,channel,active FROM platform_message_templates WHERE id=$1 AND company_id=$2 LIMIT 1",
    [templateId, companyId]
  );
  const template = result.rows[0];
  return template?.active === true ? template : null;
}

function templateMatchesAction(template, type) {
  if (!template) return true;
  const channel = String(template.channel || "").toUpperCase();
  const expected = type === "SEND_EMAIL" ? "EMAIL" : type === "SEND_SMS" ? "SMS" : "WHATSAPP";
  return channel === expected;
}

async function resolveMessageTemplate(db, companyId, action) {
  const template = await loadMessageTemplate(db, companyId, action.templateId);
  return action.message || action.body || action.templateBody || template?.body || null;
}

export async function executeRegisteredAction({ db, action, req, companyId, userId }) {
  const type = String(action?.type || action?.key || "").toUpperCase();
  if (req?.user?.isSuperadmin !== true && req?.user?.is_superadmin !== true && req?.user?.roleId) {
    const permission = await db("SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=$1 AND p.code=$2 LIMIT 1", [req.user.roleId, PERMISSIONS]);
    if (!permission.rows.length) return { status: "UNAVAILABLE", code: "PERMISSION_DENIED", retryable: false };
  }
  if (type === "SEND_IN_APP_NOTIFICATION") {
    const message = await resolveMessageTemplate(db, companyId, action);
    if (!message) return { status: "FAILED", code: "INVALID_ACTION_PAYLOAD", retryable: false };
    await db(
      "INSERT INTO platform_notifications (company_id,user_id,title,message,metadata) VALUES ($1,$2,$3,$4,$5::jsonb)",
      [companyId, userId || req?.user?.id || null, action.title || null, message, JSON.stringify({ source: "registered_action" })]
    );
    return { status: "SUCCESS" };
  }
  const definition = ACTIONS[type];
  if (!definition) throw Object.assign(new Error(`Unsupported shared action: ${type}`), { retryable: false });
  const entitlements = await getCompanyEntitlements(db, companyId);
  if (!hasEntitlement(entitlements, definition.entitlement)) {
    return { status: "UNAVAILABLE", code: "ENTITLEMENT_REQUIRED", retryable: false };
  }

  const runtime = await provider(db, companyId, definition.provider);
  if (!runtime) return { status: "UNAVAILABLE", code: "PROVIDER_UNAVAILABLE", retryable: false };
  const template = await loadMessageTemplate(db, companyId, action.templateId);
  if (template && !templateMatchesAction(template, type)) return { status: "FAILED", code: "TEMPLATE_CHANNEL_MISMATCH", retryable: false };
  const recipient = action.recipient || action.to;
  const body = action.body || action.message || action.templateBody || template?.body;
  if (!recipient || !body) return { status: "FAILED", code: "INVALID_ACTION_PAYLOAD", retryable: false };
  const result = type === "SEND_EMAIL"
    ? await sendEmailViaProvider({
        endpoint: runtime.endpoint,
        apiKey: runtime.apiKey,
        authScheme: runtime.authScheme,
        from: runtime.config.from || runtime.config.from_email,
        to: recipient,
        subject: action.subject || template?.subject || "onePOS notification",
        body,
      })
    : await sendSmsViaProvider({
        endpoint: runtime.endpoint,
        apiKey: runtime.apiKey,
        authScheme: runtime.authScheme,
        senderId: runtime.config.sender || runtime.config.sender_id || runtime.config.from,
        to: recipient,
        body,
      });
  if (!result.ok) {
    const retryable = result.httpStatus >= 500 || result.httpStatus === 429 || result.httpStatus === 0;
    return {
      status: "FAILED",
      code: retryable ? "PROVIDER_NETWORK_ERROR" : "PROVIDER_FAILED",
      retryable,
      error: safeError(Object.assign(new Error(result.errorText || "Provider failed"), { retryable })),
    };
  }
  return { status: "SUCCESS", provider: definition.provider, reference: result.reference || null };
}

export function getSharedActionDefinition(type) {
  return ACTIONS[String(type || "").toUpperCase()] || null;
}

export function redactActionPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, SECRET.test(key) ? "[REDACTED]" : value]));
}
