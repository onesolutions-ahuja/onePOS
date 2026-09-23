export const DUPLICATE_EMAIL_MESSAGE = "This email is already registered to another company.";

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return email || null;
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function findNormalizedEmailConflict(db, email, excludedUserId = null) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const result = await db(
    `SELECT id, company_id
       FROM users
      WHERE lower(btrim(email)) = $1
        AND ($2::uuid IS NULL OR id <> $2)
      LIMIT 1`,
    [normalized, excludedUserId]
  );
  return result.rows[0] || null;
}

export async function listDuplicateNormalizedEmails(db) {
  const result = await db(
    `SELECT lower(btrim(email)) AS email, COUNT(*)::int AS user_count,
            array_agg(id::text ORDER BY id) AS user_ids
       FROM users
      WHERE email IS NOT NULL AND btrim(email) <> ''
      GROUP BY lower(btrim(email))
     HAVING COUNT(*) > 1
      ORDER BY lower(btrim(email))`
  );
  return result.rows;
}
