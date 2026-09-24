export async function clockInAttendance({ db, companyId, userId, storeId }) {
  if (!db || !companyId || !userId) throw new Error("attendance.clock_in requires authenticated context");
  const user = await db(`SELECT id, company_id, store_id, active FROM users WHERE id=$1 AND company_id=$2 LIMIT 1`, [userId, companyId]);
  if (!user.rows.length || !user.rows[0].active) throw new Error("User account is unavailable or disabled");
  const effectiveStoreId = storeId || user.rows[0].store_id;
  if (!effectiveStoreId) throw new Error("No store assigned to user");
  const existing = await db(`SELECT id, clock_in FROM attendance_records WHERE user_id=$1 AND status='open' LIMIT 1`, [userId]);
  if (existing.rows.length) return { alreadyOpen: true, record: existing.rows[0] };
  const result = await db(`INSERT INTO attendance_records (company_id,store_id,user_id,status,clock_in) VALUES ($1,$2,$3,'open',NOW()) RETURNING *`, [companyId,effectiveStoreId,userId]);
  return { alreadyOpen: false, record: result.rows[0] };
}

export async function clockOutAttendance({ db, companyId, userId }) {
  if (!db || !companyId || !userId) throw new Error("attendance.clock_out requires authenticated context");
  const result = await db(`UPDATE attendance_records SET status='closed', clock_out=NOW(), worked_minutes=GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-clock_in))/60))::int, updated_at=NOW() WHERE user_id=$1 AND company_id=$2 AND status='open' RETURNING *`, [userId,companyId]);
  if (!result.rows.length) return { closed: false, record: null };
  return { closed: true, record: result.rows[0] };
}
