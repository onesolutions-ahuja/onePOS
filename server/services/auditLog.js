/*
 * Shared audit-log writer (T10-AUDIT).
 *
 * Central, reusable audit service for sensitive state-changing and
 * security-relevant actions across onePOS. There is ONE audit table
 * (audit_logs) and ONE writer - modules call writeAudit(...) rather than
 * creating per-module audit tables.
 *
 * Transaction safety: audit logging must NEVER break the operation being
 * audited. The writer:
 *  - verifies the actor user_id against the users table and nulls it when the
 *    user is unknown (sessions minted outside the normal login flow or
 *    referencing a since-deleted user) so a missing user cannot violate the FK
 *    and turn the request into a 500;
 *  - swallows every other failure (reported via onError / console) because the
 *    business transaction has already committed - losing an audit row is not
 *    worth failing the user's action.
 *
 * API - supports two call styles:
 *  1. Rich object (preferred for new callers):
 *     writeAudit({ companyId, userId, action, entityType, entityId,
 *       storeId, terminalId, sessionId, ipAddress, actorUsername,
 *       result, metadata })
 *  2. Legacy positional (existing call sites, preserved for back-compat):
 *     writeAudit(companyId, userId, action, entityType, entityId, details)
 *
 * Secret scrubbing: sensitive keys are stripped from metadata/details before
 * persistence (passwords, PINs, tokens, card data, CVV, etc.).
 */

const SENSITIVE_KEYS = new Set([
  "password", "pin", "secret", "token", "access_token", "refresh_token",
  "api_key", "apikey", "card_number", "card", "cvc", "cvv", "ssn",
  "cardholder", "expiry", "authorization_code", "client_secret",
]);

export function redactAuditDetails(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (Array.isArray(obj)) return obj.map(redactAuditDetails);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = String(k).toLowerCase();
    if (SENSITIVE_KEYS.has(key) || /password|token|secret|credential|private.?key|cvv|pin/.test(key)) continue;
    out[k] = typeof v === "object" && v !== null ? redactAuditDetails(v) : v;
  }
  return out;
}

export function createAuditWriter({ db, onWrite, onError } = {}) {
  if (!db) throw new Error("createAuditWriter requires a db(query, params) function");

  async function writeAudit(companyId, userId, action, entityType, entityId, details = {}) {
    const entry = normaliseEntry(companyId, userId, action, entityType, entityId, details);
    return persist(entry);
  }

  /* Rich object form: writeAudit({ ... }). */
  async function writeAuditObject(opts = {}) {
    const entry = normaliseEntry(
      opts.companyId, opts.userId, opts.action, opts.entityType, opts.entityId, opts.details
    );
    entry.storeId = opts.storeId ?? null;
    entry.terminalId = opts.terminalId ?? null;
    entry.sessionId = opts.sessionId ?? null;
    entry.ipAddress = opts.ipAddress ?? null;
    entry.actorUsername = opts.actorUsername ?? null;
    entry.result = opts.result ?? "success";
    entry.metadata = redactAuditDetails(opts.metadata) ?? {};
    return persist(entry);
  }

  function normaliseEntry(companyId, userId, action, entityType, entityId, details) {
    return {
      companyId: companyId ?? null,
      userId: userId ?? null,
      action: action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      metadata: redactAuditDetails(details) ?? {},
      result: "success",
      storeId: null,
      terminalId: null,
      sessionId: null,
      ipAddress: null,
      actorUsername: null,
    };
  }

  async function persist(entry) {
    try {
      let actorId = entry.userId || null;
      if (actorId) {
        const known = await db(`SELECT 1 FROM users WHERE id = $1`, [actorId]);
        if (!known.rows.length) actorId = null;
      }
      await db(
        `
        INSERT INTO audit_logs (
          company_id, user_id, action, entity_type, entity_id,
          store_id, terminal_id, session_id, ip_address, actor_username,
          details, result
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `,
        [
          entry.companyId,
          actorId,
          entry.action,
          entry.entityType,
          entry.entityId,
          entry.storeId,
          entry.terminalId,
          entry.sessionId,
          entry.ipAddress,
          entry.actorUsername,
          JSON.stringify(entry.metadata),
          entry.result,
        ]
      );
      if (onWrite) onWrite({ ...entry, userId: actorId });
    } catch (error) {
      console.error(`Audit write failed (action=${entry.action}):`, error.message);
      if (onError) onError(error);
    }
  }

  /* Expose both forms; the object form is returned as the primary handle so
   * callers can use either writeAudit({...}) or writeAudit(a,b,c,d,e,f). */
  const fn = Object.assign(writeAudit, { object: writeAuditObject });
  return fn;
}
