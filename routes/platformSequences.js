import express from "express";
import { allocatePlatformSequence, upsertPlatformSequence } from "../services/platformSequences.js";

const SAFE_KEY = /^[a-z_][a-z0-9_]{0,99}$/i;

async function resolveSequenceScope({ db, req, res, objectKey, sequenceKey, storeId }) {
  if (!req.user?.companyId) {
    res.status(403).json({ success: false, message: "A tenant company context is required" });
    return null;
  }
  if (!SAFE_KEY.test(objectKey || "") || !SAFE_KEY.test(sequenceKey || "")) {
    res.status(400).json({ success: false, message: "Valid objectKey and sequenceKey are required" });
    return null;
  }
  const objectResult = await db(
    `SELECT id,object_key FROM platform_objects
     WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)`,
    [objectKey, req.user.companyId],
    req
  );
  if (!objectResult.rows.length) {
    res.status(404).json({ success: false, message: "Registered object is unavailable" });
    return null;
  }
  if (storeId) {
    const store = await db("SELECT id FROM stores WHERE id=$1 AND company_id=$2 AND active=true", [storeId, req.user.companyId], req);
    if (!store.rows.length) {
      res.status(404).json({ success: false, message: "Store not found" });
      return null;
    }
    if (req.user.storeId && req.user.storeId !== storeId) {
      res.status(403).json({ success: false, message: "Sequence store scope is not authorized" });
      return null;
    }
  }
  return { companyId: req.user.companyId, storeId: storeId || null };
}

export default function createPlatformSequencesRouter({ authenticate, authorize, db, pool }) {
  const router = express.Router();

  router.post("/platform/sequences/allocate", authenticate, async (req, res) => {
    try {
      const objectKey = req.body?.objectKey;
      const sequenceKey = req.body?.sequenceKey;
      const storeId = req.body?.storeId || null;
      const scope = await resolveSequenceScope({ db, req, res, objectKey, sequenceKey, storeId });
      if (!scope) return;
      const object = await db(
        "SELECT id FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
        [objectKey, req.user.companyId],
        req
      );
      const permission = await db(
        "SELECT can_create FROM platform_object_permissions WHERE object_id=$1 AND role_id=$2 AND company_id=$3",
        [object.rows[0].id, req.user.roleId || null, req.user.companyId],
        req
      );
      const privileged = req.user?.isSuperadmin === true || req.user?.isPlatformDeveloper === true || req.user?.isDeveloper === true;
      if (!privileged && permission.rows[0]?.can_create !== true) return res.status(403).json({ success: false, message: "create permission is required" });
      const data = await allocatePlatformSequence({ pool: req.tenantPool || pool, ...scope, objectKey, sequenceKey });
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("Platform sequence allocation error:", error);
      res.status(500).json({ success: false, message: "Unable to allocate sequence" });
    }
  });

  router.put("/platform/sequences/:objectKey/:sequenceKey", authenticate, authorize("settings.manage"), async (req, res) => {
    try {
      const storeId = req.body?.storeId || null;
      const scope = await resolveSequenceScope({ db, req, res, objectKey: req.params.objectKey, sequenceKey: req.params.sequenceKey, storeId });
      if (!scope) return;
      const data = await upsertPlatformSequence({
        pool: req.tenantPool || pool,
        ...scope,
        objectKey: req.params.objectKey,
        sequenceKey: req.params.sequenceKey,
        config: req.body,
      });
      res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("Platform sequence configuration error:", error);
      res.status(500).json({ success: false, message: "Unable to save sequence configuration" });
    }
  });

  return router;
}
