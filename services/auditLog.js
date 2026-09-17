/*
 * Shared audit-log writer.
 *
 * Audit logging must never break the operation being audited:
 *  - `user_id` carries a foreign key to users. Sessions minted outside the
 *    normal login flow (service probes, tokens referencing a since-deleted
 *    user) would violate audit_logs_user_id_fkey and turn the whole request
 *    into a 500 (observed live on the WhatsApp settings PUT). The actor is
 *    verified against users and nulled when unknown - the column is nullable.
 *  - Any other audit failure is reported (onError / console) and swallowed:
 *    the business transaction has already committed; losing an audit row is
 *    not worth failing the user's action.
 *
 * Injected sink keeps this testable: onWrite receives the persisted entry,
 * onError receives the swallowed error.
 */
export function createAuditWriter({ db, onWrite, onError } = {}) {
  if (!db) throw new Error("createAuditWriter requires a db(query, params) function");
  return async function writeAudit(companyId, userId, action, entityType, entityId, details = {}) {
    try {
      let actorId = userId || null;
      if (actorId) {
        const known = await db(`SELECT 1 FROM users WHERE id = $1`, [actorId]);
        if (!known.rows.length) actorId = null;
      }
      const entry = {
        companyId,
        userId: actorId,
        action,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        details: details ?? {},
      };
      await db(
        `
        INSERT INTO audit_logs (company_id, user_id, action, entity_type, entity_id, details)
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          entry.companyId,
          entry.userId,
          entry.action,
          entry.entityType,
          entry.entityId,
          JSON.stringify(entry.details),
        ]
      );
      if (onWrite) onWrite(entry);
    } catch (error) {
      console.error(`Audit write failed (action=${action}):`, error.message);
      if (onError) onError(error);
    }
  };
}
