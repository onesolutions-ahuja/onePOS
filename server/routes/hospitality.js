import express from "express";
import crypto from "node:crypto";
import { buildKitchenPrintPayload, validateQrOrderItems } from "../services/hospitalityActions.js";

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
          (SELECT r.reservation_time FROM hospitality_reservations r WHERE r.table_id=t.id AND r.reservation_date=CURRENT_DATE AND r.status='RESERVED' ORDER BY r.reservation_time LIMIT 1) AS reservation_time,
          COALESCE((SELECT SUM(q.total) FROM hospitality_qr_orders q WHERE q.table_id=t.id AND q.company_id=t.company_id AND q.payment_status='UNPAID' AND q.status <> 'CANCELLED'),0)::numeric AS current_bill,
          COALESCE((SELECT COUNT(*) FROM hospitality_qr_orders q WHERE q.table_id=t.id AND q.company_id=t.company_id AND q.payment_status='UNPAID' AND q.status <> 'CANCELLED'),0)::int AS open_order_count
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
      const requestedStatus = req.body.status == null ? null : String(req.body.status).toUpperCase();
      if (requestedStatus && !["EMPTY", "RESERVED", "OCCUPIED"].includes(requestedStatus)) return res.status(400).json({ success: false, message: "Invalid table status" });
      const result = await db(`UPDATE hospitality_tables SET table_number=COALESCE($3,table_number), name=COALESCE($4,name), capacity=COALESCE($5,capacity), shape=COALESCE($6,shape), position_x=COALESCE($7,position_x), position_y=COALESCE($8,position_y), active=COALESCE($9,active), status=COALESCE($10,status), updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *`, [req.params.id, req.user.companyId, req.body.tableNumber?.trim() || null, req.body.name?.trim() || null, req.body.capacity == null ? null : Number(req.body.capacity), req.body.shape || null, req.body.positionX == null ? null : Number(req.body.positionX), req.body.positionY == null ? null : Number(req.body.positionY), typeof req.body.active === "boolean" ? req.body.active : null, requestedStatus]);
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

  router.post("/hospitality/tables/:id/qr-session", authenticate, authorize("hospitality.tables.manage"), async (req, res) => {
    try {
      const table = await db("SELECT id,store_id FROM hospitality_tables WHERE id=$1 AND company_id=$2 AND active=true", [req.params.id, req.user.companyId]);
      if (!table.rows.length) return res.status(404).json({ success: false, message: "Table not found" });
      const token = crypto.randomBytes(32).toString("base64url");
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      await db("UPDATE hospitality_qr_sessions SET active=false WHERE company_id=$1 AND table_id=$2 AND active=true", [req.user.companyId, req.params.id]);
      await db("INSERT INTO hospitality_qr_sessions(company_id,store_id,table_id,token_hash,expires_at) VALUES($1,$2,$3,$4,$5)", [req.user.companyId, table.rows[0].store_id, req.params.id, hash, req.body?.expiresAt || null]);
      res.status(201).json({ success: true, data: { token, path: `/table-order/${token}` } });
    } catch (error) { console.error("QR session error:", error); res.status(500).json({ success: false, message: "Unable to create table QR session" }); }
  });

  router.get("/hospitality/public/qr/:token", async (req, res) => {
    try {
      const hash = crypto.createHash("sha256").update(req.params.token).digest("hex");
      const session = await db(`SELECT q.company_id,q.store_id,q.table_id,t.table_number,t.name AS table_name
        FROM hospitality_qr_sessions q JOIN hospitality_tables t ON t.id=q.table_id
        WHERE q.token_hash=$1 AND q.active=true AND (q.expires_at IS NULL OR q.expires_at>NOW())`, [hash]);
      if (!session.rows.length) return res.status(404).json({ success: false, message: "This table-order link is no longer active" });
      const ctx=session.rows[0];
      const products=await db("SELECT id,name,description,price,image_url FROM products WHERE company_id=$1 AND active=true ORDER BY name",[ctx.company_id]);
      res.json({success:true,data:{table:{id:ctx.table_id,number:ctx.table_number,name:ctx.table_name},products:products.rows}});
    } catch(error){ console.error("QR menu error:",error); res.status(500).json({success:false,message:"Unable to load menu"}); }
  });

  router.post("/hospitality/public/qr/:token/orders", async (req,res)=>{
    try{
      const requested=validateQrOrderItems(req.body?.items);
      const hash=crypto.createHash("sha256").update(req.params.token).digest("hex");
      const session=await db(`SELECT q.company_id,q.store_id,q.table_id,t.table_number FROM hospitality_qr_sessions q JOIN hospitality_tables t ON t.id=q.table_id WHERE q.token_hash=$1 AND q.active=true AND (q.expires_at IS NULL OR q.expires_at>NOW())`,[hash]);
      if(!session.rows.length)return res.status(404).json({success:false,message:"This table-order link is no longer active"});
      const ctx=session.rows[0], ids=requested.map(x=>x.productId);
      const products=await db("SELECT id,name,price FROM products WHERE company_id=$1 AND active=true AND id=ANY($2::uuid[])",[ctx.company_id,ids]);
      const byId=new Map(products.rows.map(x=>[String(x.id),x]));
      if(byId.size!==new Set(ids).size)return res.status(400).json({success:false,message:"One or more menu items are unavailable"});
      const items=requested.map(x=>({product_id:x.productId,name:byId.get(x.productId).name,quantity:x.quantity,unit_price:Number(byId.get(x.productId).price),notes:x.notes}));
      const total=items.reduce((n,x)=>n+x.quantity*x.unit_price,0);
      const orderNumber=`QR-${Date.now().toString(36).toUpperCase()}`;
      const mode=req.body?.paymentMode==="CARD"?"CARD":"PAY_AT_TILL";
      const order=await db("INSERT INTO hospitality_qr_orders(company_id,store_id,table_id,order_number,items,total,payment_mode) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING *",[ctx.company_id,ctx.store_id,ctx.table_id,orderNumber,JSON.stringify(items),total,mode]);
      await db("INSERT INTO hospitality_kds_tickets(company_id,store_id,table_id,order_number,items,notes) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[ctx.company_id,ctx.store_id,ctx.table_id,orderNumber,JSON.stringify(items),req.body?.notes||null]);
      await db("UPDATE hospitality_tables SET status=\'OCCUPIED\',updated_at=NOW() WHERE id=$1 AND company_id=$2",[ctx.table_id,ctx.company_id]);
      res.status(201).json({success:true,data:{order:order.rows[0],payment:{mode,status:"UNPAID",message:mode==="CARD"?"Card payment requires a configured payment-provider checkout; the order is not marked paid until provider confirmation.":"Pay at till"}}});
    }catch(error){console.error("QR order error:",error);res.status(400).json({success:false,message:error.message||"Unable to submit order"});}
  });

  router.get("/hospitality/kds/tickets/:id/print", authenticate, authorize("hospitality.kds.view"), async(req,res)=>{
    try{const result=await db(`SELECT k.*,t.table_number FROM hospitality_kds_tickets k LEFT JOIN hospitality_tables t ON t.id=k.table_id WHERE k.id=$1 AND k.company_id=$2 AND k.store_id=$3`,[req.params.id,req.user.companyId,req.user.storeId]);if(!result.rows.length)return res.status(404).json({success:false,message:"Kitchen ticket not found"});res.json({success:true,data:buildKitchenPrintPayload(result.rows[0])});}catch(error){res.status(500).json({success:false,message:"Unable to prepare kitchen print"});}
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
