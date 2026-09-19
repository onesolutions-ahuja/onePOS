/*
 * T10Z - Combos / Meal Deals API.
 *
 * Thin HTTP layer over the two existing services:
 *   services/comboDeals.js    - company-scoped database access
 *   services/comboPricing.js  - THE single pricing/matching engine
 *
 * No pricing logic lives here. Company always comes from the authenticated
 * context (req.user.companyId) - a client-supplied company_id is never
 * trusted. Store scope is enforced by the existing store-access rules and by
 * the deal's own store scope.
 */
import express from "express";
import {
  loadComboDeals,
  loadComboDealById,
  validateComboReferences,
  replaceComboGroups,
  setComboDealStores,
} from "../services/comboDeals.js";
import {
  applyComboDeals,
  validateComboDealInput,
  COMBO_DEAL_TYPES,
  COMBO_STORE_SCOPE,
  round2,
} from "../services/comboPricing.js";

export default function createCombosRouter({
  authenticate,
  authorize,
  db,
  pool,
  writeAudit = null,
}) {
  const router = express.Router();

  /** Normalise the writable part of a deal payload (never trusts company_id). */
  function normalisePayload(body = {}) {
    const storeScope =
      body.storeScope || body.store_scope || COMBO_STORE_SCOPE.ALL;
    const groups = Array.isArray(body.groups) ? body.groups : [];
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const dealType = body.dealType || body.deal_type || COMBO_DEAL_TYPES.MEAL_DEAL;
    const dealPrice = round2(body.dealPrice ?? body.deal_price ?? 0);
    const storeIds = Array.isArray(body.storeIds || body.store_ids)
      ? (body.storeIds || body.store_ids).filter(Boolean)
      : [];
    const startsAt = body.startsAt || body.starts_at || null;
    const endsAt = body.endsAt || body.ends_at || null;
    const normalisedGroups = groups.map((group, index) => ({
      name: typeof group?.name === "string" ? group.name.trim() : "",
      requiredQuantity:
        Number(group?.requiredQuantity ?? group?.required_quantity) || 0,
      displayOrder: index,
      productIds: Array.isArray(group?.productIds || group?.product_ids)
        ? (group.productIds || group.product_ids).filter(Boolean)
        : [],
      categoryIds: Array.isArray(group?.categoryIds || group?.category_ids)
        ? (group.categoryIds || group.category_ids).filter(Boolean)
        : [],
    }));

    return {
      name,
      description,
      dealType,
      dealPrice,
      storeScope,
      storeIds,
      active: body.active === undefined ? true : body.active === true,
      startsAt,
      endsAt,
      groups: normalisedGroups,
      /* Same shape services/comboPricing.js validates - single source of truth. */
      validationShape: {
        name,
        deal_type: dealType,
        deal_price: dealPrice,
        store_scope: storeScope,
        store_ids: storeIds,
        starts_at: startsAt,
        ends_at: endsAt,
        groups: normalisedGroups.map((group) => ({
          name: group.name,
          required_quantity: group.requiredQuantity,
          product_ids: group.productIds,
          category_ids: group.categoryIds,
        })),
      },
    };
  }

  /*
   * GET /api/combos
   * Admin list. Company-scoped; when ?activeOnly=true only live deals return.
   */
  router.get("/combos", authenticate, authorize("combo.view"), async (req, res) => {
    try {
      const data = await loadComboDeals(db, {
        companyId: req.user.companyId,
        storeId: req.query.storeId || null,
        activeOnly: req.query.activeOnly === "true",
      });
      res.json({ success: true, data });
    } catch (error) {
      console.error("Load combos error:", error);
      res.status(500).json({ success: false, message: "Unable to load combo deals" });
    }
  });

  /*
   * GET /api/combos/:id
   */
  router.get("/combos/:id", authenticate, authorize("combo.view"), async (req, res) => {
    try {
      const deal = await loadComboDealById(db, {
        id: req.params.id,
        companyId: req.user.companyId,
      });
      if (!deal) {
        return res.status(404).json({ success: false, message: "Combo deal not found" });
      }
      res.json({ success: true, data: deal });
    } catch (error) {
      console.error("Load combo error:", error);
      res.status(500).json({ success: false, message: "Unable to load combo deal" });
    }
  });

  /*
   * POST /api/combos
   */
  router.post("/combos", authenticate, authorize("combo.create"), async (req, res) => {
    try {
      const payload = normalisePayload(req.body);
      const validation = validateComboDealInput(payload.validationShape);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.errors[0], errors: validation.errors });
      }
      const refCheck = await validateComboReferences(db, {
        companyId: req.user.companyId,
        groups: payload.groups,
      });
      if (!refCheck.valid) {
        return res.status(400).json({ success: false, message: refCheck.errors[0], errors: refCheck.errors });
      }
      const result = await db(
        `INSERT INTO combo_deals (company_id, name, description, deal_type, deal_price, store_scope, active, starts_at, ends_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [req.user.companyId, payload.name, payload.description || null, payload.dealType, payload.dealPrice, payload.storeScope, payload.active, payload.startsAt, payload.endsAt, req.user.id || null]
      );
      const dealId = result.rows[0].id;
      await replaceComboGroups({ query: db }, { dealId, companyId: req.user.companyId, groups: payload.groups });
      if (payload.storeScope === COMBO_STORE_SCOPE.SELECTED) {
        await setComboDealStores(db, { dealId, companyId: req.user.companyId, storeIds: payload.storeIds });
      }
      if (typeof writeAudit === "function") {
        try { await writeAudit({ companyId: req.user.companyId, userId: req.user.id, action: "combo.create", entityType: "combo_deal", entityId: dealId, details: payload.name }); } catch { /* audit: fire-and-forget */ }
      }
      const deal = await loadComboDealById(db, { id: dealId, companyId: req.user.companyId });
      return res.status(201).json({ success: true, data: deal });
    } catch (error) {
      console.error("Create combo error:", error);
      return res.status(500).json({ success: false, message: "Unable to create combo deal" });
    }
  });

  /* PUT /api/combos/:id */
  router.put("/combos/:id", authenticate, authorize("combo.edit"), async (req, res) => {
    try {
      const existing = await loadComboDealById(db, { id: req.params.id, companyId: req.user.companyId });
      if (!existing) {
        return res.status(404).json({ success: false, message: "Combo deal not found" });
      }
      const payload = normalisePayload(req.body);
      const validation = validateComboDealInput(payload.validationShape);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.errors[0], errors: validation.errors });
      }
      const refCheck = await validateComboReferences(db, {
        companyId: req.user.companyId,
        groups: payload.groups,
      });
      if (!refCheck.valid) {
        return res.status(400).json({ success: false, message: refCheck.errors[0], errors: refCheck.errors });
      }
      await db(
        `UPDATE combo_deals SET name=$1, description=$2, deal_type=$3, deal_price=$4,
         store_scope=$5, active=$6, starts_at=$7, ends_at=$8, updated_at=NOW()
         WHERE id=$9 AND company_id=$10`,
        [payload.name, payload.description || null, payload.dealType, payload.dealPrice, payload.storeScope, payload.active, payload.startsAt, payload.endsAt, req.params.id, req.user.companyId]
      );
      await replaceComboGroups({ query: db }, { dealId: req.params.id, companyId: req.user.companyId, groups: payload.groups });
      if (payload.storeScope === COMBO_STORE_SCOPE.SELECTED) {
        await setComboDealStores(db, { dealId: req.params.id, companyId: req.user.companyId, storeIds: payload.storeIds });
      } else {
        await setComboDealStores(db, { dealId: req.params.id, companyId: req.user.companyId, storeIds: [] });
      }
      const deal = await loadComboDealById(db, { id: req.params.id, companyId: req.user.companyId });
      return res.json({ success: true, data: deal });
    } catch (error) {
      console.error("Update combo error:", error);
      return res.status(500).json({ success: false, message: "Unable to update combo deal" });
    }
  });

  /* DELETE /api/combos/:id */
  router.delete("/combos/:id", authenticate, authorize("combo.edit"), async (req, res) => {
    try {
      const result = await db("DELETE FROM combo_deals WHERE id=$1 AND company_id=$2", [req.params.id, req.user.companyId]);
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Combo deal not found" });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("Delete combo error:", error);
      return res.status(500).json({ success: false, message: "Unable to delete combo deal" });
    }
  });

  /* Activate / deactivate */
  async function setActive(req, res, active) {
    try {
      const result = await db(
        "UPDATE combo_deals SET active=$1, updated_at=NOW() WHERE id=$2 AND company_id=$3",
        [active, req.params.id, req.user.companyId]
      );
      if (!result.rowCount) {
        return res.status(404).json({ success: false, message: "Combo deal not found" });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("Combo activate error:", error);
      return res.status(500).json({ success: false, message: "Unable to update combo deal" });
    }
  }

  router.post("/combos/:id/activate", authenticate, authorize("combo.edit"), (req, res) => setActive(req, res, true));
  router.post("/combos/:id/deactivate", authenticate, authorize("combo.edit"), (req, res) => setActive(req, res, false));

  /* POST /api/combos/preview - THE pricing engine against a client basket */
  router.post("/combos/preview", authenticate, authorize("combo.view"), async (req, res) => {
    try {
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      const deals = await loadComboDeals(db, {
        companyId: req.user.companyId,
        storeId: req.body.storeId || null,
        activeOnly: true,
      });
      const result = applyComboDeals(deals, items, {
        companyId: req.user.companyId,
        storeId: req.body.storeId || null,
        at: new Date(),
      });
      return res.json({ success: true, data: result });
    } catch (error) {
      console.error("Combo preview error:", error);
      return res.status(500).json({ success: false, message: "Unable to preview combo deals" });
    }
  });

  return router;
}