import express from "express";

/*
|--------------------------------------------------------------------------
| Held sales (suspended transactions) — hardened
|--------------------------------------------------------------------------
|
| Extracted behaviour-preserving from server.js (GET/POST/DELETE) and
| hardened for production:
|
|  - POST /api/held-sales/:id/resume — ATOMIC claim: the hold is removed
|    and returned in a single DELETE..RETURNING, so only the first resume
|    wins; any second tab/click gets 404 and must not restore the basket.
|  - GET /api/held-sales?scope=store — optional store-wide listing of
|    other users' holds, still company+store scoped and sale.hold gated.
|    The default (no scope) remains strictly the current user's holds.
|  - Payload limits: line counts and item-shape validation (belt and
|    braces on top of the express.json body limit).
|
| Identity always comes from the verified session (req.user) — never from
| the browser body. Legacy plain-array holds keep resuming.
*/

/* Reasonable retail limits: 200 basket/misc lines, 500KB JSON snapshot. */
const MAX_HOLD_LINES = 200;
const MAX_HOLD_JSON_CHARS = 500_000;

function validateHoldPayload(body) {
  const { items, miscLines } = body;
  if (!Array.isArray(items) || !items.length) {
    return { error: "Cannot hold an empty sale" };
  }
  if (!Number.isInteger(items.length) || items.length > MAX_HOLD_LINES) {
    return { error: `Too many sale lines (maximum ${MAX_HOLD_LINES})` };
  }
  const misc = Array.isArray(miscLines) ? miscLines : [];
  if (misc.length > MAX_HOLD_LINES) {
    return { error: `Too many misc lines (maximum ${MAX_HOLD_LINES})` };
  }
  if (items.some((item) => !item || typeof item !== "object")) {
    return { error: "Invalid sale line" };
  }
  return { ok: true };
}

export default function createHeldSalesRouter({ authenticate, authorize, db }) {
  const router = express.Router();

  /* -------- GET /api/held-sales (default: current user's holds) -------- */

  router.get(
    "/held-sales",
    authenticate,
    authorize("sale.hold"),
    async (req, res) => {
      try {
        if (req.query.scope === "store") {
          /* Explicit store-wide view: same store, any user. Never
             cross-company; still sale.hold gated. */
          const result = await db(
            `SELECT hs.id, hs.user_id, hs.customer_id, hs.items, hs.discount_type,
                    hs.discount_value, hs.notes, hs.created_at,
                    u.username AS user_name, cst.name AS customer_name
             FROM held_sales hs
             LEFT JOIN users u ON u.id = hs.user_id
             LEFT JOIN customers cst ON cst.id = hs.customer_id
             WHERE hs.company_id=$1 AND hs.store_id=$2
             ORDER BY hs.created_at DESC`,
            [req.user.companyId, req.user.storeId]
          );
          return res.json({ success: true, data: result.rows, scope: "store" });
        }

        /* Default: current user's holds (existing behaviour, unchanged). */
        const result = await db(
          `SELECT hs.id, hs.user_id, hs.customer_id, hs.items, hs.discount_type,
                  hs.discount_value, hs.notes, hs.created_at,
                  u.username AS user_name, cst.name AS customer_name
           FROM held_sales hs
           LEFT JOIN users u ON u.id = hs.user_id
           LEFT JOIN customers cst ON cst.id = hs.customer_id
           WHERE hs.company_id=$1 AND hs.store_id=$2 AND hs.user_id=$3
           ORDER BY hs.created_at DESC`,
          [req.user.companyId, req.user.storeId, req.user.id]
        );
        res.json({ success: true, data: result.rows });
      } catch (error) {
        console.error("Load held sales error:", error);
        res.status(500).json({ success: false, message: "Unable to load held sales" });
      }
    }
  );

  /* ------------------------- POST /api/held-sales ---------------------- */

  router.post(
    "/held-sales",
    authenticate,
    authorize("sale.hold"),
    async (req, res) => {
      const { items, miscLines, customerId = null, discountType = null, discountValue = 0, notes = null } = req.body;
      const check = validateHoldPayload(req.body);
      if (check.error) return res.status(400).json({ success: false, message: check.error });

      const snapshot = JSON.stringify({
        items,
        miscLines: Array.isArray(miscLines) ? miscLines : [],
      });
      if (snapshot.length > MAX_HOLD_JSON_CHARS) {
        return res.status(413).json({
          success: false,
          message: "Held sale snapshot too large",
        });
      }

      try {
        const result = await db(
          `INSERT INTO held_sales (company_id,store_id,user_id,customer_id,items,discount_type,discount_value,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at`,
          [
            req.user.companyId,
            req.user.storeId,
            req.user.id,
            customerId,
            snapshot,
            discountType,
            Number(discountValue) || 0,
            typeof notes === "string" ? notes.slice(0, 2000) : null,
          ]
        );
        res.status(201).json({ success: true, message: "Sale held", data: result.rows[0] });
      } catch (error) {
        console.error("Hold sale error:", error);
        res.status(500).json({ success: false, message: "Unable to hold sale" });
      }
    }
  );

  /* --------------------- POST /api/held-sales/:id/resume --------------- */

  /*
   * Atomic claim. DELETE..RETURNING removes and returns the hold in ONE
   * statement: exactly one caller can ever receive the contents. A second
   * tab/click finds zero rows → 404 with `alreadyResumed`, and the client
   * must not restore anything.
   *
   * Scope: company + store + owning user (JWT identity only). Managers
   * resuming another user's hold through the store-wide list need the
   * claiming scope to include the hold's own user, so the route accepts an
   * explicit `{ takeOthers: true }` — granted only on the same
   * sale.hold permission gate as everything else here.
   */
  router.post(
    "/held-sales/:id/resume",
    authenticate,
    authorize("sale.hold"),
    async (req, res) => {
      const takeOthers = req.body?.takeOthers === true;
      const scopeSql = takeOthers
        ? "id=$1 AND company_id=$2 AND store_id=$3"
        : "id=$1 AND company_id=$2 AND store_id=$3 AND user_id=$4";
      const params = takeOthers
        ? [req.params.id, req.user.companyId, req.user.storeId]
        : [req.params.id, req.user.companyId, req.user.storeId, req.user.id];

      try {
        const result = await db(
          `DELETE FROM held_sales WHERE ${scopeSql}
           RETURNING id, user_id, customer_id, items, discount_type, discount_value, notes, created_at`,
          params
        );
        if (!result.rows.length) {
          return res.status(404).json({
            success: false,
            message: "Held sale not found or already resumed",
            data: { alreadyResumed: true },
          });
        }
        res.json({ success: true, data: result.rows[0] });
      } catch (error) {
        console.error("Resume held sale error:", error);
        res.status(500).json({ success: false, message: "Unable to resume held sale" });
      }
    }
  );

  /* ------------------------- DELETE /api/held-sales/:id ---------------- */

  router.delete(
    "/held-sales/:id",
    authenticate,
    authorize("sale.hold"),
    async (req, res) => {
      try {
        const result = await db(
          "DELETE FROM held_sales WHERE id=$1 AND company_id=$2 AND store_id=$3 AND user_id=$4 RETURNING id",
          [req.params.id, req.user.companyId, req.user.storeId, req.user.id]
        );
        if (!result.rows.length) {
          return res.status(404).json({ success: false, message: "Held sale not found" });
        }
        res.json({ success: true, message: "Held sale removed" });
      } catch (error) {
        console.error("Remove held sale error:", error);
        res.status(500).json({ success: false, message: "Unable to remove held sale" });
      }
    }
  );

  return router;
}
