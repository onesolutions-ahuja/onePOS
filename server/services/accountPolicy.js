import crypto from "crypto";

export const ACCOUNT_TOKEN_PURPOSES = Object.freeze(["REGISTRATION", "PASSWORD_RESET"]);

export function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
export function emailDomain(value) { const email = normalizeEmail(value); const at = email.lastIndexOf("@"); return at > 0 ? email.slice(at + 1) : ""; }
export function domainAllowed(email, allowedDomain, enabled = false) {
  if (!enabled) return true;
  const domain = String(allowedDomain || "").trim().toLowerCase().replace(/^@/, "");
  return Boolean(domain) && emailDomain(email) === domain;
}
export function hashAccountToken(token) { return crypto.createHash("sha256").update(String(token)).digest("hex"); }
export function createAccountToken() { return crypto.randomBytes(32).toString("base64url"); }

export async function issueAccountToken(db, { companyId, userId, purpose, expiresMinutes = 60 }) {
  if (!ACCOUNT_TOKEN_PURPOSES.includes(purpose)) throw new Error("Unsupported account token purpose");
  const token = createAccountToken();
  const tokenHash = hashAccountToken(token);
  await db("UPDATE account_action_tokens SET used_at=NOW() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL", [userId, purpose]);
  await db(`INSERT INTO account_action_tokens (company_id,user_id,purpose,token_hash,expires_at)
            VALUES ($1,$2,$3,$4,NOW()+($5::text || ' minutes')::interval)`, [companyId, userId, purpose, tokenHash, Math.max(5, Number(expiresMinutes) || 60)]);
  return token;
}

export async function consumeAccountToken(db, { token, purpose }) {
  const result = await db(`UPDATE account_action_tokens SET used_at=NOW()
    WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at>NOW()
    RETURNING id,company_id,user_id,purpose,expires_at`, [hashAccountToken(token), purpose]);
  return result.rows[0] || null;
}

export async function pendingPolicies(db, { companyId, userId }) {
  const result = await db(`SELECT p.id,p.api_key,p.name,p.policy_type,p.version,p.title,p.body,p.require_acceptance,p.published_at
    FROM platform_policies p
    WHERE p.company_id=$1 AND p.status='ACTIVE' AND p.require_acceptance=TRUE
      AND NOT EXISTS (SELECT 1 FROM platform_policy_acceptances a WHERE a.policy_id=p.id AND a.policy_version=p.version AND a.user_id=$2)
    ORDER BY p.display_order,p.name`, [companyId, userId]);
  return result.rows;
}
