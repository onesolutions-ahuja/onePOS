const RESET_POLICIES = new Set(["NEVER", "DAILY", "MONTHLY", "YEARLY"]);
const SAFE_KEY = /^[a-z_][a-z0-9_]{0,99}$/i;

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function normalizeSequenceConfig(input = {}) {
  const prefix = input.prefix === undefined ? "" : input.prefix;
  const suffix = input.suffix === undefined ? "" : input.suffix;
  const numericLength = input.numericLength === undefined ? 8 : Number(input.numericLength);
  const startingNumber = input.startingNumber === undefined ? "1" : String(input.startingNumber);
  const incrementBy = input.incrementBy === undefined ? "1" : String(input.incrementBy);
  const resetPolicy = String(input.resetPolicy || "NEVER").toUpperCase();
  if (typeof prefix !== "string" || prefix.length > 50 || typeof suffix !== "string" || suffix.length > 50) throw invalid("Prefix and suffix must be strings of at most 50 characters");
  if (!Number.isInteger(numericLength) || numericLength < 1 || numericLength > 18) throw invalid("numericLength must be between 1 and 18");
  if (!/^\d{1,18}$/.test(startingNumber) || BigInt(startingNumber) < 1n) throw invalid("startingNumber must be a positive integer");
  if (!/^\d{1,18}$/.test(incrementBy) || BigInt(incrementBy) < 1n) throw invalid("incrementBy must be a positive integer");
  if (!RESET_POLICIES.has(resetPolicy)) throw invalid("resetPolicy must be NEVER, DAILY, MONTHLY or YEARLY");
  return { prefix, suffix, numericLength, startingNumber, incrementBy, resetPolicy };
}

function validateScope({ companyId, storeId, objectKey, sequenceKey }) {
  if (!companyId || (storeId !== null && storeId !== undefined && !/^[0-9a-f-]{36}$/i.test(String(storeId)))) throw invalid("A valid company and optional store scope are required");
  if (typeof objectKey !== "string" || !SAFE_KEY.test(objectKey) || typeof sequenceKey !== "string" || !SAFE_KEY.test(sequenceKey)) {
    throw invalid("objectKey and sequenceKey must be valid registered keys");
  }
}

async function transaction(pool, operation) {
  if (!pool?.connect) throw Object.assign(new Error("Atomic sequence allocation requires a database pool"), { status: 503 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client.query.bind(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function periodKey(policy, dateParts) {
  if (policy === "DAILY") return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  if (policy === "MONTHLY") return `${dateParts.year}-${dateParts.month}`;
  if (policy === "YEARLY") return dateParts.year;
  return "";
}

function companyDateParts(date, timezone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    formatter.format(date);
  } catch {
    throw new Error("Company timezone is invalid");
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

export async function allocatePlatformSequence({ pool, companyId, storeId = null, objectKey, sequenceKey }) {
  validateScope({ companyId, storeId, objectKey, sequenceKey });
  return transaction(pool, async (query) => {
    const scopeLock = `${companyId}:${storeId || ""}:${objectKey}:${sequenceKey}`;
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [scopeLock]);
    const found = await query(
      `SELECT * FROM platform_sequences
       WHERE company_id=$1 AND store_id IS NOT DISTINCT FROM $2 AND object_key=$3 AND sequence_key=$4
       FOR UPDATE`,
      [companyId, storeId || null, objectKey, sequenceKey]
    );
    const sequence = found.rows[0];
    if (!sequence || sequence.active !== true) throw Object.assign(new Error("Active sequence configuration was not found"), { status: 404 });
    const company = await query("SELECT timezone FROM companies WHERE id=$1", [companyId]);
    const key = periodKey(sequence.reset_policy, companyDateParts(new Date(), company.rows[0]?.timezone || "UTC"));
    const shouldReset = sequence.reset_policy !== "NEVER" && sequence.period_key !== key;
    const allocated = BigInt(shouldReset ? sequence.starting_number : sequence.next_number);
    const next = allocated + BigInt(sequence.increment_by);
    await query(
      `UPDATE platform_sequences
       SET next_number=$1,period_key=$2,updated_at=NOW()
       WHERE id=$3`,
      [next.toString(), key, sequence.id]
    );
    const formatted = allocated.toString().padStart(sequence.numeric_length, "0");
    return {
      value: `${sequence.prefix}${formatted}${sequence.suffix}`,
      number: allocated.toString(),
      companyId,
      storeId: storeId || null,
      objectKey,
      sequenceKey,
      periodKey: key,
    };
  });
}

export async function upsertPlatformSequence({ pool, companyId, storeId = null, objectKey, sequenceKey, config }) {
  validateScope({ companyId, storeId, objectKey, sequenceKey });
  const normalized = normalizeSequenceConfig(config);
  return transaction(pool, async (query) => {
    const scopeLock = `${companyId}:${storeId || ""}:${objectKey}:${sequenceKey}`;
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [scopeLock]);
    const current = await query(
      `SELECT id FROM platform_sequences
       WHERE company_id=$1 AND store_id IS NOT DISTINCT FROM $2 AND object_key=$3 AND sequence_key=$4
       FOR UPDATE`,
      [companyId, storeId || null, objectKey, sequenceKey]
    );
    if (current.rows.length) {
      const result = await query(
        `UPDATE platform_sequences
         SET prefix=$1,suffix=$2,numeric_length=$3,starting_number=$4,increment_by=$5,
             next_number=GREATEST(next_number,$4),reset_policy=$6,active=$7,updated_at=NOW()
         WHERE id=$8
         RETURNING id,company_id,store_id,object_key,sequence_key,prefix,suffix,numeric_length,starting_number,increment_by,next_number,reset_policy,period_key,active,created_at,updated_at`,
        [normalized.prefix, normalized.suffix, normalized.numericLength, normalized.startingNumber, normalized.incrementBy, normalized.resetPolicy, config?.active !== false, current.rows[0].id]
      );
      return result.rows[0];
    }
    const result = await query(
      `INSERT INTO platform_sequences
         (company_id,store_id,object_key,sequence_key,prefix,suffix,numeric_length,starting_number,increment_by,next_number,reset_policy,period_key,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$8,$10,'',$11)
       RETURNING id,company_id,store_id,object_key,sequence_key,prefix,suffix,numeric_length,starting_number,increment_by,next_number,reset_policy,period_key,active,created_at,updated_at`,
      [companyId, storeId || null, objectKey, sequenceKey, normalized.prefix, normalized.suffix, normalized.numericLength, normalized.startingNumber, normalized.incrementBy, normalized.resetPolicy, config?.active !== false]
    );
    return result.rows[0];
  });
}
