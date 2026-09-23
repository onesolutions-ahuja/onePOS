/*
 * onePOS session layer (extracted verbatim from server.js so the exact
 * production code is unit-testable).
 *
 * Token: JWT with a hard expiry (default 12h) - "keep me signed in
 * indefinitely" is not a thing; every token dies with the server's secret
 * and the expiry below. Expired or invalid tokens are rejected with 401
 * and a session-specific message.
 */
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "development-secret-change-this";

/* POS till sessions: a workday with headroom. Configurable via env because
 * single-device sites may legitimately want longer/shorter sessions. */
const SESSION_TTL = process.env.SESSION_TTL || "12h";

/** Mint the session token for a verified user row. */
export function createSessionToken(user, userStores = []) {
  return jwt.sign(
    {
      id: user.id,
      companyId: user.company_id,
      storeId: user.store_id,
      roleId: user.role_id,
      isSuperadmin: user.is_superadmin === true,
      mustChangePassword: false,
      username: user.username,
      assignedStoreIds: userStores.map(us => us.store_id),
    },
    JWT_SECRET,
    { expiresIn: SESSION_TTL }
  );
}

/**
 * Express middleware: Bearer-token authentication. Expired/invalid tokens
 * are ALWAYS rejected - there is no silent extension of a dead session.
 */
export function createAuthenticate({ onAuthenticated = null } = {}) {
  return function authenticate(req, res, next) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const token = header.substring(7);

    try {
      req.user = jwt.verify(token, JWT_SECRET);
      if (!onAuthenticated) return next();
      return Promise.resolve(onAuthenticated(req, res, next)).catch((error) => next(error));
    } catch {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token",
      });
    }
  };
}

/** Test/helper hook: sign an arbitrary payload with the same secret. */
export function signSessionPayload(payload, expiresIn = SESSION_TTL) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}
