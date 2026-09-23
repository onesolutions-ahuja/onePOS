import express from "express";

/*
 * T10-AUDIT — central audit log API (routes/audit.js).
 *
 * ONE read-only endpoint: GET /api/audit-logs. There is ONE audit table
 * (audit_logs) and ONE writer (services/auditLog.js); this route only reads.
 *
 * Permission model (identical to attendance / inventory / returns):
 *   - Superadmin & Administrator/Owner bypass: full company-scoped access.
 *   - Every other role requires the audit.view permission.
 *   - Non-admin callers are further restricted to their OWN assigned stores
 *     via canAccessStore (same store-level rule as the rest of the app) — a
 *     manager in Store A cannot read Store B's audit trail.
 *
 * Filters are all server-side + parameterised (no string interpolation) to
 * prevent any injection surface. details JSON is returned verbatim but is
 * already scrubbed at write time (services/auditLog.js strips sensitive
 * keys like password/pin/token/card data), so non-admin callers never see
 * secrets even in permitted rows.
 */
export default function createAuditRouter({
  authenticate,
  authorize,
  db,
  canViewCompanyCustomers,
  canAccessStore,
}) {
  const router = express.Router();

  /*
   * GET /api/audit-logs
   * Company-scoped audit listing with filters:
   *   action, actor, entityType, result, from, to, storeId,
   *   limit (1..200, default 50), offset (default 0).
   *
   * Returns: { success, data: { rows, total } }.
   * Rows are ordered newest-first by created_at.
   */
  router.get(
    "/audit-logs",
    authenticate,
    authorize("audit.view"),
    async (req, res) => {
      try {
        const companyId = req.user.companyId;
        const isAdmin = await canViewCompanyCustomers(req.user);

        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

        const action = (req.query.action || "").trim();
        const actor = (req.query.actor || "").trim();
        const entityType = (req.query.entityType || "").trim();
        const result = (req.query.result || "").trim();
        const from = (req.query.from || "").trim();
        const to = (req.query.to || "").trim();
        const storeIdQuery = (req.query.storeId || "").trim();

        /*
         * Non-admin callers are restricted to their assigned stores. An admin
         * may optionally narrow to a single store; a non-admin query for a
         * store they cannot access is silently narrowed (we never 403 mid-list
         * on a filter — we just constrain the result set).
         */
        let storeFilter = "";
        const params = [companyId];
        let idx = 1;

        if (isAdmin) {
          if (storeIdQuery) {
            storeFilter = `AND al.store_id = $${++idx}`;
            params.push(storeIdQuery);
          }
        } else if (storeIdQuery) {
          /* Non-admin explicitly asked for a store — verify access. */
          const allowed = await canAccessStore(req.user, storeIdQuery);
          if (!allowed) {
            return res.status(403).json({
              success: false,
              message: "You do not have permission to view audit records for that store",
            });
          }
          storeFilter = `AND al.store_id = $${++idx}`;
          params.push(storeIdQuery);
        } else {
          /* Non-admin with no filter — constrain to their assigned stores. */
          const userStoreIds = req.user.storeIds;
          if (Array.isArray(userStoreIds) && userStoreIds.length) {
            const placeholders = userStoreIds.map((_, i) => `$${idx + 1 + i}`).join(",");
            storeFilter = `AND al.store_id IN (${placeholders})`;
            userStoreIds.forEach((s) => params.push(s));
            idx = params.length - 1;
          } else {
            storeFilter = `AND al.store_id = $${++idx}`;
            params.push(req.user.storeId || null);
          }
        }

        const filters = [];
        if (action) {
          filters.push(`al.action ILIKE $${++idx} `);
          params.push(`%${action}%`);
        }
        if (actor) {
          filters.push(`al.actor_username ILIKE $${++idx}`);
          params.push(`%${actor}%`);
        }
        if (entityType) {
          filters.push(`al.entity_type = $${++idx}`);
          params.push(entityType);
        }
        if (result) {
          filters.push(`al.result = $${++idx}`);
          params.push(result);
        }
        if (from) {
          filters.push(`al.created_at >= $${++idx}`);
          params.push(new Date(from));
        }
        if (to) {
          filters.push(`al.created_at <= $${++idx}`);
          params.push(new Date(to));
        }

        // eslint-disable-next-line no-useless-escape
        const whereClause = filters.length
          ? "WHERE " + filters.join(" AND ")
          : "";

        const countResult = await db(
          `SELECT COUNT(*)::int AS total
           FROM audit_logs al
           ${whereClause} ${storeFilter} AND al.company_id = $1`,
          params
        );

        const listResult = await db(
          `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
                  al.actor_username, al.store_id, al.terminal_id, al.ip_address,
                  al.details, al.result, al.created_at
           FROM audit_logs al
           ${whereClause} ${storeFilter} AND al.company_id = $1
           ORDER BY al.created_at DESC
           LIMIT $${++idx} OFFSET $${++idx}`,
          [...params, limit, offset]
        );

        res.json({
          success: true,
          data: {
            rows: listResult.rows,
            total: countResult.rows[0].total,
          },
        });
      } catch (error) {
        console.error("Audit log query error:", error);
        res.status(500).json({ success: false, message: "Unable to load audit log" });
      }
    }
  );

  return router;
}
