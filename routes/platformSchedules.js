import express from "express";
import {
  createPlatformSchedule,
  deactivatePlatformSchedule,
  listPlatformSchedules,
  updatePlatformSchedule,
} from "../services/platformSchedules.js";

export default function createPlatformSchedulesRouter({ authenticate, authorize, db }) {
  const router = express.Router();
  const manage = [authenticate, authorize("settings.manage")];

  router.get("/platform/schedules", ...manage, async (req, res) => {
    try {
      const data = await listPlatformSchedules({ db, companyId: req.user.companyId });
      res.json({ success: true, data });
    } catch (error) {
      console.error("Platform schedule list error:", error);
      res.status(500).json({ success: false, message: "Unable to load schedules" });
    }
  });

  router.post("/platform/schedules", ...manage, async (req, res) => {
    try {
      const body = req.body || {};
      const data = await createPlatformSchedule({
        db,
        companyId: req.user.companyId,
        workflowId: body.workflowId,
        scheduleType: body.scheduleType,
        definition: body.definition || {},
        timezone: body.timezone || "UTC",
        active: body.active === true,
        createdBy: req.user.id || null,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error.message?.includes("not found")) return res.status(404).json({ success: false, message: error.message });
      res.status(400).json({ success: false, message: error.message || "Invalid schedule" });
    }
  });

  router.put("/platform/schedules/:id", ...manage, async (req, res) => {
    try {
      const data = await updatePlatformSchedule({ db, companyId: req.user.companyId, scheduleId: req.params.id, patch: req.body || {} });
      if (!data) return res.status(404).json({ success: false, message: "Schedule not found" });
      res.json({ success: true, data });
    } catch (error) {
      if (error.message?.includes("not found")) return res.status(404).json({ success: false, message: error.message });
      res.status(400).json({ success: false, message: error.message || "Invalid schedule" });
    }
  });

  router.delete("/platform/schedules/:id", ...manage, async (req, res) => {
    try {
      const data = await deactivatePlatformSchedule({ db, companyId: req.user.companyId, scheduleId: req.params.id });
      if (!data) return res.status(404).json({ success: false, message: "Schedule not found" });
      res.json({ success: true, data });
    } catch (error) {
      console.error("Platform schedule delete error:", error);
      res.status(500).json({ success: false, message: "Unable to deactivate schedule" });
    }
  });

  return router;
}
