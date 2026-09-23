import express from "express";

export default function createHospitalityRouter({ authenticate, authorize, db, pool }) {
  const router = express.Router();
  const scope = (req) => [req.user.companyId, req.query.storeId || req.user.storeId];

  router.get("/hospitality/floors", authenticate, authorize("hospitality.tables.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT f.*, COUNT(t.id)::int AS table_count
           FROM hospitality_floors f LEFT JOIN hospitality_tables t ON t.floor_id=f.id AND t.active=true
          WHERE f.company_id=$1 AND f.store_id=$2 GROUP BY f.id ORDER BY f.display_order, f.name`,
        scope(req)
      );
      res.json({ success: true, data: result.rows });
    } catch (error) { console.error("Hospitality floors error:", error); res.status(500).json({ success: false, message: "Unable to load floors" }); }
  });

  router.post("/hospitality/floors", authenticate, authorize("hospitality.tables.manage"), async (req, res) => {
    const { name, storeId = req.user.storeId, displayOrder = 0 } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ success: false, message: "Floor name is required" });
    try {
      const result = await db(`INSERT INTO hospitality_floors (company_id,store_id,name,display_order) VALUES ($1,$2,$3,$4) RETURNING *`, [req.user.companyId, storeId, name.trim(), Number(displayOrder) || 0]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { console.error("Create floor error:", error); res.status(500).json({ success: false, message: "Unable to create floor" }); }
  });

  router.put("/hospitality/floors/:id", authenticate, authorize("hospitality.tables.manage"), async (req, res) => {
    try {
      const result = await db(`UPDATE hospitality_floors SET name=COALESCE($3,name), active=COALESCE($4,active), display_order=COALESCE($5,display_order), updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *`, [req.params.id, req.user.companyId, req.body.name?.trim() || null, typeof req.body.active === "boolean" ? req.body.active : null, Number.isFinite(Number(req.body.displayOrder)) ? Number(req.body.displayOrder) : null]);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Floor not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) { console.error("Update floor error:", error); res.status(500).json({ success: false, message: "Unable to update floor" }); }
  });

  router.get("/hospitality/tables", authenticate, authorize("hospitality.tables.view"), async (req, res) => {
    try {
      const result = await db(
        `SELECT t.*, f.name AS floor_name,
          COALESCE((SELECT r.status FROM hospitality_reservations r WHERE r.table_id=t.id AND r.reservation_date=CURRENT_DATE AND r.status='RESERVED' ORDER BY r.reservation_time LIMIT 1),'') AS reservation_status,
          (SELECT r.reservation_time FROM hospitality_reservations r WHERE r.table_id=t.id AND r.reservation_date=CURRENT_DATE AND r.status='RESERVED' ORDER BY r.reservation_time LIMIT 1) AS reservation_time
         FROM hospitality_tables t JOIN hospitality_floors f ON f.id=t.floor_id
        WHERE t.company_id=$1 AND t.store_id=$2 AND t.active=true ORDER BY f.display_order,t.table_number`,
        scope(req)
      );
      res.json({ success: true, data: result.rows });
    } catch (error) { console.error("Hospitality tables error:", error); res.status(500).json({ success: false, message: "Unable to load tables" }); }
  });

  router.post("/hospitality/tables", authenticate, authorize("hospitality.tables.manage"), async (req, res) => {
    const { floorId, tableNumber, name = null, capacity = 2, shape = "square", positionX = 0, positionY = 0 } = req.body || {};
    if (!floorId || !tableNumber?.trim()) return res.status(400).json({ success: false, message: "Floor and table number are required" });
    try {
      const result = await db(`INSERT INTO hospitality_tables (company_id,store_id,floor_id,table_number,name,capacity,shape,position_x,position_y) SELECT $1,store_id,id,$3,$4,$5,$6,$7,$8 FROM hospitality_floors WHERE id=$2 AND company_id=$1 RETURNING *`, [req.user.companyId, floorId, tableNumber.trim(), name?.trim() || null, Number(capacity) || 2, shape, Number(positionX) || 0, Number(positionY) || 0]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { console.error("Create table error:", error); res.status(500).json({ success: false, message: "Unable to create table" }); }
  });

  router.put("/hospitality/tables/:id", authenticate, authorize("hospitality.tables.manage"), async (req, res) => {
    try {
      const result = await db(`UPDATE hospitality_tables SET table_number=COALESCE($3,table_number), name=COALESCE($4,name), capacity=COALESCE($5,capacity), shape=COALESCE($6,shape), position_x=COALESCE($7,position_x), position_y=COALESCE($8,position_y), active=COALESCE($9,active), updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *`, [req.params.id, req.user.companyId, req.body.tableNumber?.trim() || null, req.body.name?.trim() || null, req.body.capacity == null ? null : Number(req.body.capacity), req.body.shape || null, req.body.positionX == null ? null : Number(req.body.positionX), req.body.positionY == null ? null : Number(req.body.positionY), typeof req.body.active === "boolean" ? req.body.active : null]);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Table not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) { console.error("Update table error:", error); res.status(500).json({ success: false, message: "Unable to update table" }); }
  });

  router.get("/hospitality/reservations", authenticate, authorize("hospitality.reservations.view"), async (req, res) => {
    try {
      const result = await db(`SELECT r.*, t.table_number FROM hospitality_reservations r LEFT JOIN hospitality_tables t ON t.id=r.table_id WHERE r.company_id=$1 AND r.store_id=$2 AND r.reservation_date BETWEEN COALESCE($3::date,CURRENT_DATE) AND COALESCE($4::date,CURRENT_DATE+7) ORDER BY r.reservation_date,r.reservation_time`, [req.user.companyId, req.query.storeId || req.user.storeId, req.query.dateFrom || null, req.query.dateTo || null]);
      res.json({ success: true, data: result.rows });
    } catch (error) { console.error("Reservations error:", error); res.status(500).json({ success: false, message: "Unable to load reservations" }); }
  });

  router.post("/hospitality/reservations", authenticate, authorize("hospitality.reservations.manage"), async (req, res) => {
    const { tableId = null, customerId = null, customerName, reservationDate, reservationTime, guests, notes = null } = req.body || {};
    if (!customerName?.trim() || !reservationDate || !reservationTime || !Number.isInteger(Number(guests)) || Number(guests) < 1) return res.status(400).json({ success: false, message: "Name, date, time and guests are required" });
    try {
      const result = await db(`INSERT INTO hospitality_reservations (company_id,store_id,table_id,customer_id,customer_name,reservation_date,reservation_time,guests,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [req.user.companyId, req.user.storeId, tableId, customerId, customerName.trim(), reservationDate, reservationTime, Number(guests), notes?.trim() || null, req.user.id]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) { console.error("Create reservation error:", error); res.status(500).json({ success: false, message: "Unable to create reservation" }); }
  });

  router.get("/hospitality/kds/tickets", authenticate, authorize("hospitality.kds.view"), async (req, res) => {
    try {
      const result = await db(`SELECT k.*, t.table_number FROM hospitality_kds_tickets k LEFT JOIN hospitality_tables t ON t.id=k.table_id WHERE k.company_id=$1 AND k.store_id=$2 AND k.status <> 'COMPLETED' ORDER BY k.created_at`, [req.user.companyId, req.user.storeId]);
      res.json({ success: true, data: result.rows });
    } catch (error) { console.error("KDS error:", error); res.status(500).json({ success: false, message: "Unable to load kitchen tickets" }); }
  });

  router.put("/hospitality/kds/tickets/:id", authenticate, authorize("hospitality.kds.manage"), async (req, res) => {
    if (!["NEW", "IN_PREPARATION", "READY", "COMPLETED"].includes(req.body.status)) return res.status(400).json({ success: false, message: "Invalid kitchen status" });
    try {
      const result = await db(`UPDATE hospitality_kds_tickets SET status=$3, updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *`, [req.params.id, req.user.companyId, req.body.status]);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Kitchen ticket not found" });
      res.json({ success: true, data: result.rows[0] });
    } catch (error) { console.error("KDS update error:", error); res.status(500).json({ success: false, message: "Unable to update kitchen ticket" }); }
  });
  return router;
}
