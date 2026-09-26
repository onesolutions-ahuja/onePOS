import { enqueuePlatformJob } from "./platformJobs.js";

const SCHEDULE_TYPES = new Set(["ONCE", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "CRON"]);
const MAX_SEARCH_DAYS = 370;

function timePartsAt(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function localDateTimeToInstants(parts, timezone) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = desired + hours * 60 * 60 * 1000;
    const local = timePartsAt(new Date(probe), timezone);
    offsets.add(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - probe);
  }
  return [...offsets]
    .map((offset) => new Date(desired - offset))
    .filter((instant) => {
      const actual = timePartsAt(instant, timezone);
      return ["year", "month", "day", "hour", "minute", "second"].every((key) => actual[key] === (parts[key] || 0));
    })
    .sort((a, b) => a - b);
}

function normalizedTime(definition) {
  const hour = Number(definition.hour ?? String(definition.time || "00:00").split(":")[0]);
  const minute = Number(definition.minute ?? String(definition.time || "00:00").split(":")[1] ?? 0);
  const second = Number(definition.second ?? 0);
  if (![hour, minute, second].every(Number.isInteger) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new Error("Schedule time must contain a valid hour, minute and second");
  }
  return { hour, minute, second };
}

function localDateAt(epoch, timezone) {
  const { year, month, day } = timePartsAt(new Date(epoch), timezone);
  return { year, month, day };
}

function addLocalDays(date, days) {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function pickNextInstants(parts, timezone, after) {
  return localDateTimeToInstants(parts, timezone).find((instant) => instant > after) || null;
}

/**
 * Calculate the next occurrence strictly after `after`.
 * Definitions: ONCE {at} or {date, time}; HOURLY {minute?, second?};
 * DAILY {time?}; WEEKLY {dayOfWeek|daysOfWeek, time?} (Sunday=0);
 * MONTHLY {dayOfMonth, time?}. Local wall times are interpreted in `timezone`.
 */
export function calculateNextFire(scheduleType, definition = {}, timezone = "UTC", after = new Date()) {
  const type = String(scheduleType || "").toUpperCase();
  if (!SCHEDULE_TYPES.has(type)) throw new Error(`Unsupported schedule type: ${type || "(empty)"}`);
  if (type === "CRON") throw new Error("CRON schedules are not supported until a cron parser is available");
  const now = after instanceof Date ? after : new Date(after);
  if (Number.isNaN(now.getTime())) throw new Error("Invalid reference time");
  const current = timePartsAt(now, timezone);

  if (type === "ONCE") {
    if (definition.at || definition.runAt) {
      const value = definition.at || definition.runAt;
      if (!(value instanceof Date) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value))) {
        throw new Error("ONCE at/runAt timestamps must include a timezone offset; use date and time for a local wall time");
      }
      const instant = new Date(value);
      if (Number.isNaN(instant.getTime())) throw new Error("ONCE schedule requires a valid at/runAt timestamp");
      return instant > now ? instant : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(definition.date || ""))) throw new Error("ONCE schedule requires an ISO local date or an at timestamp");
    const [year, month, day] = definition.date.split("-").map(Number);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() + 1 !== month || calendarDate.getUTCDate() !== day) {
      throw new Error("ONCE date must be a valid ISO calendar date");
    }
    const parts = { year, month, day, ...normalizedTime(definition) };
    const instant = pickNextInstants(parts, timezone, now);
    if (!instant && !localDateTimeToInstants(parts, timezone).length) throw new Error("ONCE local time does not exist in the selected timezone");
    return instant;
  }

  if (type === "HOURLY") {
    const minute = Number(definition.minute ?? 0);
    const second = Number(definition.second ?? 0);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(second) || second < 0 || second > 59) {
      throw new Error("HOURLY minute and second must be between 0 and 59");
    }
    const startHour = Date.UTC(current.year, current.month - 1, current.day, current.hour);
    for (let offset = 0; offset <= MAX_SEARCH_DAYS * 24; offset += 1) {
      const wallHour = new Date(startHour + offset * 60 * 60 * 1000);
      const result = pickNextInstants({
        year: wallHour.getUTCFullYear(),
        month: wallHour.getUTCMonth() + 1,
        day: wallHour.getUTCDate(),
        hour: wallHour.getUTCHours(),
        minute,
        second,
      }, timezone, now);
      if (result) return result;
    }
    return null;
  }

  const time = normalizedTime(definition);
  if (type === "WEEKLY") {
    const days = definition.daysOfWeek ?? (definition.dayOfWeek === undefined ? [] : [definition.dayOfWeek]);
    const selectedDays = (Array.isArray(days) ? days : [days]).map(Number);
    if (!selectedDays.length || selectedDays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new Error("WEEKLY schedule requires dayOfWeek or daysOfWeek values from 0 (Sunday) to 6 (Saturday)");
    }
    definition = { ...definition, _selectedDays: selectedDays };
  }
  if (type === "MONTHLY" && (!Number.isInteger(Number(definition.dayOfMonth)) || Number(definition.dayOfMonth) < 1 || Number(definition.dayOfMonth) > 31)) {
    throw new Error("MONTHLY schedule requires dayOfMonth from 1 to 31");
  }

  const startDate = localDateAt(now.getTime(), timezone);
  for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset += 1) {
    const date = addLocalDays(startDate, offset);
    if (type === "WEEKLY" && !definition._selectedDays.includes(new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay())) continue;
    if (type === "MONTHLY" && date.day !== Number(definition.dayOfMonth)) continue;
    const instant = pickNextInstants({ ...date, ...time }, timezone, now);
    if (instant) return instant;
  }
  return null;
}

function validateScheduleInput({ scheduleType, definition, timezone }) {
  const type = String(scheduleType || "").toUpperCase();
  if (!SCHEDULE_TYPES.has(type)) throw new Error("A valid scheduleType is required");
  if (type === "CRON") throw new Error("CRON schedules are not supported until a cron parser is available");
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("Schedule definition must be an object");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone || "UTC" });
  } catch {
    throw new Error("Unknown schedule timezone");
  }
  return { type, timezone: timezone || "UTC" };
}

export async function listPlatformSchedules({ db, companyId }) {
  const result = await db(
    `SELECT s.* FROM platform_schedules s
     JOIN platform_rules w ON w.id=s.workflow_id AND w.company_id=s.company_id
     WHERE s.company_id=$1 ORDER BY s.created_at DESC`,
    [companyId]
  );
  return result.rows;
}

export async function createPlatformSchedule({
  db, companyId, workflowId, scheduleType, definition = {}, timezone = "UTC", active = false, createdBy = null, now = new Date(),
}) {
  const normalized = validateScheduleInput({ scheduleType, definition, timezone });
  const workflow = await db("SELECT id FROM platform_rules WHERE id=$1 AND company_id=$2", [workflowId, companyId]);
  if (!workflow.rows.length) throw new Error("Workflow not found in this company");
  const calculatedNextRunAt = calculateNextFire(normalized.type, definition, normalized.timezone, now);
  const nextRunAt = active ? calculatedNextRunAt : null;
  if (active && !nextRunAt) throw new Error("Schedule has no future fire time");
  const result = await db(
    `INSERT INTO platform_schedules
       (company_id,workflow_id,schedule_type,schedule_definition,timezone,active,next_run_at,execution_state,created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) RETURNING *`,
    [companyId, workflowId, normalized.type, JSON.stringify(definition), normalized.timezone, active === true, nextRunAt, active ? "READY" : "PAUSED", createdBy]
  );
  return result.rows[0];
}

export async function updatePlatformSchedule({ db, companyId, scheduleId, patch = {}, now = new Date() }) {
  const existing = await db("SELECT * FROM platform_schedules WHERE id=$1 AND company_id=$2", [scheduleId, companyId]);
  if (!existing.rows.length) return null;
  const current = existing.rows[0];
  const workflowId = patch.workflowId ?? patch.workflow_id ?? current.workflow_id;
  const definition = patch.definition ?? patch.scheduleDefinition ?? patch.schedule_definition ?? current.schedule_definition;
  const normalized = validateScheduleInput({
    scheduleType: patch.scheduleType ?? patch.schedule_type ?? current.schedule_type,
    definition,
    timezone: patch.timezone ?? current.timezone,
  });
  const workflow = await db("SELECT id FROM platform_rules WHERE id=$1 AND company_id=$2", [workflowId, companyId]);
  if (!workflow.rows.length) throw new Error("Workflow not found in this company");
  const active = patch.active === undefined ? current.active : patch.active === true;
  const calculatedNextRunAt = calculateNextFire(normalized.type, definition, normalized.timezone, now);
  const nextRunAt = active ? calculatedNextRunAt : null;
  if (active && !nextRunAt) throw new Error("Schedule has no future fire time");
  const result = await db(
    `UPDATE platform_schedules SET workflow_id=$1,schedule_type=$2,schedule_definition=$3::jsonb,timezone=$4,
       active=$5,next_run_at=$6,execution_state=$7,locked_until=NULL,last_error=NULL,updated_at=NOW()
     WHERE id=$8 AND company_id=$9 RETURNING *`,
    [workflowId, normalized.type, JSON.stringify(definition), normalized.timezone, active, nextRunAt, active ? "READY" : "PAUSED", scheduleId, companyId]
  );
  return result.rows[0] || null;
}

export async function deactivatePlatformSchedule({ db, companyId, scheduleId }) {
  const result = await db(
    `UPDATE platform_schedules SET active=FALSE,execution_state='PAUSED',locked_until=NULL,next_run_at=NULL,updated_at=NOW()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [scheduleId, companyId]
  );
  return result.rows[0] || null;
}

/**
 * Atomically claims due rows with SKIP LOCKED, then enqueues idempotent jobs.
 * Run from the host's scheduler; the worker should call completeScheduledWorkflow
 * or failScheduledWorkflow using the job payload after executing the workflow.
 */
export async function claimDueScheduledWorkflows({ db, limit = 20, leaseSeconds = 300, now = new Date() }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 100);
  const result = await db(
    `WITH due AS (
       SELECT id FROM platform_schedules
       WHERE active=TRUE AND next_run_at <= $1
         AND (execution_state='READY' OR (execution_state='RUNNING' AND (locked_until IS NULL OR locked_until <= $1)))
       ORDER BY next_run_at,created_at
       FOR UPDATE SKIP LOCKED LIMIT $2
     )
     UPDATE platform_schedules s SET execution_state='RUNNING',
       locked_until=$1 + ($3 * INTERVAL '1 second'),updated_at=NOW()
     FROM due WHERE s.id=due.id
     RETURNING s.id,s.company_id,s.workflow_id,s.schedule_type,s.schedule_definition,s.timezone,s.next_run_at AS fire_at`,
    [now, safeLimit, Math.max(Number(leaseSeconds) || 300, 30)]
  );
  const queued = [];
  for (const schedule of result.rows) {
    const fireAt = new Date(schedule.fire_at);
    const payload = {
      scheduleId: schedule.id,
      workflowId: schedule.workflow_id,
      companyId: schedule.company_id,
      triggerKey: "SCHEDULED",
      fireAt: fireAt.toISOString(),
    };
    try {
      const job = await enqueuePlatformJob({
        db,
        companyId: schedule.company_id,
        kind: "PLATFORM_SCHEDULED_WORKFLOW",
        payload,
        runAt: now,
        idempotencyKey: `schedule:${schedule.id}:${fireAt.toISOString()}`,
      });
      queued.push({ ...payload, jobId: job?.id || null, enqueued: Boolean(job) });
    } catch (error) {
      await db(
        `UPDATE platform_schedules SET execution_state='FAILED',last_error=$1,locked_until=NULL,updated_at=NOW()
         WHERE id=$2 AND execution_state='RUNNING'`,
        [String(error?.message || error).slice(0, 2000), schedule.id]
      );
      throw error;
    }
  }
  return queued;
}

export async function completeScheduledWorkflow({ db, payload }) {
  if (!payload?.scheduleId || !payload?.fireAt) throw new Error("Scheduled workflow job requires scheduleId and fireAt");
  const current = await db("SELECT * FROM platform_schedules WHERE id=$1 AND company_id=$2", [payload.scheduleId, payload.companyId]);
  if (!current.rows.length) return null;
  const schedule = current.rows[0];
  const fireAt = new Date(payload.fireAt);
  const oneTime = schedule.schedule_type === "ONCE";
  const nextRunAt = oneTime ? null : calculateNextFire(schedule.schedule_type, schedule.schedule_definition, schedule.timezone, fireAt);
  const result = await db(
    `UPDATE platform_schedules SET last_run_at=$1,next_run_at=$2,active=CASE WHEN $3 THEN FALSE ELSE active END,
      execution_state=CASE WHEN $3 THEN 'COMPLETED' ELSE 'READY' END,locked_until=NULL,last_error=NULL,updated_at=NOW()
    WHERE id=$4 AND company_id=$5 AND execution_state='RUNNING' AND next_run_at=$1 RETURNING *`,
    [fireAt, nextRunAt, oneTime, payload.scheduleId, payload.companyId]
  );
  return result.rows[0] || null;
}

export async function failScheduledWorkflow({ db, payload, error }) {
  if (!payload?.scheduleId || !payload?.companyId || !payload?.fireAt) throw new Error("Scheduled workflow job requires scheduleId, companyId and fireAt");
  const result = await db(
    `UPDATE platform_schedules SET execution_state='FAILED',last_error=$1,locked_until=NULL,updated_at=NOW()
     WHERE id=$2 AND company_id=$3 AND execution_state='RUNNING' AND next_run_at=$4 RETURNING *`,
    [String(error?.message || error || "Scheduled workflow failed").slice(0, 2000), payload.scheduleId, payload.companyId, new Date(payload.fireAt)]
  );
  return result.rows[0] || null;
}
