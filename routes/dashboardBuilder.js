import express from "express";
import { buildCustomSalesQuery } from "./reports.js";
import { buildPlatformObjectQuery } from "../services/reportableSources.js";
import { mergeDashboardFilters, validateDashboardDefinition } from "../services/dashboardBuilder.js";

function customDateRange(filters = []) {
  const dateFilter = filters.find((filter) => filter && (filter.field === "date" || filter.operator));
  const operator = dateFilter?.operator || "this_week";
  const now = new Date();
  const iso = (date) => date.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (operator === "custom") return { from: dateFilter.from || dateFilter.dateFrom || null, to: dateFilter.to || dateFilter.dateTo || null };
  if (operator === "today") return { from: iso(start), to: iso(start) };
  if (operator === "yesterday") { start.setUTCDate(start.getUTCDate() - 1); return { from: iso(start), to: iso(start) }; }
  if (operator === "last_7_days") { start.setUTCDate(start.getUTCDate() - 6); return { from: iso(start), to: iso(new Date()) }; }
  if (operator === "this_month") return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: iso(new Date()) };
  if (operator === "this_quarter") {
    const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1))), to: iso(new Date()) };
  }
  if (operator === "fiscal_year") return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), to: iso(new Date()) };
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return { from: iso(start), to: iso(new Date()) };
}

export default function createDashboardBuilderRouter({ authenticate, authorize, db, canViewCompanyCustomers }) {
  const router = express.Router();
  const access = authorize("reports.custom.view");

  async function platformReportContext(req, objectId) {
    const objectResult = await db("SELECT * FROM platform_objects WHERE id=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [objectId, req.user.companyId]);
    const object = objectResult.rows[0];
    if (!object) return { object: null, fields: [] };
    const result = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND readable=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label", [object.id, req.user.companyId]);
    return { object, fields: result.rows };
  }

  async function dashboard(req, id) {
    const result = await db("SELECT * FROM dashboards WHERE id=$1 AND company_id=$2 AND archived_at IS NULL", [id, req.user.companyId]);
    return result.rows[0] || null;
  }
  const visible = async (req) => db(`SELECT d.*, u.full_name AS created_by_name
    FROM dashboards d LEFT JOIN users u ON u.id=d.created_by
    WHERE d.company_id=$1 AND d.archived_at IS NULL
    AND (d.created_by=$2 OR EXISTS (SELECT 1 FROM dashboard_users du WHERE du.dashboard_id=d.id AND du.user_id=$2)
         OR $3) ORDER BY d.updated_at DESC`, [req.user.companyId, req.user.id, canViewCompanyCustomers ? await canViewCompanyCustomers(req.user) : false]);

  router.get("/dashboards", authenticate, access, async (req, res) => {
    try { res.json({ success: true, data: (await visible(req)).rows }); }
    catch (error) { res.status(500).json({ success: false, message: "Unable to load dashboards" }); }
  });
  router.get("/dashboards/:id", authenticate, access, async (req, res) => {
    try { const row = await dashboard(req, req.params.id); if (!row) return res.status(404).json({ success: false, message: "Dashboard not found" }); res.json({ success: true, data: row }); }
    catch (error) { res.status(500).json({ success: false, message: "Unable to load dashboard" }); }
  });
  router.post("/dashboards", authenticate, authorize("reports.custom.create"), async (req, res) => {
    try {
      const value = validateDashboardDefinition(req.body);
      const result = await db(`INSERT INTO dashboards(company_id,created_by,name,description,components,filters)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING *`,
        [req.user.companyId, req.user.id, value.name, value.description, JSON.stringify(value.components), JSON.stringify(value.filters)]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(400).json({ success: false, message: error.message || "Unable to create dashboard" }); }
  });
  router.put("/dashboards/:id", authenticate, authorize("reports.custom.edit"), async (req, res) => {
    try {
      const current = await dashboard(req, req.params.id);
      if (!current) return res.status(404).json({ success: false, message: "Dashboard not found" });
      const companyAdmin = canViewCompanyCustomers ? await canViewCompanyCustomers(req.user) : false;
      if (String(current.created_by) !== String(req.user.id) && !companyAdmin) return res.status(403).json({ success: false, message: "Only the owner can edit this dashboard" });
      const value = validateDashboardDefinition({ ...req.body, name: req.body.name || current.name });
      const result = await db(`UPDATE dashboards SET name=$1,description=$2,components=$3::jsonb,filters=$4::jsonb,updated_at=NOW()
        WHERE id=$5 AND company_id=$6 RETURNING *`, [value.name, value.description, JSON.stringify(value.components), JSON.stringify(value.filters), req.params.id, req.user.companyId]);
      res.json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(400).json({ success: false, message: error.message || "Unable to update dashboard" }); }
  });
  router.put("/dashboards/:id/users", authenticate, authorize("reports.custom.share"), async (req, res) => {
    try {
      const current = await dashboard(req, req.params.id);
      const companyAdmin = canViewCompanyCustomers ? await canViewCompanyCustomers(req.user) : false;
      if (!current) return res.status(404).json({ success: false, message: "Dashboard not found" });
      if (!companyAdmin && String(current.created_by) !== String(req.user.id)) return res.status(403).json({ success: false, message: "Only the owner can share this dashboard" });
      const userIds = [...new Set((Array.isArray(req.body?.userIds) ? req.body.userIds : []).map(String))].slice(0, 100);
      const valid = userIds.length
        ? await db("SELECT id FROM users WHERE company_id=$1 AND id=ANY($2::uuid[]) AND active=true", [req.user.companyId, userIds])
        : { rows: [] };
      if (valid.rows.length !== userIds.length) return res.status(400).json({ success: false, message: "One or more users were not found" });
      await db("DELETE FROM dashboard_users WHERE dashboard_id=$1", [current.id]);
      for (const userId of userIds) await db("INSERT INTO dashboard_users(dashboard_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [current.id, userId]);
      res.json({ success: true, data: { userIds } });
    } catch (error) { res.status(400).json({ success: false, message: error.message || "Unable to share dashboard" }); }
  });
  router.post("/dashboards/:id/duplicate", authenticate, authorize("reports.custom.create"), async (req, res) => {
    try {
      const current = await dashboard(req, req.params.id); if (!current) return res.status(404).json({ success: false, message: "Dashboard not found" });
      const result = await db(`INSERT INTO dashboards(company_id,created_by,name,description,components,filters)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [req.user.companyId, req.user.id, `${current.name} (Copy)`, current.description, JSON.stringify(current.components), JSON.stringify(current.filters)]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { res.status(400).json({ success: false, message: "Unable to duplicate dashboard" }); }
  });
  router.delete("/dashboards/:id", authenticate, authorize("reports.custom.delete"), async (req, res) => {
    try {
      const current = await dashboard(req, req.params.id); if (!current) return res.status(404).json({ success: false, message: "Dashboard not found" });
      await db("UPDATE dashboards SET archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND company_id=$2", [req.params.id, req.user.companyId]);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, message: "Unable to archive dashboard" }); }
  });
  router.post("/dashboards/:id/run", authenticate, access, async (req, res) => {
    const row = await dashboard(req, req.params.id);
    if (!row) return res.status(404).json({ success: false, message: "Dashboard not found" });
    const results = await Promise.all((row.components || []).map(async (component) => {
      if (component.type === "text") return { id: component.id, type: "text", data: { content: component.config.content } };
      try {
        const report = await db("SELECT id, created_by, definition FROM custom_reports WHERE id=$1 AND company_id=$2 AND archived_at IS NULL", [component.config.reportId, req.user.companyId]);
        if (!report.rows[0]) throw new Error("Saved report unavailable");
        const savedReport = report.rows[0];
        const companyAdmin = canViewCompanyCustomers ? await canViewCompanyCustomers(req.user) : false;
        if (!companyAdmin && String(savedReport.created_by) !== String(req.user.id)) {
          const accessResult = await db("SELECT 1 FROM custom_report_users WHERE report_id=$1 AND user_id=$2", [savedReport.id, req.user.id]);
          if (!accessResult.rows.length) throw new Error("Saved report unavailable");
        }
        const definition = mergeDashboardFilters(savedReport.definition, row.filters);
        let built;
        if (definition.dataSource === "platform_object") {
          const context = await platformReportContext(req, definition.objectId);
          built = buildPlatformObjectQuery(definition, context.object, context.fields, req.user.companyId, 1000, { storeId: req.user.storeId });
        } else {
          const stores = definition.storeIds?.length ? definition.storeIds : (req.user.storeId ? [req.user.storeId] : []);
          built = buildCustomSalesQuery(definition, customDateRange(definition.filters), stores, definition.userIds || []);
          built.params[2] = req.user.companyId;
        }
        const result = await db(built.sql, built.params);
        return { id: component.id, type: component.type, data: { columns: definition.fields, rows: result.rows } };
      } catch (error) { return { id: component.id, type: component.type, error: "Unable to load this component" }; }
    }));
    res.json({ success: true, data: { components: results } });
  });
  return router;
}
