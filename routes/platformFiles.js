import express from "express";
import {
  deletePlatformFile,
  isPlatformFileUuid,
  listPlatformFiles,
  readPlatformFile,
  verifyPlatformObjectRecord,
  writePlatformFile,
} from "../services/platformFiles.js";

async function resolveTarget(db, req, res, action) {
  const objectKey = req.body?.objectKey ?? req.query?.objectKey ?? req.params?.objectKey;
  const recordId = req.body?.recordId ?? req.query?.recordId ?? req.params?.recordId;
  if (req.body?.entityType && String(req.body.entityType).toUpperCase() !== "OBJECT") {
    res.status(422).json({ success: false, code: "UNSUPPORTED_FILE_TARGET", message: "Only OBJECT file targets are supported" });
    return null;
  }
  if (!objectKey || !isPlatformFileUuid(recordId)) {
    res.status(400).json({ success: false, message: "A registered object key and valid record ID are required" });
    return null;
  }
  const result = await db(
    `SELECT id,object_key,source_table,store_scoped FROM platform_objects
     WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)`,
    [objectKey, req.user.companyId],
    req
  );
  const object = result.rows[0];
  if (!object || !/^[a-z_][a-z0-9_]*$/.test(object.source_table || "")) {
    res.status(404).json({ success: false, message: "Registered object is unavailable" });
    return null;
  }
  if (!(await verifyPlatformObjectRecord({
    db: (query, params) => db(query, params, req),
    companyId: req.user.companyId,
    object,
    recordId,
    storeId: req.user.storeId || null,
  }))) {
    res.status(404).json({ success: false, message: "Record not found" });
    return null;
  }
  const permission = await db(
    `SELECT can_view,can_create,can_delete FROM platform_object_permissions
     WHERE object_id=$1 AND role_id=$2 AND company_id=$3`,
    [object.id, req.user.roleId || null, req.user.companyId],
    req
  );
  const isPrivileged = req.user?.isSuperadmin === true || req.user?.isPlatformDeveloper === true || req.user?.isDeveloper === true;
  const allowed = isPrivileged || (permission.rows[0]?.[`can_${action}`] === true);
  if (!allowed) {
    res.status(403).json({ success: false, message: `${action} permission is required` });
    return null;
  }
  return { object, recordId };
}

export default function createPlatformFilesRouter({ authenticate, db }) {
  const router = express.Router();

  router.post("/platform/files", authenticate, async (req, res) => {
    try {
      const target = await resolveTarget(db, req, res, "create");
      if (!target) return;
      const data = await writePlatformFile({
        db: (query, params) => db(query, params, req),
        companyId: req.user.companyId,
        userId: req.user.id,
        object: target.object,
        recordId: target.recordId,
        upload: { filename: req.body?.filename, mimeType: req.body?.mimeType, base64: req.body?.base64 },
        category: req.body?.category || null,
        metadata: req.body?.metadata && typeof req.body.metadata === "object" && !Array.isArray(req.body.metadata) ? req.body.metadata : {},
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("Platform file upload error:", error);
      res.status(500).json({ success: false, message: "Unable to upload file" });
    }
  });

  router.get("/platform/files", authenticate, async (req, res) => {
    try {
      const target = await resolveTarget(db, req, res, "view");
      if (!target) return;
      const data = await listPlatformFiles({
        db: (query, params) => db(query, params, req),
        companyId: req.user.companyId,
        objectId: target.object.id,
        recordId: target.recordId,
      });
      res.json({ success: true, data });
    } catch (error) {
      console.error("Platform file list error:", error);
      res.status(500).json({ success: false, message: "Unable to list files" });
    }
  });

  router.get("/platform/files/:id", authenticate, async (req, res) => {
    try {
      if (!isPlatformFileUuid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid file ID" });
      const file = await readPlatformFile({ db: (query, params) => db(query, params, req), companyId: req.user.companyId, fileId: req.params.id });
      if (!file) return res.status(404).json({ success: false, message: "File not found" });
      const objectResult = await db(
        "SELECT id,object_key,source_table,store_scoped FROM platform_objects WHERE id=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
        [file.object_id, req.user.companyId],
        req
      );
      const object = objectResult.rows[0];
      if (!object || !(await verifyPlatformObjectRecord({
        db: (query, params) => db(query, params, req),
        companyId: req.user.companyId,
        object,
        recordId: file.record_id,
        storeId: req.user.storeId || null,
      }))) return res.status(404).json({ success: false, message: "File not found" });
      const permission = await db(
        "SELECT can_view FROM platform_object_permissions WHERE object_id=$1 AND role_id=$2 AND company_id=$3",
        [object.id, req.user.roleId || null, req.user.companyId],
        req
      );
      const privileged = req.user?.isSuperadmin === true || req.user?.isPlatformDeveloper === true || req.user?.isDeveloper === true;
      if (!privileged && permission.rows[0]?.can_view !== true) return res.status(403).json({ success: false, message: "view permission is required" });
      res.json({ success: true, data: file });
    } catch (error) {
      console.error("Platform file download error:", error);
      res.status(500).json({ success: false, message: "Unable to download file" });
    }
  });

  router.delete("/platform/files/:id", authenticate, async (req, res) => {
    try {
      if (!isPlatformFileUuid(req.params.id)) return res.status(400).json({ success: false, message: "Invalid file ID" });
      const file = await readPlatformFile({ db: (query, params) => db(query, params, req), companyId: req.user.companyId, fileId: req.params.id });
      if (!file) return res.status(404).json({ success: false, message: "File not found" });
      const objectResult = await db(
        "SELECT id,object_key,source_table,store_scoped FROM platform_objects WHERE id=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
        [file.object_id, req.user.companyId],
        req
      );
      const object = objectResult.rows[0];
      if (!object || !(await verifyPlatformObjectRecord({
        db: (query, params) => db(query, params, req),
        companyId: req.user.companyId,
        object,
        recordId: file.record_id,
        storeId: req.user.storeId || null,
      }))) return res.status(404).json({ success: false, message: "File not found" });
      const permission = await db(
        "SELECT can_delete FROM platform_object_permissions WHERE object_id=$1 AND role_id=$2 AND company_id=$3",
        [object.id, req.user.roleId || null, req.user.companyId],
        req
      );
      const privileged = req.user?.isSuperadmin === true || req.user?.isPlatformDeveloper === true || req.user?.isDeveloper === true;
      if (!privileged && permission.rows[0]?.can_delete !== true) return res.status(403).json({ success: false, message: "delete permission is required" });
      await deletePlatformFile({ db: (query, params) => db(query, params, req), companyId: req.user.companyId, fileId: req.params.id });
      res.json({ success: true, data: { id: req.params.id } });
    } catch (error) {
      console.error("Platform file delete error:", error);
      res.status(500).json({ success: false, message: "Unable to delete file" });
    }
  });

  return router;
}
