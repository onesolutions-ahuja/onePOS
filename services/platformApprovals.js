import { evaluateCondition } from "./platformConditions.js";

export async function submitPlatformApproval({ db, object, fields, recordId, record, req }) {
  try {
    const processes = await db(
      "SELECT * FROM platform_approval_processes WHERE object_id=$1 AND company_id=$2 AND active=true ORDER BY id",
      [object.id, req.user.companyId]
    );
    const process = processes.rows.find((candidate) =>
      evaluateCondition(candidate.conditions, fields, record)
    );
    if (!process) return null;
    const existing = await db(
      "SELECT id,status FROM platform_approval_requests WHERE process_id=$1 AND record_id=$2 AND company_id=$3 AND status='pending' LIMIT 1",
      [process.id, recordId, req.user.companyId]
    );
    if (existing.rows.length) return existing.rows[0];

    const steps = await db(
      "SELECT * FROM platform_approval_steps WHERE process_id=$1 ORDER BY step_order",
      [process.id]
    );
    if (!steps.rows.length) return null;

    const result = await db(
      "INSERT INTO platform_approval_requests (process_id,object_id,record_id,company_id,current_step,submitted_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [process.id, object.id, recordId, req.user.companyId, steps.rows[0].step_order, req.user.id || null]
    );
    return result.rows[0];
  } catch (error) {
    if (error.code) throw error;
    console.warn("Platform approval metadata is unavailable; record saved without approval submission.");
    return null;
  }
}

export async function decidePlatformApproval({ db, requestId, decision, comment, req }) {
  if (!["approve", "reject"].includes(decision)) {
    return { status: 400, message: "Decision must be approve or reject" };
  }
  const request = await db(
    "SELECT r.*, s.role_id, s.step_order, s.process_id FROM platform_approval_requests r JOIN platform_approval_steps s ON s.process_id=r.process_id AND s.step_order=r.current_step WHERE r.id=$1 AND r.company_id=$2 AND r.status='pending'",
    [requestId, req.user.companyId]
  );
  if (!request.rows.length) return { status: 404, message: "Pending approval request not found" };
  const current = request.rows[0];
  if (String(current.role_id) !== String(req.user.roleId)) return { status: 403, message: "You are not an approver for this step" };
  const prior = await db("SELECT id FROM platform_approval_actions WHERE request_id=$1 AND step_order=$2 LIMIT 1", [requestId, current.step_order]);
  if (prior.rows.length) return { status: 409, message: "This approval step has already been decided" };

  await db(
    "INSERT INTO platform_approval_actions (request_id,step_order,actor_user_id,decision,comment) VALUES ($1,$2,$3,$4,$5)",
    [requestId, current.step_order, req.user.id || null, decision, comment || null]
  );
  if (decision === "reject") {
    const result = await db("UPDATE platform_approval_requests SET status='rejected',resolved_at=NOW() WHERE id=$1 RETURNING *", [requestId]);
    return { status: 200, data: result.rows[0] };
  }

  const next = await db("SELECT step_order FROM platform_approval_steps WHERE process_id=$1 AND step_order>$2 ORDER BY step_order LIMIT 1", [current.process_id, current.step_order]);
  const result = next.rows.length
    ? await db("UPDATE platform_approval_requests SET current_step=$1 WHERE id=$2 RETURNING *", [next.rows[0].step_order, requestId])
    : await db("UPDATE platform_approval_requests SET status='approved',resolved_at=NOW() WHERE id=$1 RETURNING *", [requestId]);
  return { status: 200, data: result.rows[0] };
}
