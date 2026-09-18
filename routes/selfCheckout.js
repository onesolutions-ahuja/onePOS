import express from "express";
import jwt from "jsonwebtoken";

/*
 * T10D — Self-Checkout mode foundation.
 *
 * A restricted till mode entered explicitly from the staff POS. Reuses the
 * EXISTING authentication (same JWT/session layer via services/session.js)
 * and the EXISTING permissions model — no second user/permission system:
 *
 *   - Entering requires `sale.create` (admin/owner roles pass via
 *     canViewCompanyCustomers, exactly like every other route).
 *   - The mode token is a SHORT-LIVED JWT signed with the server's existing
 *     secret. It carries the same company/store/role identity as the
 *     operator's session, so every downstream query keeps its normal tenant
 *     and store scoping. The browser cannot choose a company/store — the
 *     token's claims are copied server-side from the authenticated user.
 *   - requireSelfCheckoutMode blocks any privileged operation performed with
 *     a self-checkout mode token (operator-only functions), and the sale
 *     route rejects cash payments from self-checkout sessions.
 *
 * The mode token is OPTIONAL: normal POS tokens continue to work exactly as
 * today. Self-checkout mode only ever RESTRICTS what a token may do.
 */

const SCO_MODE_TTL = process.env.SCO_MODE_TTL || "12h";

export function createSelfCheckoutRouter({
  authenticate,
  authorize,
  db,
  jwtSecret = process.env.JWT_SECRET || "development-secret-change-this",
  modeTtl = SCO_MODE_TTL,
  writeAudit = null,
}) {
  const router = express.Router();

  const signModeToken = (user) =>
    jwt.sign(
      {
        id: user.id,
        companyId: user.companyId,
        storeId: user.storeId,
        roleId: user.roleId,
        username: user.username,
        mode: "self_checkout",
      },
      jwtSecret,
      { expiresIn: modeTtl }
    );

  /*
   * POST /api/self-checkout/session
   * Explicitly enter Self-Checkout mode for this device/session.
   * Authorised with the SAME permission used to create sales.
   */
  router.post(
    "/self-checkout/session",
    authenticate,
    authorize("sale.create"),
    async (req, res) => {
      try {
        // The mode is tied to the authenticated operator's own store/company.
        const store = await db(
          `SELECT s.id, s.name FROM stores s WHERE s.id = $1 AND s.company_id = $2 AND s.active = true`,
          [req.user.storeId, req.user.companyId]
        );
        if (!store.rows.length) {
          return res.status(403).json({
            success: false,
            message: "Self-Checkout is not available for this store",
          });
        }

        const modeToken = signModeToken(req.user);

        if (typeof writeAudit === "function") {
          Promise.resolve(
            writeAudit(req.user.companyId, req.user.id, "SELF_CHECKOUT_MODE_STARTED", "self_checkout_session", null, {
              storeId: req.user.storeId,
            })
          ).catch(() => {});
        }

        res.status(201).json({
          success: true,
          message: "Self-Checkout mode started",
          data: {
            modeToken,
            store: { id: store.rows[0].id, name: store.rows[0].name },
            mode: "self_checkout",
          },
        });
      } catch (error) {
        console.error("Start self-checkout mode error:", error);
        res.status(500).json({ success: false, message: "Unable to start Self-Checkout mode" });
      }
    }
  );

  /*
   * DELETE /api/self-checkout/session
   * Leave Self-Checkout mode. The token is simply discarded client-side;
   * this endpoint exists so the exit is an explicit, auditable action.
   */
  router.delete(
    "/self-checkout/session",
    authenticate,
    authorize("sale.create"),
    async (req, res) => {
      if (typeof writeAudit === "function") {
        Promise.resolve(
          writeAudit(req.user.companyId, req.user.id, "SELF_CHECKOUT_MODE_EXITED", "self_checkout_session", null, {
            storeId: req.user.storeId,
          })
        ).catch(() => {});
      }
      res.json({ success: true, message: "Self-Checkout mode ended" });
    }
  );

  return router;
}

export default createSelfCheckoutRouter;

/*
 * Mode gate middleware factory (wired in server.js ahead of the privileged
 * routers). A token carrying mode:"self_checkout" may only perform the
 * read-only and sale operations Self-Checkout actually needs — and only via
 * the HTTP methods the mode uses. Anything else is refused server-side.
 */
/* path prefix -> allowed methods (empty array = all methods for that prefix) */
const SCO_ALLOWED = [
  { prefix: "/api/sales", methods: ["GET", "POST"] },          // basket pricing lookups + sale creation
  { prefix: "/api/products", methods: ["GET"] },               // product search only — no create/edit/delete
  { prefix: "/api/settings", methods: ["GET"] },               // VAT/store context only — no configuration writes
  { prefix: "/api/self-checkout", methods: ["DELETE"] },       // explicit, auditable exit
];

export function createSelfCheckoutModeGate() {
  return function selfCheckoutModeGate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return next();

    let payload;
    try {
      payload = jwt.decode(header.substring(7));
    } catch {
      return next();
    }

    if (payload?.mode !== "self_checkout") return next();

    const path = req.originalUrl || req.url || "";
    const method = (req.method || "GET").toUpperCase();
    const allowed = SCO_ALLOWED.some(
      (rule) =>
        (path === rule.prefix || path.startsWith(rule.prefix)) &&
        (rule.methods.length === 0 || rule.methods.includes(method))
    );
    if (allowed) return next();

    return res.status(403).json({
      success: false,
      message: "Not available in Self-Checkout mode",
    });
  };
}
