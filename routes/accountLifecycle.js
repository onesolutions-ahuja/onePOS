import express from "express";
import bcrypt from "bcryptjs";
import { consumeAccountToken, hashAccountToken, domainAllowed, issueAccountToken, normalizeEmail, pendingPolicies } from "../services/accountPolicy.js";

export default function createAccountLifecycleRouter({ authenticate, authorize, db }) {
  const router = express.Router();

  router.get("/account/onboarding", authenticate, async (req,res) => {
    const u = await db("SELECT must_change_password FROM users WHERE id=$1 AND company_id=$2", [req.user.id,req.user.companyId]);
    const policies = await pendingPolicies(db,{companyId:req.user.companyId,userId:req.user.id});
    res.json({success:true,data:{mustChangePassword:u.rows[0]?.must_change_password===true,pendingPolicies:policies}});
  });
  router.get("/policies", authenticate, authorize("admin.settings"), async (req,res) => {
    const r=await db("SELECT * FROM platform_policies WHERE company_id=$1 ORDER BY api_key,version DESC",[req.user.companyId]); res.json({success:true,data:r.rows});
  });
  router.post("/policies", authenticate, authorize("admin.settings"), async (req,res) => {
    const {apiKey,name,title,body,policyType="COMPANY_POLICY",requireAcceptance=true,applicability={}}=req.body||{};
    if(!apiKey||!name||!title||!body) return res.status(400).json({success:false,message:"apiKey, name, title and body are required"});
    const v=await db("SELECT COALESCE(MAX(version),0)+1 version FROM platform_policies WHERE company_id=$1 AND api_key=$2",[req.user.companyId,apiKey]);
    const r=await db(`INSERT INTO platform_policies(company_id,api_key,name,policy_type,version,title,body,require_acceptance,applicability,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) RETURNING *`,[req.user.companyId,apiKey,name,policyType,v.rows[0].version,title,body,requireAcceptance,JSON.stringify(applicability),req.user.id]);
    res.status(201).json({success:true,data:r.rows[0]});
  });
  router.post("/policies/:id/activate", authenticate, authorize("admin.settings"), async (req,res) => {
    const p=await db("SELECT * FROM platform_policies WHERE id=$1 AND company_id=$2",[req.params.id,req.user.companyId]);
    if(!p.rows.length)return res.status(404).json({success:false,message:"Policy not found"});
    await db("UPDATE platform_policies SET status='INACTIVE',updated_at=NOW() WHERE company_id=$1 AND api_key=$2 AND status='ACTIVE'",[req.user.companyId,p.rows[0].api_key]);
    const r=await db("UPDATE platform_policies SET status='ACTIVE',published_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *",[req.params.id]);
    res.json({success:true,data:r.rows[0]});
  });
  router.post("/policies/:id/accept", authenticate, async (req,res) => {
    const p=await db("SELECT * FROM platform_policies WHERE id=$1 AND company_id=$2 AND status='ACTIVE'",[req.params.id,req.user.companyId]);
    if(!p.rows.length)return res.status(404).json({success:false,message:"Active policy not found"});
    await db(`INSERT INTO platform_policy_acceptances(company_id,policy_id,policy_version,user_id,evidence) VALUES($1,$2,$3,$4,$5::jsonb)
      ON CONFLICT(policy_id,policy_version,user_id) DO NOTHING`,[req.user.companyId,p.rows[0].id,p.rows[0].version,req.user.id,JSON.stringify({source:"ONBOARDING",userAgent:req.get("user-agent")||null})]);
    res.json({success:true});
  });

  router.get("/settings/account-policy", authenticate, authorize("admin.settings"), async(req,res)=>{
    const r=await db(`SELECT c.user_email_domain,cs.domain_users_only,cs.email_registration_enabled,cs.password_reset_email_enabled,
      cs.registration_link_expiry_minutes,cs.password_reset_expiry_minutes FROM companies c JOIN company_settings cs ON cs.company_id=c.id WHERE c.id=$1`,[req.user.companyId]);
    res.json({success:true,data:r.rows[0]||{}});
  });
  router.put("/settings/account-policy", authenticate, authorize("admin.settings"), async(req,res)=>{
    const b=req.body||{}; const domain=String(b.userEmailDomain||"").trim().toLowerCase().replace(/^@/,"")||null;
    await db("UPDATE companies SET user_email_domain=$1,updated_at=NOW() WHERE id=$2",[domain,req.user.companyId]);
    await db(`UPDATE company_settings SET domain_users_only=$1,email_registration_enabled=$2,password_reset_email_enabled=$3,
      registration_link_expiry_minutes=$4,password_reset_expiry_minutes=$5,updated_by=$6,updated_at=NOW() WHERE company_id=$7`,
      [b.domainUsersOnly===true,b.emailRegistrationEnabled===true,b.passwordResetEmailEnabled!==false,Math.max(5,Number(b.registrationLinkExpiryMinutes)||1440),Math.max(5,Number(b.passwordResetExpiryMinutes)||60),req.user.id,req.user.companyId]);
    res.json({success:true});
  });

  router.post("/account/invite/:userId", authenticate, authorize("admin.users"), async(req,res)=>{
    const r=await db(`SELECT u.id,u.email,u.company_id,c.user_email_domain,cs.domain_users_only,cs.email_registration_enabled,cs.registration_link_expiry_minutes
      FROM users u JOIN companies c ON c.id=u.company_id JOIN company_settings cs ON cs.company_id=c.id WHERE u.id=$1 AND u.company_id=$2`,[req.params.userId,req.user.companyId]);
    const u=r.rows[0]; if(!u)return res.status(404).json({success:false,message:"User not found"});
    if(!u.email_registration_enabled)return res.status(409).json({success:false,message:"Email registration is disabled"});
    if(!domainAllowed(u.email,u.user_email_domain,u.domain_users_only))return res.status(400).json({success:false,message:"User email is outside the allowed company domain"});
    const token=await issueAccountToken(db,{companyId:u.company_id,userId:u.id,purpose:"REGISTRATION",expiresMinutes:u.registration_link_expiry_minutes});
    // Token is returned only to the workflow caller so the registered message action can merge it into the approved template.
    res.json({success:true,data:{workflowEvent:"USER_REGISTRATION_REQUESTED",userId:u.id,email:normalizeEmail(u.email),token}});
  });

  router.post("/auth/password-reset/request", async(req,res)=>{
    const email=normalizeEmail(req.body?.email); const generic={success:true,message:"If the account is eligible, password reset instructions will be sent."};
    if(!email)return res.json(generic);
    const r=await db(`SELECT u.id,u.company_id,cs.password_reset_email_enabled,cs.password_reset_expiry_minutes FROM users u
      JOIN company_settings cs ON cs.company_id=u.company_id WHERE LOWER(u.email)=LOWER($1) AND u.active=TRUE LIMIT 1`,[email]);
    const u=r.rows[0]; if(!u?.password_reset_email_enabled)return res.json(generic);
    const token=await issueAccountToken(db,{companyId:u.company_id,userId:u.id,purpose:"PASSWORD_RESET",expiresMinutes:u.password_reset_expiry_minutes});
    // Production workflow consumes this event/token and sends the configured message template; public response remains generic.
    req.app.emit?.("onepos:workflow-event",{type:"PASSWORD_RESET_REQUESTED",companyId:u.company_id,userId:u.id,email,token});
    res.json(generic);
  });
  router.post("/auth/password-reset/complete", async(req,res)=>{
    const {token,password}=req.body||{}; if(!token||String(password||"").length<8)return res.status(400).json({success:false,message:"A valid token and password of at least 8 characters are required"});
    // Consume the token in the same SQL statement that changes the password. Merely opening
    // or abandoning the reset page never consumes the link, while a successful reset does.
    const passwordHash=await bcrypt.hash(password,12);
    const completed=await db(`WITH claimed AS (
      UPDATE account_action_tokens SET used_at=NOW()
       WHERE token_hash=$1 AND purpose='PASSWORD_RESET' AND used_at IS NULL AND expires_at>NOW()
       RETURNING company_id,user_id
    ), changed AS (
      UPDATE users u SET password_hash=$2,must_change_password=FALSE,updated_at=NOW()
       FROM claimed c WHERE u.id=c.user_id AND u.company_id=c.company_id
       RETURNING u.id
    ) SELECT id FROM changed`,[hashAccountToken(token),passwordHash]);
    if(!completed.rows.length)return res.status(400).json({success:false,message:"Reset link is invalid or expired"});
    res.json({success:true});
  });
  router.post("/auth/registration/complete", async(req,res)=>{
    const {token,password}=req.body||{}; if(!token||String(password||"").length<8)return res.status(400).json({success:false,message:"A valid token and password of at least 8 characters are required"});
    const t=await consumeAccountToken(db,{token,purpose:"REGISTRATION"}); if(!t)return res.status(400).json({success:false,message:"Registration link is invalid or expired"});
    await db("UPDATE users SET password_hash=$1,active=TRUE,must_change_password=FALSE,updated_at=NOW() WHERE id=$2 AND company_id=$3",[await bcrypt.hash(password,12),t.user_id,t.company_id]);
    res.json({success:true,data:{next:"POLICY_ONBOARDING"}});
  });

  router.get("/user-licences", authenticate, authorize("admin.users"), async(req,res)=>{
    const r=await db(`SELECT u.id,u.full_name,u.email,a.licence_id,l.name licence_name FROM users u LEFT JOIN user_licence_assignments a ON a.user_id=u.id LEFT JOIN licences l ON l.id=a.licence_id WHERE u.company_id=$1 ORDER BY u.full_name`,[req.user.companyId]); res.json({success:true,data:r.rows});
  });
  router.put("/user-licences/:userId", authenticate, authorize("admin.users"), async(req,res)=>{
    const licenceId=req.body?.licenceId; if(!licenceId){await db("DELETE FROM user_licence_assignments WHERE user_id=$1 AND company_id=$2",[req.params.userId,req.user.companyId]);return res.json({success:true});}
    const a=await db("SELECT seats FROM company_licence_allocations WHERE company_id=$1 AND licence_id=$2",[req.user.companyId,licenceId]); if(!a.rows.length)return res.status(403).json({success:false,message:"Licence is not allocated to this company"});
    const used=await db("SELECT COUNT(*)::int used FROM user_licence_assignments WHERE company_id=$1 AND licence_id=$2 AND user_id<>$3",[req.user.companyId,licenceId,req.params.userId]);
    if(used.rows[0].used>=a.rows[0].seats)return res.status(409).json({success:false,message:"No licence seats are available"});
    await db(`INSERT INTO user_licence_assignments(user_id,company_id,licence_id,assigned_by) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id) DO UPDATE SET licence_id=EXCLUDED.licence_id,assigned_by=EXCLUDED.assigned_by,assigned_at=NOW()`,[req.params.userId,req.user.companyId,licenceId,req.user.id]); res.json({success:true});
  });
  return router;
}
