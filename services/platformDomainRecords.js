import { systemObject, isExtensionField, tenantFields, safeSystemFields, appendSystemReadScope } from "./platformSystemObjects.js";
import { enrichFields, applyFieldSecurity, fieldValueError, normalizeFieldValue } from "./platformFieldValues.js";
import { compileFormulas, isCalculatedField } from "./platformFormula.js";
import { validateConditionalRequired } from "./platformConditions.js";
import { evaluateValidationRules } from "./platformValidation.js";
import { executePlatformAutomations } from "./platformAutomation.js";
import { submitPlatformApproval } from "./platformApprovals.js";

export class PlatformRecordError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; this.code = "PLATFORM_RECORD_INVALID"; }
}

// For profile/master endpoints that previously issued a single statement.
// The supplied write is the existing operation, with all original SQL/guards.
export async function withDomainSave({ pool, db, savePlatformRecord, key, req, id = null, write }) {
  if (!savePlatformRecord) return write(db);
  const definition = systemObject({ object_key: key });
  if (!definition) throw new PlatformRecordError("Unknown system object");
  const client = await pool.connect();
  const query = client.query.bind(client);
  try {
    await query("BEGIN");
    const previous = id ? (await query(`SELECT * FROM "${definition.table}" WHERE id=$1 AND company_id=$2 FOR UPDATE`, [id, req.user.companyId])).rows[0] : null;
    if (id && !previous) throw new PlatformRecordError("Record not found", 404);
    const result = await write(query);
    if (!result.rows?.[0]) throw new PlatformRecordError("Record not found", 404);
    result.rows[0].platform = await savePlatformRecord({ db: query, key, req, record: { ...previous, ...result.rows[0] }, previous });
    await query("COMMIT");
    return result;
  } catch (error) {
    await query("ROLLBACK"); throw error;
  } finally { client.release(); }
}

export async function domainMetadata(db, key, req) {
  if (!req.user?.companyId) throw new PlatformRecordError("A company session is required", 403);
  const result = await db("SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [key, req.user.companyId]);
  const object = result.rows[0];
  if (!object || systemObject(object)?.table !== object.source_table) throw new PlatformRecordError("System object is unavailable", 404);
  const resultFields = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label", [object.id, req.user.companyId]);
  const fields = await enrichFields(db, safeSystemFields(object, tenantFields(resultFields.rows, req.user.companyId)), req);
  // The business endpoint grants the ordinary edit capability. Field security
  // may narrow that capability; generic metadata's writable flag never grants
  // a business operation or permission.
  const access = await applyFieldSecurity(db, fields.map(field => ({ ...field, writable: field.source_column ? true : field.writable })), req);
  return { object, fields, access };
}

function apiValues(fields, row = {}) {
  return Object.fromEntries(fields.filter(field => field.source_column).map(field => [field.api_name, row?.[field.source_column] ?? null]));
}

function exposedExtensions(fields, values) {
  return Object.fromEntries(fields.filter(field => isExtensionField(field) && field.readable !== false)
    .map(field => [field.api_name, values[field.api_name] ?? null]));
}

export async function readDomainConfiguration(db, key, req, recordId = null) {
  const metadata = await domainMetadata(db, key, req);
  const { object, access } = metadata;
  let values = {}, recordTypeId = null;
  if (recordId) {
    const clauses = ["id=$1", "company_id=$2"], params = [recordId, req.user.companyId];
    appendSystemReadScope(object, req, clauses, params);
    const scoped = await db(`SELECT id FROM "${object.source_table}" WHERE ${clauses.join(" AND ")}`, params);
    if (!scoped.rows.length) throw new PlatformRecordError("Record not found", 404);
    const stored = await db("SELECT custom_values,record_type_id FROM platform_record_associations WHERE object_id=$1 AND record_id=$2 AND company_id=$3", [object.id, recordId, req.user.companyId]);
    values = stored.rows[0]?.custom_values || {};
    recordTypeId = stored.rows[0]?.record_type_id || null;
  }
  const layouts = await db("SELECT * FROM platform_layouts WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) AND (role_id IS NULL OR role_id=$3) ORDER BY company_id NULLS LAST, role_id NULLS LAST", [object.id, req.user.companyId, req.user.roleId || null]);
  const types = await db("SELECT * FROM platform_record_types WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY label", [object.id, req.user.companyId]);
  return { object, fields: access.filter(field => field.readable !== false), layouts: layouts.rows, recordTypes: types.rows, recordTypeId, customFields: exposedExtensions(access, values) };
}

// Called from the existing domain operation BEFORE its COMMIT, on that SAME
// client. A validation/automation/history error rolls back the business write.
// This function never inserts or updates an authoritative business table.
export async function saveDomainConfiguration({ db, key, req, record, previous = null }) {
  const { object, fields, access } = await domainMetadata(db, key, req);
  if (!record?.id) throw new PlatformRecordError("A saved business record is required");
  if (record.company_id && record.company_id !== req.user.companyId) throw new PlatformRecordError("Record not found", 404);
  const input = req.body?.platform || {};
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["customFields", "recordTypeId"].includes(key))) throw new PlatformRecordError("Invalid Platform values");
  const supplied = input.customFields || {};
  if (typeof supplied !== "object" || Array.isArray(supplied)) throw new PlatformRecordError("Custom fields must be an object");
  const association = await db("SELECT custom_values,record_type_id FROM platform_record_associations WHERE object_id=$1 AND record_id=$2 AND company_id=$3 FOR UPDATE", [object.id, record.id, req.user.companyId]);
  const stored = association.rows[0];
  const custom = { ...(stored?.custom_values || {}) };
  let typeId = input.recordTypeId === undefined ? stored?.record_type_id || null : input.recordTypeId;
  const types = await db("SELECT * FROM platform_record_types WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [object.id, req.user.companyId]);
  if (!previous && input.recordTypeId === undefined) typeId = types.rows.find(type => type.is_default)?.id || null;
  const type = typeId ? types.rows.find(type => type.id === typeId) : null;
  if (typeId && !type) throw new PlatformRecordError("Record type is unavailable");
  const restrictions = typeId ? (await db("SELECT field_id,value,active FROM platform_record_type_picklist_values WHERE record_type_id=$1", [typeId])).rows : [];
  if (!previous && type) {
    for (const field of fields.filter(isExtensionField)) {
      if (type.default_values?.[field.api_name] !== undefined) custom[field.api_name] = type.default_values[field.api_name];
    }
  }
  for (const [name, value] of Object.entries(supplied)) {
    const field = access.find(field => field.api_name === name && isExtensionField(field));
    if (!field || !field.writable || field.readable === false) throw new PlatformRecordError(`Field ${name} is not editable`, 403);
    const error = fieldValueError(field, value);
    if (error) throw new PlatformRecordError(error);
    custom[name] = normalizeFieldValue(field, value);
  }
  const before = { ...apiValues(fields, previous), ...(stored?.custom_values || {}) };
  const core = apiValues(fields, record);
  async function validateExtensionReferences(values) {
  for (const field of fields.filter(isExtensionField)) {
    const value = values[field.api_name];
    const allowed = restrictions.filter(item => item.field_id === field.id);
    if (allowed.length && value != null && value !== "" && !allowed.some(item => item.active !== false && item.value === value)) throw new PlatformRecordError(`${field.label} is unavailable for this record type`);
    if (field.field_type === "lookup" && value != null && value !== "") {
      const targetKey = field.config?.relatedObjectKey || field.config?.related_object_key || field.config?.objectKey;
      const target = (await db("SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [targetKey, req.user.companyId])).rows[0];
      if (!target || !/^[a-z_][a-z0-9_]*$/.test(target.source_table || "") || !/^[0-9a-f-]{36}$/i.test(String(value))) throw new PlatformRecordError(`${field.label} must reference an available record`);
      const clauses = ["id=$1", "company_id=$2"], params = [value, req.user.companyId];
      appendSystemReadScope(target, req, clauses, params);
      if (!(await db(`SELECT id FROM "${target.source_table}" WHERE ${clauses.join(" AND ")}`, params)).rows.length) throw new PlatformRecordError(`${field.label} must reference an available record`);
    }
  }
  }
  await validateExtensionReferences(custom);
  for (const field of access.filter(field => field.source_column)) {
    if ((field.readable === false || field.writable === false) && JSON.stringify(core[field.api_name]) !== JSON.stringify(before[field.api_name])) throw new PlatformRecordError(`Field ${field.label} is not editable`, 403);
  }
  const rules = await db("SELECT * FROM platform_rules WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) AND trigger_key IN ($3,'before_save') AND action->>'type'='validation' ORDER BY id", [object.id, req.user.companyId, previous ? "before_update" : "before_create"]);
  const calculate = compileFormulas(fields);
  const validate = values => {
    for (const field of fields.filter(isExtensionField)) {
      const error = fieldValueError(field, values[field.api_name]);
      if (error) throw new PlatformRecordError(error);
    }
    const conditional = validateConditionalRequired(fields, values);
    if (conditional) throw new PlatformRecordError(conditional);
    const errors = evaluateValidationRules(rules.rows, fields, values);
    if (errors.length) throw new PlatformRecordError(errors.map(error => error.message).join("; "));
  };
  let candidate = calculate({ ...core, ...custom });
  validate(candidate);
  const automated = await executePlatformAutomations({ db, object, fields: access, record: candidate, previousRecord: previous ? calculate(before) : null, recordId: record.id, trigger: previous ? "after_update" : "after_create", req,
    writeExtension: async (field, value, current) => {
      const error = fieldValueError(field, value);
      if (error) throw new PlatformRecordError(error);
      custom[field.api_name] = normalizeFieldValue(field, value);
      const next = calculate({ ...current, ...custom });
      validate(next);
      return next;
    },
  });
  candidate = automated.record;
  await validateExtensionReferences(candidate);
  const persisted = await db("INSERT INTO platform_record_associations (object_id,record_id,company_id,record_type_id,custom_values) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (object_id,record_id) DO UPDATE SET record_type_id=EXCLUDED.record_type_id,custom_values=EXCLUDED.custom_values,updated_at=NOW() WHERE platform_record_associations.company_id=EXCLUDED.company_id RETURNING record_id", [object.id, record.id, req.user.companyId, typeId, JSON.stringify(custom)]);
  if (!persisted.rows.length) throw new PlatformRecordError("Record association ownership mismatch", 403);
  for (const field of fields.filter(field => !isCalculatedField(field))) {
    const oldValue = previous ? before[field.api_name] ?? null : null;
    const newValue = candidate[field.api_name] ?? null;
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    await db("INSERT INTO platform_record_history (company_id,object_id,object_key,record_id,field_api_name,old_value,new_value,action,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)", [req.user.companyId, object.id, key, record.id, field.api_name, JSON.stringify(oldValue), JSON.stringify(newValue), previous ? "update" : "create", req.user.id || null]);
  }
  const approval = await submitPlatformApproval({ db, object, fields, recordId: record.id, record: candidate, req });
  return { customFields: exposedExtensions(access, custom), recordTypeId: typeId, messages: automated.messages, approval: approval ? { id: approval.id, status: approval.status } : null };
}
