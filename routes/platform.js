import { normalizePicklistOptions, localPicklistOptions, fieldValueError, normalizeFieldValue, enrichFields, applyFieldSecurity, resolveEffectiveFieldSecurity, valueSetOptions } from "../services/platformFieldValues.js";
import express from "express";
import { isSafeIdentifier, toSafeApiName } from "../services/platformMetadata.js";
import { normalizeObjectPageDefinition, objectNavigationEntries, OBJECT_RUNTIME_ROUTE_PREFIX } from "../services/platformObjectNavigation.js";
import { evaluateValidationRules, validationRuleError } from "../services/platformValidation.js";
import { compileFormulas, FormulaError, isCalculatedField, normalizeRollupConfig, ROLLUP_OPERATIONS } from "../services/platformFormula.js";
import { ConditionError, evaluateCondition, validateConditionConfig, validateConditionalRequired } from "../services/platformConditions.js";
import { executePlatformAutomations } from "../services/platformAutomation.js";
import { hasConfiguredCommunicationProvider } from "../services/platformWorkflow.js";
import {
  createWorkflowRun,
  executeWorkflowAction,
  executeWorkflowActions,
  getRegisteredFunction,
  getRegisteredFunctionsRegistry,
  getWorkflowActionDefinition,
  getWorkflowActionRegistry,
  validateWorkflowAction,
} from "../services/platformWorkflow.js";
import { decidePlatformApproval, submitPlatformApproval } from "../services/platformApprovals.js";
import { systemObject, tenantFields, isExtensionField, safeSystemFields, hydrateExtensions, appendSystemReadScope, platformFieldSql } from "../services/platformSystemObjects.js";
import { readDomainConfiguration, saveDomainConfiguration, withDomainSave } from "../services/platformDomainRecords.js";
import { internalAppCatalog } from "../services/internalAppCatalog.js";
import { moduleRuntimeAccess } from "../services/authorization.js";
import { normalizeDeviceProfile } from "../services/runtimeAccess.js";
import { buildRecordPathCatalog } from "../services/platformRecordPaths.js";
import { getCompanyEntitlements, isPackageLicensed } from "../services/licensing.js";
import { resolvePageLayout } from "../services/platformLayoutResolver.js";
import { searchPlatformRecords } from "../services/platformSearch.js";
import { PLATFORM_FIELD_TYPE_SET } from "../services/platformFieldTypes.js";
import { listRegisteredPlatformActions } from "../services/platformActionRegistry.js";
import { listPlatformComponents } from "../services/platformComponentRegistry.js";
import { BUTTON_VARIANTS, validateButtonDefinition } from "../services/platformButtonRegistry.js";

const FIELD_TYPES = PLATFORM_FIELD_TYPE_SET;
const PAGE_TYPES = new Set(["list", "detail", "view", "create", "edit", "quick_create"]);
const RELATIONSHIP_TYPES = new Set(["lookup", "one_to_many", "many_to_many"]);
const RELATIONSHIP_POLICIES = new Set(["restrict", "cascade", "set_null"]);

function validObjectInput(body) {
  return body && (body.objectKey === undefined || (typeof body.objectKey === "string" && isSafeIdentifier(body.objectKey)))
    && (body.apiName === undefined || (typeof body.apiName === "string" && isSafeIdentifier(body.apiName)))
    && typeof body.label === "string" && body.label.trim().length > 0
    && (!body.sourceTable || isSafeIdentifier(body.sourceTable));
}

function validFieldInput(body) {
  return body && (body.apiName === undefined || (typeof body.apiName === "string" && isSafeIdentifier(body.apiName)))
    && typeof body.label === "string" && body.label.trim().length > 0
    && FIELD_TYPES.has(body.fieldType)
    && (!body.sourceColumn || isSafeIdentifier(body.sourceColumn));
}





function validValueSetInput(body) {
  return body && typeof body.label === "string" && body.label.trim().length > 0
    && (body.valueSetKey === undefined || isSafeIdentifier(body.valueSetKey));
}

function validLayoutInput(body) {
  // The historical client sends page_type (snake_case); the documented contract
  // is pageType (camelCase). Accepting both keeps every existing caller valid.
  const pageType = body?.pageType ?? body?.page_type;
  return body && typeof body.name === "string" && body.name.trim().length > 0
    && PAGE_TYPES.has(pageType) && body.definition && Array.isArray(body.definition.components);
}

async function validateLayoutRole(db, roleId, req) {
  if (!roleId) return true;
  const result = await db("SELECT id FROM roles WHERE id=$1 AND company_id=$2", [roleId, req.user.companyId]);
  return result.rows.length > 0;
}

async function validateLayoutDefinition(db, definition, object, req) {
  const sections = Array.isArray(definition.sections) ? definition.sections : [];
  const components = [
    ...(Array.isArray(definition.components) ? definition.components : []),
    ...sections.flatMap((section) => Array.isArray(section.items) ? section.items : []),
  ];
  const fields = await db(
    "SELECT api_name FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
    [object.id, req.user.companyId]
  );
  const allowedFields = new Set(fields.rows.map((field) => field.api_name));
  const sectionIds = new Set(sections.map((section) => section.id).filter(Boolean));
  if (sections.length !== sectionIds.size) return "Layout sections must have unique ids";
  const componentIds = new Set();
  for (const [index, component] of components.entries()) {
    if (!component || typeof component !== "object") return "Layout contains an invalid component";
    const componentId = String(component.id || `${component.type || "component"}-${component.field_key || index + 1}`);
    if (componentIds.has(componentId)) return "Layout components must have unique ids";
    componentIds.add(componentId);
    if (component.type && !["field", "text", "divider", "spacer", "header", "action", "button", "related_list"].includes(component.type)) {
      return `Unsupported layout component type "${component.type}"`;
    }
    if (component.width && !["full", "1/2", "1/3", "2/3", "1/4"].includes(component.width)) {
      return `Unsupported component width "${component.width}"`;
    }
    if (component?.type === "button") {
      try {
        const button = validateButtonDefinition({
          buttonKey: component.button_key || component.id || `button_${index + 1}`,
          label: component.label || "Button",
          icon: component.icon,
          variant: component.variant,
          targetType: component.target_type,
          targetKey: component.target_key,
          requiredPermission: component.required_permission,
          visibilityRule: component.visibility_rule || {},
          inputMappings: component.input_mappings || {},
          config: component.config || {},
        });
        if (button.targetType === "workflow") {
          const target = await db(
            `SELECT id FROM platform_rules WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) AND (id::text=$3 OR name=$3) LIMIT 1`,
            [object.id, req.user.companyId, button.targetKey]
          );
          if (!target.rows.length) return "Button must reference an existing workflow";
        } else {
          const core = listRegisteredPlatformActions().some((item) => item.key === button.targetKey);
          if (!core) {
            const target = await db(
              "SELECT id FROM platform_registered_actions WHERE action_key=$1 AND object_id=$2 AND (company_id IS NULL OR company_id=$3) AND active=true LIMIT 1",
              [button.targetKey, object.id, req.user.companyId]
            );
            if (!target.rows.length) return "Button must reference a registered action";
          }
        }
      } catch (error) { return error.message; }
      continue;
    }
    if (component?.type !== "field") continue;
    if (typeof component.field_key !== "string" || !allowedFields.has(component.field_key)) {
      return `Field "${component?.field_key || ""}" does not belong to this object`;
    }
    if (component.section_id && sections.length && !sectionIds.has(component.section_id)) {
      return "A layout field references an invalid section";
    }
  }
  return null;
}

async function syncLayoutButtons(db, req, layout, { deactivateExisting = true } = {}) {
  const definition = layout?.definition || {};
  const sections = Array.isArray(definition.sections) ? definition.sections : [];
  const components = [
    ...(Array.isArray(definition.components) ? definition.components : []),
    ...sections.flatMap((section) => Array.isArray(section.items) ? section.items : []),
  ].filter((component) => component?.type === "button");
  if (deactivateExisting) {
    await db(
      "UPDATE platform_buttons SET active=false,user_modified=true,updated_at=NOW() WHERE company_id=$1 AND object_id=$2 AND config->>'layoutId'=$3",
      [req.user.companyId, layout.object_id, String(layout.id)]
    );
  }
  for (const [index, component] of components.entries()) {
    const buttonKey = toSafeApiName(component.button_key || `${layout.layout_key}_${component.id || component.label || index + 1}`, "button");
    const button = validateButtonDefinition({
      buttonKey,
      label: component.label || "Button",
      icon: component.icon,
      variant: component.variant,
      targetType: component.target_type,
      targetKey: component.target_key,
      placement: layout.page_type || "record",
      requiredPermission: component.required_permission,
      visibilityRule: component.visibility_rule || {},
      inputMappings: component.input_mappings || {},
      config: { ...(component.config || {}), layoutId: String(layout.id), componentId: String(component.id || index) },
    });
    await db(
      `INSERT INTO platform_buttons
       (company_id,object_id,button_key,label,icon,action_key,target_type,target_key,variant,placement,required_permission,visibility_rule,input_mappings,config,active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,true)
       ON CONFLICT (company_id,button_key) WHERE company_id IS NOT NULL DO UPDATE SET
       object_id=EXCLUDED.object_id,label=EXCLUDED.label,icon=EXCLUDED.icon,action_key=EXCLUDED.action_key,target_type=EXCLUDED.target_type,
       target_key=EXCLUDED.target_key,variant=EXCLUDED.variant,placement=EXCLUDED.placement,required_permission=EXCLUDED.required_permission,
       visibility_rule=EXCLUDED.visibility_rule,input_mappings=EXCLUDED.input_mappings,config=EXCLUDED.config,active=true,updated_at=NOW()`,
      [req.user.companyId, layout.object_id, button.buttonKey, button.label, button.icon,
        button.targetType === "action" ? button.targetKey : null, button.targetType, button.targetKey, button.variant,
        button.placement, button.requiredPermission, JSON.stringify(button.visibilityRule), JSON.stringify(button.inputMappings), JSON.stringify(button.config)]
    );
  }
}

function canManageGlobal(req) {
  return req.user?.isSuperadmin === true;
}

async function hasPlatformObjectPermission(db, req, objectId, action) {
  if (req.user?.isSuperadmin === true || req.user?.isPlatformDeveloper === true || req.user?.isDeveloper === true) return true;
  if (!objectId) return false;
  if (!req.user?.roleId) return Boolean(req.user?.companyId);
  const result = await db(
    "SELECT can_view, can_create, can_edit, can_delete, can_import, can_export FROM platform_object_permissions WHERE object_id=$1 AND role_id=$2 AND company_id=$3",
    [objectId, req.user.roleId, req.user.companyId]
  );
  if (!result.rows.length) return false;
  return result.rows[0][`can_${action}`] === true;
}

async function activeFieldReferences(db, field, companyId) {
  const references = new Set();
  const needles = [...new Set([field.api_name, field.source_column, String(field.id)].filter(Boolean))];
  const matches = (value) => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
    return needles.some((needle) => text.includes(String(needle)));
  };

  const siblingFields = await db(
    "SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label",
    [field.object_id, companyId]
  );
  for (const candidate of siblingFields.rows || []) {
    if (candidate.id === field.id) continue;
    if (matches(candidate)) references.add(candidate.field_type === "formula" ? `formula: ${candidate.label}` : `field metadata: ${candidate.label}`);
    if (candidate.field_type === "rollup") {
      const normalized = normalizeRollupConfig(candidate);
      if (normalized?.sourceField === field.api_name || normalized?.sourceField === field.source_column) references.add(`rollup: ${candidate.label}`);
    }
  }

  const activeMetadata = await db(
    `SELECT kind,label,payload FROM (
       SELECT 'workflow' AS kind, name AS label, (conditions::text || ' ' || action::text) AS payload
         FROM platform_rules WHERE object_id=$1 AND company_id=$2 AND active=true AND COALESCE(lifecycle_status,'ACTIVE')='ACTIVE'
       UNION ALL
       SELECT 'approval', name, conditions::text
         FROM platform_approval_processes WHERE object_id=$1 AND company_id=$2 AND active=true AND COALESCE(lifecycle_status,'ACTIVE')='ACTIVE'
       UNION ALL
       SELECT 'button', label, (visibility_rule::text || ' ' || config::text)
         FROM platform_buttons WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) AND active=true
       UNION ALL
       SELECT 'action binding', event_key, config::text
         FROM platform_action_bindings WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) AND active=true
       UNION ALL
       SELECT 'layout', name, definition::text
         FROM platform_layouts WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) AND active=true
       UNION ALL
       SELECT 'report', label, config::text
         FROM platform_reports WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) AND active=true
     ) refs`,
    [field.object_id, companyId]
  );
  for (const ref of activeMetadata.rows || []) {
    if (matches(ref.payload)) references.add(`${ref.kind}: ${ref.label}`);
  }
  return [...references].slice(0, 20);
}

async function objectDeactivationBlockers(db, object, companyId) {
  const blockers = [];
  if (object.source_table && isSafeIdentifier(object.source_table)) {
    const records = await db(`SELECT COUNT(*)::int AS count FROM "${object.source_table}" WHERE company_id=$1`, [companyId]);
    if (Number(records.rows[0]?.count || 0) > 0) blockers.push("records");
  }
  const metadata = await db(
    `SELECT source FROM (
       SELECT 'fields' AS source FROM platform_fields WHERE object_id=$1 AND active=true
       UNION ALL SELECT 'relationships' FROM platform_relationships
        WHERE (parent_object_id=$1 OR child_object_id=$1) AND active=true
       UNION ALL SELECT 'layouts' FROM platform_layouts WHERE object_id=$1 AND active=true
       UNION ALL SELECT 'reports' FROM platform_reports WHERE object_id=$1 AND active=true
       UNION ALL SELECT 'rules' FROM platform_rules WHERE object_id=$1 AND active=true AND COALESCE(lifecycle_status,'ACTIVE')='ACTIVE'
       UNION ALL SELECT 'approvals' FROM platform_approval_processes WHERE object_id=$1 AND active=true AND COALESCE(lifecycle_status,'ACTIVE')='ACTIVE'
       UNION ALL SELECT 'buttons' FROM platform_buttons WHERE object_id=$1 AND active=true
       UNION ALL SELECT 'registered actions' FROM platform_registered_actions WHERE object_id=$1 AND active=true
       UNION ALL SELECT 'action bindings' FROM platform_action_bindings WHERE object_id=$1 AND active=true
       UNION ALL SELECT 'record types' FROM platform_record_types WHERE object_id=$1 AND active=true
     ) blockers LIMIT 10`,
    [object.id]
  );
  blockers.push(...metadata.rows.map((row) => row.source));
  return [...new Set(blockers)];
}

async function fieldStoredValueCount(db, field, companyId) {
  if (isExtensionField(field)) {
    const result = await db(
      "SELECT COUNT(*)::int AS count FROM platform_record_associations WHERE object_id=$1 AND company_id=$2 AND custom_values ? $3 AND custom_values->$3 IS NOT NULL AND custom_values->$3 <> 'null'::jsonb",
      [field.object_id, companyId, field.api_name]
    );
    return Number(result.rows[0]?.count || 0);
  }
  if (field.source_table && field.source_column && isSafeIdentifier(field.source_table) && isSafeIdentifier(field.source_column)) {
    const result = await db(
      `SELECT COUNT(*)::int AS count FROM "${field.source_table}" WHERE company_id=$1 AND "${field.source_column}" IS NOT NULL`,
      [companyId]
    );
    return Number(result.rows[0]?.count || 0);
  }
  return 0;
}

function visibilityClause(alias, req, start = 1) {
  return {
    sql: `(${alias}.company_id IS NULL OR ${alias}.company_id=$${start})`,
    params: [req.user.companyId],
  };
}

function recordIdIsValid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}





function metadataColumn(field) {
  return field && !isCalculatedField(field) && field.active === true && field.source_column && isSafeIdentifier(field.source_column)
    ? field.source_column
    : null;
}

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), maximum);
}

function recordReturning(fields, values) {
  const hasCalculated = fields.some(field => field.active && (field.field_type === "formula" || field.field_type === "rollup"));
  const mapped = hasCalculated ? fields.filter(field => metadataColumn(field) && field.readable !== false).map(field => ({ field, column: field.source_column })) : values;
  return ["id", ...mapped.filter(({ field }) => isSafeIdentifier(field.api_name)).map(({ field, column }) => `"${column}" AS "${field.api_name}"`)];
}

function publicFormulaRecord(fields, record) {
  const result = { ...record };
  for (const field of fields) if (field.readable === false) delete result[field.api_name];
  return result;
}

function normalizeListViewSort(value) {
  if (!value || typeof value !== "object") return { field: null, direction: "asc" };
  const field = typeof value.field === "string" ? value.field : null;
  const direction = ["asc", "desc"].includes(String(value.direction || "asc").toLowerCase()) ? String(value.direction).toLowerCase() : "asc";
  return { field, direction };
}

function normalizeAppConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { defaultPage: null, theme: { primary: "#0f172a" } };
  return {
    defaultPage: typeof value.defaultPage === "string" ? value.defaultPage : typeof value.default_page === "string" ? value.default_page : null,
    theme: value.theme && typeof value.theme === "object" && !Array.isArray(value.theme) ? value.theme : { primary: "#0f172a" },
  };
}

/*
 * Page definitions are admin-authored input, so they are whitelisted. The
 * shared normalizer keeps components/sections, the semantic target keys
 * (objectKey / referenceId / reportKey) and the navigation keys (show in
 * navigation, icon key, order, optional module, profiles, permissions).
 */
function normalizePageDefinition(value) {
  return normalizeObjectPageDefinition(value);
}

function configuredActionKey(component, index) {
  return String(component?.id || component?.key || `${component?.action || "action"}:${index}`);
}

function normalizeReportConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { fields: [], filters: [], sort: [], groupBy: null, metrics: [{ type: "count" }] };
  const fields = Array.isArray(value.fields) ? value.fields.filter((field) => typeof field === "string" && isSafeIdentifier(field)).slice(0, 50) : [];
  const filters = Array.isArray(value.filters) ? value.filters
    .filter((filter) => filter && typeof filter.field === "string" && isSafeIdentifier(filter.field))
    .map((filter) => ({
      field: filter.field,
      operator: ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "is_null"].includes(filter.operator) ? filter.operator : "eq",
      value: filter.value,
    })).slice(0, 20) : [];
  const sort = Array.isArray(value.sort) ? value.sort
    .filter((item) => item && typeof item.field === "string" && isSafeIdentifier(item.field))
    .map((item) => ({ field: item.field, direction: String(item.direction).toLowerCase() === "desc" ? "desc" : "asc" })).slice(0, 10) : [];
  const groupBy = typeof value.groupBy === "string" ? value.groupBy : typeof value.group_by === "string" ? value.group_by : null;
  const metrics = Array.isArray(value.metrics) ? value.metrics : Array.isArray(value.metric) ? value.metric : [];
  const normalizedMetrics = metrics
    .filter((metric) => metric && typeof metric === "object")
    .map((metric) => {
      const type = typeof metric.type === "string" ? metric.type.toLowerCase() : "count";
      const safeType = ["count", "sum", "avg", "min", "max"].includes(type) ? type : "count";
      const field = typeof metric.field === "string" ? metric.field : typeof metric.fieldName === "string" ? metric.fieldName : null;
      return { type: safeType, field };
    })
    .slice(0, 5);

  return { fields, filters, sort, groupBy, metrics: normalizedMetrics.length ? normalizedMetrics : [{ type: "count" }] };
}

async function evaluateRollupValue(db, object, field, record, req) {
  const config = normalizeRollupConfig(field);
  if (!config || !config.relationshipKey || !object || !record || !record.id) return record?.[field.api_name] ?? null;
  const relationshipResult = await db(
    "SELECT r.*, p.object_key AS parent_object_key, c.object_key AS child_object_key, c.source_table AS child_source_table, c.company_scoped AS child_company_scoped, c.store_scoped AS child_store_scoped FROM platform_relationships r JOIN platform_objects p ON p.id=r.parent_object_id JOIN platform_objects c ON c.id=r.child_object_id WHERE r.parent_object_id=$1 AND r.relationship_key=$2 AND r.active=true",
    [object.id, config.relationshipKey]
  );
  const relationship = relationshipResult.rows[0];
  if (!relationship) return null;
  const childObject = { ...relationship, ...{ source_table: relationship.child_source_table, company_scoped: relationship.child_company_scoped, store_scoped: relationship.child_store_scoped } };
  const joinField = relationship.child_field_id ? await db("SELECT * FROM platform_fields WHERE id=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [relationship.child_field_id, req.user.companyId]) : { rows: [] };
  const joinFieldInfo = joinField.rows[0];
  /* Only a child-owned link column can be aggregated from the child table. A
     parent-owned lookup (the FK lives on the parent) has no child join column,
     so no child aggregate can be computed for it. */
  if (joinFieldInfo && String(joinFieldInfo.object_id) !== String(relationship.child_object_id)) return null;
  if (!childObject.source_table || !isSafeIdentifier(childObject.source_table) || !joinFieldInfo || !joinFieldInfo.source_column || !isSafeIdentifier(joinFieldInfo.source_column)) {
    return null;
  }
  const operation = config.operation;
  const clauseParams = [record.id];
  const clauses = [`"${joinFieldInfo.source_column}"=$${clauseParams.length}`];
  const childFieldsResult = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order", [relationship.child_object_id, req.user.companyId]);
  const childFields = childFieldsResult.rows;
  const childFieldByApiName = new Map(childFields.map((candidate) => [candidate.api_name, candidate]));
  const sourceField = config.sourceField ? childFieldByApiName.get(config.sourceField) : childFields.find((candidate) => candidate.api_name === config.sourceField || candidate.source_column === config.sourceField) || null;
  const sourceColumn = sourceField && sourceField.source_column && isSafeIdentifier(sourceField.source_column) ? sourceField.source_column : null;
  if (operation !== "COUNT" && !sourceColumn) return null;
  if (childObject.company_scoped) { clauseParams.push(req.user.companyId); clauses.push(`company_id=$${clauseParams.length}`); }
  if (childObject.store_scoped) {
    if (!req.user.storeId) return null;
    clauseParams.push(req.user.storeId); clauses.push(`store_id=$${clauseParams.length}`);
  }
  const filterCondition = normalizeRollupConfig(field)?.condition ?? null;
  const filterRecords = await db(`SELECT * FROM "${childObject.source_table}" WHERE ${clauses.join(" AND ")}`, clauseParams);
  let rows = filterRecords.rows || [];
  if (filterCondition && rows.length) {
    rows = rows.filter((row) => evaluateCondition(filterCondition, childFields, row));
  }
  if (operation === "COUNT") return rows.length;
  const values = rows.map((row) => row[sourceColumn]).filter((value) => value !== null && value !== undefined && value !== "");
  if (!values.length) return null;
  switch (operation) {
    case "SUM": return values.reduce((total, value) => total + Number(value), 0);
    case "AVG": return values.reduce((total, value) => total + Number(value), 0) / values.length;
    case "MIN": return values.reduce((min, value) => (Number(value) < Number(min) ? Number(value) : Number(min)), Number(values[0]));
    case "MAX": return values.reduce((max, value) => (Number(value) > Number(max) ? Number(value) : Number(max)), Number(values[0]));
    default: return null;
  }
}

async function populateRollups(db, object, fields, records, req) {
  const rollups = fields.filter((field) => field.active !== false && field.field_type === "rollup");
  if (!rollups.length || !Array.isArray(records)) return records;
  const next = [];
  for (const record of records) {
    const enriched = { ...record };
    for (const field of rollups) {
      enriched[field.api_name] = await evaluateRollupValue(db, object, field, enriched, req);
    }
    next.push(enriched);
  }
  return next;
}







async function validatePicklistDefinition(db, field, req) {
  if (!["select", "picklist"].includes(field.field_type)) return;
  const valueSetId = field.config?.valueSetId || field.config?.value_set_id;
  const local = localPicklistOptions(field);
  if (valueSetId && local.length) throw new ConditionError("Picklists cannot use both local values and a reusable value set");
  if (valueSetId) {
    const result = await db("SELECT id FROM platform_value_sets WHERE id=$1 AND company_id=$2", [valueSetId, req.user.companyId]);
    if (!result.rows.length) throw new ConditionError("Reusable value set is not available to this company");
  }

  const options = valueSetId ? await valueSetOptions(db, field, req) : local;
  const seen = new Set();
  for (const option of options) {
    if (!isSafeIdentifier(option.value)) throw new ConditionError("Picklist values must use safe stable values");
    if (seen.has(option.value)) throw new ConditionError(`Duplicate picklist value: ${option.value}`);
    seen.add(option.value);
  }
}

function parseRecordFilters(query) {
  const raw = query?.filter ?? query?.filters;
  if (raw === undefined || raw === "") return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseCsv(text) {
  if (typeof text !== "string") return { headers: [], rows: [] };
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim() !== "");
  if (!lines.length) return { headers: [], rows: [] };
  const parseLine = (line) => {
    const values = [];
    let current = "";
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };
  const headers = parseLine(lines[0]).map((header) => header.replace(/^\ufeff/, "").trim());
  const rows = [];
  for (let index = 1; index < lines.length; index += 1) {
    const values = parseLine(lines[index]);
    const row = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      row[headers[columnIndex]] = values[columnIndex] !== undefined ? values[columnIndex] : "";
    }
    rows.push({ row, lineNumber: index + 1 });
  }
  return { headers, rows };
}

function csvEscape(value) {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function validRecordTypeInput(body) {
  return body && typeof body.label === "string" && body.label.trim().length > 0
    && (body.recordTypeKey === undefined || isSafeIdentifier(body.recordTypeKey))
    && (body.defaultValues === undefined || (body.defaultValues && typeof body.defaultValues === "object" && !Array.isArray(body.defaultValues)));
}

export default function createPlatformRouter({ authenticate, authorize, db, pool, writeAudit = null, canViewCompanyCustomers = async () => false }) {
  const router = express.Router();
  async function resolveActingCompany(req, res, next) {
    try {
      const isPlatformDeveloper = req.user?.isPlatformDeveloper === true || req.user?.is_platform_developer === true;
      if (!isPlatformDeveloper) {
        if (req.headers["x-acting-company-id"]) return res.status(403).json({ success: false, message: "Tenant users cannot switch company context" });
        req.platformCompanyId = req.user.companyId;
        return next();
      }
      const actingCompanyId = req.headers["x-acting-company-id"] || req.body?.actingCompanyId || req.query?.actingCompanyId;
      if (!actingCompanyId) return res.status(409).json({ success: false, code: "ACTING_COMPANY_REQUIRED", message: "Select an authorised acting company before customising tenant metadata" });
      const access = await db(
        `SELECT c.id FROM companies c
         JOIN platform_developer_company_access a ON a.company_id=c.id
         WHERE a.developer_id=$1 AND a.company_id=$2 AND a.active=true AND c.active=true`,
        [req.user.id, actingCompanyId]
      );
      if (!access.rows.length) return res.status(403).json({ success: false, message: "This Platform Developer is not authorised for the selected company" });
      req.platformCompanyId = access.rows[0].id;
      req.user.companyId = access.rows[0].id;
      return next();
    } catch (error) {
      console.error("Acting company resolution error:", error);
      return res.status(500).json({ success: false, message: "Unable to resolve acting company" });
    }
  }
  async function authorizePlatformManage(req, res, next) {
    if (req.user?.isSuperadmin === true || req.user?.is_superadmin === true
      || req.user?.isPlatformDeveloper === true || req.user?.is_platform_developer === true) return next();
    return authorize("settings.manage")(req, res, next);
  }
  const manage = [authenticate, resolveActingCompany, authorizePlatformManage];

  router.use("/platform", authenticate, async (req, res, next) => {
    try { req.platformCompanyCustomers = await canViewCompanyCustomers(req.user); next(); }
    catch (error) { next(error); }
  });

  router.get("/platform/search", authenticate, async (req, res, next) => {
    try {
      const data = await searchPlatformRecords(db, req, req.query.q);
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("Platform search error:", error);
      next(error);
    }
  });

  router.get("/platform/developer/companies", authenticate, async (req, res) => {
    if (req.user?.isPlatformDeveloper !== true && req.user?.is_platform_developer !== true) {
      return res.status(403).json({ success: false, message: "Platform Developer access required" });
    }
    const result = await db(
      `SELECT c.id, c.name
       FROM companies c JOIN platform_developer_company_access a ON a.company_id=c.id
       WHERE a.developer_id=$1 AND a.active=true AND c.active=true ORDER BY c.name`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  });

  router.put("/platform/developer/acting-company", authenticate, async (req, res) => {
    if (req.user?.isPlatformDeveloper !== true && req.user?.is_platform_developer !== true) {
      return res.status(403).json({ success: false, message: "Platform Developer access required" });
    }
    const companyId = req.body?.actingCompanyId;
    const result = await db(
      `SELECT c.id, c.name
       FROM companies c JOIN platform_developer_company_access a ON a.company_id=c.id
       WHERE a.developer_id=$1 AND a.company_id=$2 AND a.active=true AND c.active=true`,
      [req.user.id, companyId]
    );
    if (!result.rows.length) return res.status(403).json({ success: false, message: "This Platform Developer is not authorised for the selected company" });
    res.json({ success: true, data: { actingCompanyId: result.rows[0].id, company: result.rows[0] } });
  });

  router.use(["/platform/objects/:objectKey/records", "/platform/objects/:objectKey/reports"], authenticate, async (req, res, next) => {
    try {
      const object = (await db("SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [req.params.objectKey, req.user.companyId])).rows[0];
      const system = systemObject(object);
      if (system) return authorize(system.permission)(req, res, next);
      next();
    } catch (error) { next(error); }
  });

  router.get("/platform/system/:objectKey/configuration", authenticate, (req, res, next) => {
    const system = systemObject({ object_key: req.params.objectKey });
    if (!system) return res.status(404).json({ success: false, message: "System object not found" });
    return authorize(system.permission)(req, res, async () => {
      try {
        if (req.query.recordId && !recordIdIsValid(req.query.recordId)) return res.status(400).json({ success: false, message: "Invalid record identifier" });
        const data = await readDomainConfiguration(db, system.key, req, req.query.recordId || null);
        res.json({ success: true, data });
      } catch (error) {
        if (error.status) return res.status(error.status).json({ success: false, message: error.message });
        next(error);
      }
    });
  });

  router.put("/platform/system/:objectKey/records/:recordId/extensions", ...manage, (req, res, next) => {
    const system = systemObject({ object_key: req.params.objectKey });
    if (!system || !recordIdIsValid(req.params.recordId)) return res.status(404).json({ success: false, message: "Record not found" });
    if (!req.body?.platform || Object.keys(req.body).some(key => key !== "platform")) return res.status(400).json({ success: false, message: "Only Platform extension values are accepted here" });
    return authorize(system.permission)(req, res, async () => {
      try {
        const configuration = await readDomainConfiguration(db, system.key, req, req.params.recordId);
        const object = configuration.object;
        const result = await withDomainSave({ pool, db, savePlatformRecord: saveDomainConfiguration, key: system.key, req, id: req.params.recordId,
          write: query => {
            const clauses = ["id=$1", "company_id=$2"], params = [req.params.recordId, req.user.companyId];
            appendSystemReadScope(object, req, clauses, params);
            return query(`SELECT * FROM "${system.table}" WHERE ${clauses.join(" AND ")}`, params);
          },
        });
        res.json({ success: true, data: result.rows[0].platform });
      } catch (error) {
        if (error.status) return res.status(error.status).json({ success: false, message: error.message });
        next(error);
      }
    });
  });

  async function getObject(objectId, req, { forMutation = false, includeInactive = false } = {}) {
    const result = await db(
      `SELECT * FROM platform_objects WHERE id=$1 AND ${includeInactive ? "TRUE" : "active=true"} AND (company_id IS NULL OR company_id=$2)`,
      [objectId, req.user.companyId]
    );
    const object = result.rows[0];
    if (forMutation && object?.company_id === null && !canManageGlobal(req) && !systemObject(object)) return null;
    return object || null;
  }

  async function validateReferences(req, parentObjectId, childObjectId, childFieldId = null) {
    const [parent, child] = await Promise.all([getObject(parentObjectId, req), getObject(childObjectId, req)]);
    if (!parent || !child || parent.id === child.id) return "Referenced objects must exist and be different";
    if (childFieldId) {
      const field = await db("SELECT id FROM platform_fields WHERE id=$1 AND object_id=$2 AND active=true AND (company_id IS NULL OR company_id=$3)", [childFieldId, childObjectId, req.user.companyId]);
      if (!field.rows.length) return "The child field does not belong to the child object";
    }
    return null;
  }

  router.get("/platform/runtime-forms/:objectKey", authenticate, async (req, res) => {
    try {
      const objectResult = await db(
        `SELECT * FROM platform_objects
           WHERE object_key=$1 AND active=true
             AND (company_id IS NULL OR company_id=$2)
           ORDER BY CASE WHEN company_id=$2 THEN 0 ELSE 1 END
           LIMIT 1`,
        [req.params.objectKey, req.user.companyId]
      );
      const object = objectResult.rows[0];
      if (!object) return res.status(404).json({ success: false, message: "Object not found" });
      const fieldsResult = await db(
        "SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order,label",
        [object.id, req.user.companyId]
      );
      const fields = await enrichFields(db, await applyFieldSecurity(db, fieldsResult.rows, req), req);
      const pageType = req.query.pageType || req.query.page_type || "detail";
      if (!PAGE_TYPES.has(pageType)) return res.status(400).json({ success: false, message: "Invalid page type" });
      const layouts = await db(
        `SELECT * FROM platform_layouts
          WHERE object_id=$1 AND page_type=$2 AND active=true
            AND (company_id IS NULL OR company_id=$3)
            AND (role_id IS NULL OR role_id=$4)
          ORDER BY CASE WHEN role_id=$4 THEN 0 WHEN is_default=true THEN 1 WHEN company_id=$3 THEN 2 ELSE 3 END,
            updated_at DESC,id`,
        [object.id, pageType, req.user.companyId, req.user.roleId || null]
      );
      res.json({ success: true, data: { object, fields, layout: resolvePageLayout(layouts.rows) } });
    } catch (error) {
      console.error("Runtime platform form error:", error);
      res.status(500).json({ success: false, message: "Unable to load runtime platform form" });
    }
  });

  router.get("/platform/metadata", ...manage, async (req, res) => {
    try {
      const scope = visibilityClause("o", req);
      const [modules, objects, fields, relationships, layouts, rules] = await Promise.all([
        db("SELECT * FROM platform_modules ORDER BY name"),
        db(`SELECT * FROM platform_objects o WHERE o.active=true AND ${scope.sql} ORDER BY o.label`, scope.params),
        db(`SELECT f.* FROM platform_fields f JOIN platform_objects o ON o.id=f.object_id WHERE o.active=true AND f.active=true AND (f.company_id IS NULL OR f.company_id=$1) AND ${scope.sql} ORDER BY f.object_id, f.display_order, f.label`, scope.params),
        db(`SELECT r.*, p.object_key AS parent_object_key, c.object_key AS child_object_key FROM platform_relationships r JOIN platform_objects p ON p.id=r.parent_object_id JOIN platform_objects c ON c.id=r.child_object_id WHERE r.active=true AND (p.company_id IS NULL OR p.company_id=$1)`, [req.user.companyId]),
        db("SELECT * FROM platform_layouts WHERE active=true AND (company_id IS NULL OR company_id=$1) ORDER BY name", [req.user.companyId]),
        db("SELECT * FROM platform_rules WHERE active=true AND (company_id IS NULL OR company_id=$1) ORDER BY name", [req.user.companyId]),
      ]);
      res.json({ success: true, data: { modules: modules.rows, objects: objects.rows, fields: fields.rows, relationships: relationships.rows, layouts: layouts.rows, rules: rules.rows } });
    } catch (error) {
      console.error("Platform metadata load error:", error);
      res.status(500).json({ success: false, message: "Unable to load platform metadata" });
    }
  });

  router.get("/platform/value-sets", ...manage, async (req, res) => {
    const result = await db(
      "SELECT * FROM platform_value_sets WHERE company_id=$1 ORDER BY label",
      [req.user.companyId]
    );
    const values = await db(
      "SELECT v.* FROM platform_value_set_values v JOIN platform_value_sets s ON s.id=v.value_set_id WHERE s.company_id=$1 ORDER BY v.value_set_id, v.display_order, v.label",
      [req.user.companyId]
    );
    const bySet = new Map();
    for (const value of values.rows) {
      if (!bySet.has(value.value_set_id)) bySet.set(value.value_set_id, []);
      bySet.get(value.value_set_id).push(value);
    }
    res.json({
      success: true,
      data: result.rows.map((set) => ({ ...set, values: bySet.get(set.id) || [] })),
    });
  });

  router.post("/platform/value-sets", ...manage, async (req, res) => {
    if (!validValueSetInput(req.body)) {
      return res.status(400).json({ success: false, message: "A label and safe value-set key are required" });
    }
    const valueSetKey = req.body.valueSetKey || toSafeApiName(req.body.label, "value_set");
    try {
      const result = await db(
        "INSERT INTO platform_value_sets (value_set_key,label,description,company_id) VALUES ($1,$2,$3,$4) RETURNING *",
        [valueSetKey, req.body.label.trim(), req.body.description || null, req.user.companyId]
      );
      res.status(201).json({ success: true, data: { ...result.rows[0], values: [] } });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A value set with this API name already exists" });
      console.error("Platform value set create error:", error);
      res.status(500).json({ success: false, message: "Unable to create value set" });
    }
  });

  router.put("/platform/value-sets/:valueSetId", ...manage, async (req, res) => {
    if (req.body.valueSetKey !== undefined && !isSafeIdentifier(req.body.valueSetKey)) {
      return res.status(400).json({ success: false, message: "valueSetKey must be a safe identifier" });
    }
    const existing = await db("SELECT * FROM platform_value_sets WHERE id=$1 AND company_id=$2", [req.params.valueSetId, req.user.companyId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: "Value set not found" });
    try {
      const result = await db(
        "UPDATE platform_value_sets SET value_set_key=COALESCE($1,value_set_key),label=COALESCE($2,label),description=COALESCE($3,description),active=COALESCE($4,active),updated_at=NOW() WHERE id=$5 AND company_id=$6 RETURNING *",
        [req.body.valueSetKey, req.body.label, req.body.description, req.body.active, req.params.valueSetId, req.user.companyId]
      );
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A value set with this API name already exists" });
      console.error("Platform value set update error:", error);
      res.status(500).json({ success: false, message: "Unable to update value set" });
    }
  });

  router.post("/platform/value-sets/:valueSetId/values", ...manage, async (req, res) => {
    const set = await db("SELECT id FROM platform_value_sets WHERE id=$1 AND company_id=$2 AND active=true", [req.params.valueSetId, req.user.companyId]);
    if (!set.rows.length || typeof req.body.label !== "string" || !req.body.label.trim()) return res.status(400).json({ success: false, message: "Active value set and value label are required" });
    const value = req.body.value || toSafeApiName(req.body.label);
    if (!isSafeIdentifier(value)) return res.status(400).json({ success: false, message: "Value must be a safe identifier" });
    try {
      const result = await db(
        "INSERT INTO platform_value_set_values (value_set_id,value,label,display_order,active) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [req.params.valueSetId, value, req.body.label.trim(), Number(req.body.displayOrder || 0), req.body.active !== false]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A value with this stable value already exists in the value set" });
      console.error("Platform value set value create error:", error);
      res.status(500).json({ success: false, message: "Unable to create value-set value" });
    }
  });

  router.put("/platform/value-set-values/:valueId", ...manage, async (req, res) => {
    const existing = await db(
      "SELECT v.* FROM platform_value_set_values v JOIN platform_value_sets s ON s.id=v.value_set_id WHERE v.id=$1 AND s.company_id=$2",
      [req.params.valueId, req.user.companyId]
    );
    if (!existing.rows.length) return res.status(404).json({ success: false, message: "Value-set value not found" });
    if (req.body.value !== undefined && !isSafeIdentifier(req.body.value)) return res.status(400).json({ success: false, message: "Value must be a safe identifier" });
    try {
      const result = await db(
        "UPDATE platform_value_set_values SET value=COALESCE($1,value),label=COALESCE($2,label),display_order=COALESCE($3,display_order),active=COALESCE($4,active) WHERE id=$5 RETURNING *",
        [req.body.value, req.body.label, req.body.displayOrder, req.body.active, req.params.valueId]
      );
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A value with this stable value already exists in the value set" });
      console.error("Platform value set value update error:", error);
      res.status(500).json({ success: false, message: "Unable to update value-set value" });
    }
  });

  router.get("/platform/objects/:objectId/record-types", ...manage, async (req, res) => {
    const object = await getObject(req.params.objectId, req);
    if (!object) return res.status(404).json({ success: false, message: "Object not found" });
    const types = await db("SELECT * FROM platform_record_types WHERE object_id=$1 AND company_id=$2 AND active=true ORDER BY label", [object.id, req.user.companyId]);
    const restrictions = await db("SELECT r.* FROM platform_record_type_picklist_values r JOIN platform_record_types t ON t.id=r.record_type_id WHERE t.object_id=$1 AND t.company_id=$2 AND t.active=true AND r.active=true", [object.id, req.user.companyId]);
    const byType = new Map();
    for (const row of restrictions.rows) {
      if (!byType.has(row.record_type_id)) byType.set(row.record_type_id, {});
      if (!byType.get(row.record_type_id)[row.field_id]) byType.get(row.record_type_id)[row.field_id] = [];
      byType.get(row.record_type_id)[row.field_id].push(row.value);
    }
    res.json({ success: true, data: types.rows.map((type) => ({ ...type, picklistRestrictions: byType.get(type.id) || {} })) });
  });

  router.post("/platform/objects/:objectId/record-types", ...manage, async (req, res) => {
    const object = await getObject(req.params.objectId, req, { forMutation: true });
    if (!object || !validRecordTypeInput(req.body)) return res.status(400).json({ success: false, message: "Object and valid record type metadata are required" });
    const key = req.body.recordTypeKey || toSafeApiName(req.body.label, "record_type");
    const restrictions = req.body.picklistRestrictions || {};
    try {
      await validateRecordTypeRestrictions(object, restrictions, req);
      await validateRecordTypeDefaults(object, req.body.defaultValues, req);
      if (req.body.isDefault === true) {
        await db("UPDATE platform_record_types SET is_default=false WHERE object_id=$1 AND company_id=$2 AND is_default=true", [object.id, req.user.companyId]);
      }
      const result = await db("INSERT INTO platform_record_types (object_id,record_type_key,label,description,company_id,default_values,is_default) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING *", [object.id, key, req.body.label.trim(), req.body.description || null, req.user.companyId, JSON.stringify(req.body.defaultValues || {}), req.body.isDefault === true]);
      for (const [fieldId, values] of Object.entries(restrictions)) for (const value of values) {
        await db("INSERT INTO platform_record_type_picklist_values (record_type_id,field_id,value) VALUES ($1,$2,$3)", [result.rows[0].id, fieldId, String(value)]);
      }
      res.status(201).json({ success: true, data: { ...result.rows[0], picklistRestrictions: restrictions } });
    } catch (error) {
      if (error instanceof ConditionError) return res.status(400).json({ success: false, code: error.code, message: error.message });
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A record type with this key already exists" });
      console.error("Platform record type create error:", error);
      res.status(500).json({ success: false, message: "Unable to create record type" });
    }
  });

  router.put("/platform/record-types/:recordTypeId", ...manage, async (req, res) => {
    const existing = await db("SELECT * FROM platform_record_types WHERE id=$1 AND company_id=$2", [req.params.recordTypeId, req.user.companyId]);
    if (!existing.rows.length || !validRecordTypeInput({ ...existing.rows[0], ...req.body })) return res.status(404).json({ success: false, message: "Record type not found or invalid" });
    const current = existing.rows[0];
    const restrictions = req.body.picklistRestrictions;
    try {
      if (restrictions) {
        const object = await getObject(current.object_id, req);
        if (!object) return res.status(404).json({ success: false, message: "Record type object not found" });
        await validateRecordTypeRestrictions(object, restrictions, req);
      }
      await validateRecordTypeDefaults(object, req.body.defaultValues, req);
      if (req.body.isDefault === true) {
        await db("UPDATE platform_record_types SET is_default=false WHERE object_id=$1 AND company_id=$2 AND id<>$3 AND is_default=true", [current.object_id, req.user.companyId, current.id]);
      }
      const result = await db("UPDATE platform_record_types SET record_type_key=COALESCE($1,record_type_key),label=COALESCE($2,label),description=COALESCE($3,description),default_values=COALESCE($4::jsonb,default_values),is_default=COALESCE($5,is_default),active=COALESCE($6,active),updated_at=NOW() WHERE id=$7 AND company_id=$8 RETURNING *", [req.body.recordTypeKey, req.body.label?.trim(), req.body.description, req.body.defaultValues === undefined ? null : JSON.stringify(req.body.defaultValues), req.body.isDefault, req.body.active, current.id, req.user.companyId]);
      if (restrictions) {
        await db("DELETE FROM platform_record_type_picklist_values WHERE record_type_id=$1", [current.id]);
        for (const [fieldId, values] of Object.entries(restrictions)) for (const value of values) await db("INSERT INTO platform_record_type_picklist_values (record_type_id,field_id,value) VALUES ($1,$2,$3)", [current.id, fieldId, String(value)]);
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error instanceof ConditionError) return res.status(400).json({ success: false, code: error.code, message: error.message });
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A record type with this key already exists" });
      console.error("Platform record type update error:", error);
      res.status(500).json({ success: false, message: "Unable to update record type" });
    }
  });

  router.delete("/platform/record-types/:recordTypeId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_record_types SET active=false WHERE id=$1 AND company_id=$2 RETURNING *", [req.params.recordTypeId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Record type not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/component-registry", ...manage, (req, res) => {
    res.json({ success: true, data: listPlatformComponents() });
  });

  router.get("/platform/action-registry", ...manage, async (req, res) => {
    res.json({ success: true, data: listRegisteredPlatformActions().map(({ executor, validation, ...definition }) => definition) });
  });

  router.get("/platform/objects/:objectId/registered-actions", ...manage, async (req, res) => {
    const result = await db(`SELECT * FROM platform_registered_actions WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) AND active=true ORDER BY label`, [req.params.objectId, req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.post("/platform/objects/:objectId/registered-actions", ...manage, async (req, res) => {
    const actionKey = String(req.body?.actionKey || req.body?.action_key || "").trim();
    const handlerKey = String(req.body?.handlerKey || req.body?.handler_key || "").trim();
    const label = String(req.body?.label || "").trim();
    if (!actionKey || !handlerKey || !label) return res.status(400).json({ success: false, message: "actionKey, handlerKey and label are required" });
    if (!listRegisteredPlatformActions().some((item) => item.key === handlerKey)) return res.status(400).json({ success: false, code: "UNREGISTERED_HANDLER", message: "Custom actions must use a registered handler" });
    const result = await db(`INSERT INTO platform_registered_actions (company_id,object_id,action_key,label,description,handler_key,required_permission,config) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`, [req.user.companyId, req.params.objectId, actionKey, label, req.body?.description || null, handlerKey, req.body?.requiredPermission || null, JSON.stringify(req.body?.config || {})]);
    res.status(201).json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/button-variants", ...manage, (req, res) => {
    res.json({ success: true, data: BUTTON_VARIANTS });
  });

  async function resolveButtonTarget(req, button, objectId = req.params.objectId) {
    if (button.targetType === "workflow") {
      const result = await db(
        `SELECT id,name,lifecycle_status,active FROM platform_rules
         WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2)
           AND (id::text=$3 OR name=$3) LIMIT 1`,
        [objectId, req.user.companyId, button.targetKey]
      );
      if (!result.rows.length) return { error: "Button must reference an existing workflow" };
      return { workflow: result.rows[0] };
    }
    const core = listRegisteredPlatformActions().find((item) => item.key === button.targetKey);
    if (core) return { action: core, handlerKey: core.key };
    const custom = await db(
      "SELECT * FROM platform_registered_actions WHERE action_key=$1 AND object_id=$2 AND (company_id IS NULL OR company_id=$3) AND active=true LIMIT 1",
      [button.targetKey, objectId, req.user.companyId]
    );
    if (!custom.rows.length) return { error: "Button must reference a registered action" };
    return { action: custom.rows[0], handlerKey: custom.rows[0].handler_key };
  }

  router.get("/platform/objects/:objectId/buttons", ...manage, async (req, res) => {
    const result = await db(
      `SELECT * FROM platform_buttons WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) AND active=true ORDER BY label`,
      [req.params.objectId, req.user.companyId]
    );
    res.json({ success: true, data: result.rows });
  });

  router.post("/platform/objects/:objectId/buttons", ...manage, async (req, res) => {
    try {
      const button = validateButtonDefinition(req.body || {});
      const target = await resolveButtonTarget(req, button);
      if (target.error) return res.status(400).json({ success: false, code: "UNREGISTERED_BUTTON_TARGET", message: target.error });
      const result = await db(
        `INSERT INTO platform_buttons
         (company_id,object_id,button_key,label,icon,action_key,target_type,target_key,variant,placement,required_permission,visibility_rule,input_mappings,config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb) RETURNING *`,
        [req.user.companyId, req.params.objectId, button.buttonKey, button.label, button.icon,
          button.targetType === "action" ? button.targetKey : null, button.targetType, button.targetKey,
          button.variant, button.placement, button.requiredPermission, JSON.stringify(button.visibilityRule),
          JSON.stringify(button.inputMappings), JSON.stringify(button.config)]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A button with this key already exists" });
      if (error.message?.includes("button") || error.message?.includes("Button") || error.message?.includes("variant") || error.message?.includes("targetType") || error.message?.includes("Mappings")) {
        return res.status(400).json({ success: false, message: error.message });
      }
      throw error;
    }
  });

  router.put("/platform/objects/:objectId/buttons/:buttonId", ...manage, async (req, res) => {
    const existing = await db("SELECT * FROM platform_buttons WHERE id=$1 AND object_id=$2 AND company_id=$3", [req.params.buttonId, req.params.objectId, req.user.companyId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: "Button not found" });
    try {
      const current = existing.rows[0];
      const button = validateButtonDefinition({
        buttonKey: req.body.buttonKey ?? current.button_key,
        label: req.body.label ?? current.label,
        icon: req.body.icon ?? current.icon,
        variant: req.body.variant ?? current.variant,
        targetType: req.body.targetType ?? current.target_type,
        targetKey: req.body.targetKey ?? current.target_key ?? current.action_key,
        placement: req.body.placement ?? current.placement,
        requiredPermission: req.body.requiredPermission ?? current.required_permission,
        visibilityRule: req.body.visibilityRule ?? current.visibility_rule,
        inputMappings: req.body.inputMappings ?? current.input_mappings,
        config: req.body.config ?? current.config,
      });
      const target = await resolveButtonTarget(req, button);
      if (target.error) return res.status(400).json({ success: false, code: "UNREGISTERED_BUTTON_TARGET", message: target.error });
      const result = await db(
        `UPDATE platform_buttons SET button_key=$1,label=$2,icon=$3,action_key=$4,target_type=$5,target_key=$6,variant=$7,user_modified=true,
         placement=$8,required_permission=$9,visibility_rule=$10::jsonb,input_mappings=$11::jsonb,config=$12::jsonb,updated_at=NOW()
         WHERE id=$13 AND object_id=$14 AND company_id=$15 RETURNING *`,
        [button.buttonKey, button.label, button.icon, button.targetType === "action" ? button.targetKey : null,
          button.targetType, button.targetKey, button.variant, button.placement, button.requiredPermission,
          JSON.stringify(button.visibilityRule), JSON.stringify(button.inputMappings), JSON.stringify(button.config),
          req.params.buttonId, req.params.objectId, req.user.companyId]
      );
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
  });

  router.delete("/platform/objects/:objectId/buttons/:buttonId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_buttons SET active=false,user_modified=true,updated_at=NOW() WHERE id=$1 AND object_id=$2 AND company_id=$3 RETURNING *", [req.params.buttonId, req.params.objectId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Button not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/objects", ...manage, async (req, res) => {
    const scope = visibilityClause("o", req);
    const result = await db(`SELECT * FROM platform_objects o WHERE ${scope.sql} ORDER BY o.label`, scope.params);
    res.json({ success: true, data: result.rows });
  });

  router.get("/platform/objects/:objectId", ...manage, async (req, res) => {
    const object = await getObject(req.params.objectId, req);
    if (!object) return res.status(404).json({ success: false, message: "Object not found" });
    const fields = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label", [object.id, req.user.companyId]);
    res.json({ success: true, data: { ...object, fields: await enrichFields(db, fields.rows, req) } });
  });

  router.get("/platform/fields/:fieldId/security", ...manage, async (req, res) => {
    const result = await db(
      "SELECT s.* FROM platform_field_security s JOIN platform_fields f ON f.id=s.field_id JOIN platform_objects o ON o.id=f.object_id WHERE s.field_id=$1 AND s.company_id=$2 AND (f.company_id IS NULL OR f.company_id=$2) AND (o.company_id IS NULL OR o.company_id=$2) ORDER BY s.role_id",
      [req.params.fieldId, req.user.companyId]
    );
    res.json({ success: true, data: result.rows });
  });

  router.get("/platform/fields/:fieldId/effective-security", authenticate, async (req, res) => {
    const result = await db(
      "SELECT f.* FROM platform_fields f JOIN platform_objects o ON o.id=f.object_id WHERE f.id=$1 AND f.active=true AND (f.company_id IS NULL OR f.company_id=$2) AND (o.company_id IS NULL OR o.company_id=$2)",
      [req.params.fieldId, req.user.companyId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Field not found" });
    res.json({ success: true, data: await resolveEffectiveFieldSecurity(db, result.rows[0], req) });
  });

  router.get("/platform/objects/:objectId/effective-permissions", authenticate, async (req, res) => {
    const object = await getObject(req.params.objectId, req);
    if (!object) return res.status(404).json({ success: false, message: "Object not found" });
    const result = await db(
      "SELECT can_view,can_create,can_edit,can_delete FROM platform_object_permissions WHERE object_id=$1 AND role_id=$2 AND company_id=$3",
      [object.id, req.user.roleId || null, req.user.companyId]
    );
    const permission = result.rows[0] || { can_view: false, can_create: false, can_edit: false, can_delete: false };
    res.json({ success: true, data: { objectId: object.id, roleId: req.user.roleId || null, ...permission, source: result.rows[0] ? "role_override" : "default_deny" } });
  });

  router.put("/platform/fields/:fieldId/security/:roleId", ...manage, async (req, res) => {
    if (typeof req.body?.readable !== "boolean" || typeof req.body?.writable !== "boolean") {
      return res.status(400).json({ success: false, message: "readable and writable must be boolean values" });
    }
    const field = await db(
      "SELECT f.id,o.company_id FROM platform_fields f JOIN platform_objects o ON o.id=f.object_id WHERE f.id=$1 AND (f.company_id IS NULL OR f.company_id=$2) AND (o.company_id IS NULL OR o.company_id=$2)",
      [req.params.fieldId, req.user.companyId]
    );
    if (!field.rows.length || (field.rows[0].company_id === null && !canManageGlobal(req))) return res.status(404).json({ success: false, message: "Field not found or not editable" });
    const role = await db("SELECT id FROM roles WHERE id=$1 AND company_id=$2", [req.params.roleId, req.user.companyId]);
    if (!role.rows.length) return res.status(404).json({ success: false, message: "Role not found" });
    const result = await db(
      "INSERT INTO platform_field_security (field_id,role_id,company_id,readable,writable) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (field_id,role_id,company_id) DO UPDATE SET readable=EXCLUDED.readable,writable=EXCLUDED.writable RETURNING *",
      [req.params.fieldId, req.params.roleId, req.user.companyId, req.body.readable, req.body.writable]
    );
    res.json({ success: true, data: result.rows[0] });
  });

  router.post("/platform/objects", ...manage, async (req, res) => {
    if (!validObjectInput(req.body)) return res.status(400).json({ success: false, message: "label and safe identifiers are required" });
    const { label, pluralLabel, sourceTable = null, moduleId = null } = req.body;
    const objectKey = req.body.objectKey || toSafeApiName(label, "object");
    const apiName = req.body.apiName || objectKey;
    try {
      if (moduleId) {
        const module = await db("SELECT id FROM platform_modules WHERE id=$1", [moduleId]);
        if (!module.rows.length) return res.status(400).json({ success: false, message: "Module not found" });
      }
      const result = await db("INSERT INTO platform_objects (object_key,api_name,label,plural_label,description,source_table,module_id,company_id) VALUES (COALESCE($1,$2 || '_' || substr(gen_random_uuid()::text,1,8)),$2,$3,$4,$5,$6,$7,$8) RETURNING *", [req.body.objectKey || null, apiName, label.trim(), pluralLabel || `${label.trim()}s`, req.body.description || null, sourceTable, moduleId, req.user.companyId]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "An object with this key already exists" });
      console.error("Platform object create error:", error);
      res.status(500).json({ success: false, message: "Unable to create platform object" });
    }
  });

  router.put("/platform/objects/:objectId", ...manage, async (req, res) => {
    const object = await getObject(req.params.objectId, req, { forMutation: true, includeInactive: true });
    if (!object) return res.status(404).json({ success: false, message: "Object not found or not editable" });
    if (systemObject(object)) return res.status(409).json({ success: false, message: "System object identity and mapping are protected" });
    if (req.body.objectKey !== undefined && !isSafeIdentifier(req.body.objectKey)) return res.status(400).json({ success: false, message: "objectKey must be a safe identifier" });
    if (req.body.apiName !== undefined && !isSafeIdentifier(req.body.apiName)) return res.status(400).json({ success: false, message: "apiName must be a safe identifier" });
    if (req.body.sourceTable !== undefined && req.body.sourceTable !== null && !isSafeIdentifier(req.body.sourceTable)) return res.status(400).json({ success: false, message: "sourceTable must be a safe identifier" });
    try {
      if (object.active === true && req.body.active === false) {
        const blockers = await objectDeactivationBlockers(db, object, req.user.companyId);
        if (blockers.length) return res.status(409).json({ success: false, code: "OBJECT_IN_USE", message: `Object cannot be deactivated while active dependencies remain: ${blockers.join(", ")}` });
      }
      const result = await db("UPDATE platform_objects SET object_key=COALESCE($1,object_key), api_name=COALESCE($2,api_name), label=COALESCE($3,label), plural_label=COALESCE($4,plural_label), description=COALESCE($5,description), source_table=$6, active=COALESCE($7,active), user_modified=true,updated_at=NOW() WHERE id=$8 AND (company_id=$9 OR (company_id IS NULL AND $10=true)) RETURNING *", [req.body.objectKey, req.body.apiName, req.body.label, req.body.pluralLabel, req.body.description, req.body.sourceTable === undefined ? object.source_table : req.body.sourceTable, req.body.active, object.id, req.user.companyId, canManageGlobal(req)]);
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "An object with this key already exists" });
      console.error("Platform object update error:", error);
      res.status(500).json({ success: false, message: "Unable to update platform object" });
    }
  });

  router.get("/platform/objects/:objectId/record-paths", ...manage, async (req, res) => {
    const root = await getObject(req.params.objectId, req);
    if (!root) return res.status(404).json({ success: false, message: "Object not found" });
    const [objectsResult, fieldsResult, relationshipsResult] = await Promise.all([
      db("SELECT * FROM platform_objects WHERE active=true AND (company_id IS NULL OR company_id=$1)", [req.user.companyId]),
      db("SELECT * FROM platform_fields WHERE active=true AND (company_id IS NULL OR company_id=$1)", [req.user.companyId]),
      db(`SELECT r.*, p.object_key AS parent_object_key, c.object_key AS child_object_key
            FROM platform_relationships r
            JOIN platform_objects p ON p.id=r.parent_object_id
            JOIN platform_objects c ON c.id=r.child_object_id
           WHERE r.active=true AND (p.company_id IS NULL OR p.company_id=$1) AND (c.company_id IS NULL OR c.company_id=$1)`, [req.user.companyId]),
    ]);
    const securedFields = await applyFieldSecurity(db, fieldsResult.rows, req);
    const readableFields = securedFields.filter((field) => field.readable !== false);
    const maxDepth = Math.max(1, Math.min(6, Number(req.query.depth || 4)));
    const data = buildRecordPathCatalog({ objects: objectsResult.rows, fields: readableFields, relationships: relationshipsResult.rows }, root.object_key, maxDepth);
    res.json({ success: true, data, rootObjectKey: root.object_key });
  });

  router.get("/platform/fields/:fieldId/dependencies", ...manage, async (req, res) => {
    const result = await db("SELECT f.*, o.object_key, o.source_table FROM platform_fields f JOIN platform_objects o ON o.id=f.object_id WHERE f.id=$1 AND (f.company_id IS NULL OR f.company_id=$2) AND (o.company_id IS NULL OR o.company_id=$2)", [req.params.fieldId, req.user.companyId]);
    const field = result.rows[0];
    if (!field) return res.status(404).json({ success: false, message: "Field not found" });
    const references = await activeFieldReferences(db, field, req.user.companyId);
    res.json({ success: true, data: { fieldId: field.id, objectKey: field.object_key, fieldKey: field.api_name, activeReferences: references, canDeactivate: references.length === 0 } });
  });

  router.get("/platform/objects/:objectId/dependencies", ...manage, async (req, res) => {
    const object = await getObject(req.params.objectId, req, { includeInactive: true });
    if (!object) return res.status(404).json({ success: false, message: "Object not found" });
    const blockers = await objectDeactivationBlockers(db, object, req.user.companyId);
    res.json({ success: true, data: { objectId: object.id, objectKey: object.object_key, activeReferences: blockers, canDeactivate: blockers.length === 0 } });
  });

  router.get("/platform/objects/:objectId/fields", ...manage, async (req, res) => {
    if (!await getObject(req.params.objectId, req)) return res.status(404).json({ success: false, message: "Object not found" });
    const result = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) ORDER BY active DESC, display_order, label", [req.params.objectId, req.user.companyId]);
    const fields = await applyFieldSecurity(db, result.rows, req);
    res.json({ success: true, data: await enrichFields(db, fields, req) });
  });

  router.post("/platform/objects/:objectId/fields", ...manage, async (req, res) => {
    const object = await getObject(req.params.objectId, req);
    if (!object) return res.status(404).json({ success: false, message: "Object not found or not editable" });
    if (!systemObject(object) && object.company_id === null && !canManageGlobal(req)) return res.status(404).json({ success: false, message: "Object not found or not editable" });
    if (!validFieldInput(req.body)) return res.status(400).json({ success: false, message: "Valid label and supported fieldType are required" });
    const { label, fieldType, sourceColumn = null, required = false, writable = false, options = [], config = {}, displayOrder = 0 } = req.body;
    const apiName = req.body.apiName || toSafeApiName(label);
    if (systemObject(object) && sourceColumn) return res.status(400).json({ success: false, message: "Custom fields on system objects use extension storage, not business columns" });
    const storedConfig = systemObject(object) && !isCalculatedField({ field_type: fieldType }) ? { ...config, storage: "extension" } : config;
    try {
      await validatePicklistDefinition(db, { field_type: fieldType, options, config }, req);
      await validateLookupConfiguration(object.id, fieldType, config, req);
      await checkFormulaChange(object.id, { api_name: apiName, field_type: fieldType, source_column: sourceColumn, required, writable, config: storedConfig, active: true, readable: true }, null, req);
      const names = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND api_name=$2 AND (company_id IS NULL OR company_id=$3)", [object.id, apiName, req.user.companyId]);
      if (names.rows.some(field => field.api_name === apiName)) return res.status(409).json({ success: false, message: "A field with this API name already exists" });
      const result = await db("INSERT INTO platform_fields (object_id,api_name,label,field_type,source_column,required,writable,options,config,display_order,company_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11) RETURNING *", [object.id, apiName, label.trim(), fieldType, sourceColumn, required, writable, JSON.stringify(options), JSON.stringify(storedConfig), displayOrder, req.user.companyId]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error instanceof FormulaError || error instanceof ConditionError) return res.status(400).json({ success: false, code: error.code, message: error.message });
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A field with this API name already exists" });
      console.error("Platform field create error:", error);
      res.status(500).json({ success: false, message: "Unable to create platform field" });
    }
  });

  router.put("/platform/fields/:fieldId", ...manage, async (req, res) => {
    const result = await db("SELECT f.*, o.company_id AS object_company_id, o.source_table, o.object_key FROM platform_fields f JOIN platform_objects o ON o.id=f.object_id WHERE f.id=$1 AND (f.company_id IS NULL OR f.company_id=$2) AND (o.company_id IS NULL OR o.company_id=$2)", [req.params.fieldId, req.user.companyId]);
    const field = result.rows[0];
    if (!field || (field.company_id === null && !canManageGlobal(req))) return res.status(404).json({ success: false, message: "Field not found or not editable" });
    if (systemObject(field) && !field.company_id) return res.status(409).json({ success: false, message: "System field definitions are protected; use field security and layouts" });
    if (isExtensionField(field) && (req.body.sourceColumn || (req.body.apiName && req.body.apiName !== field.api_name) || (req.body.fieldType && req.body.fieldType !== field.field_type))) return res.status(400).json({ success: false, message: "Stored extension field identity, type and storage are protected" });
    if (field.source_column && field.field_type !== "formula" && field.field_type !== "rollup") {
      const nextApiName = req.body.apiName !== undefined ? req.body.apiName : field.api_name;
      const nextReadable = req.body.readable !== undefined ? req.body.readable : field.readable;
      const nextActive = req.body.active !== undefined ? req.body.active : field.active;
      if (nextApiName !== field.api_name || nextReadable !== field.readable || nextActive === false) {
        return res.status(400).json({ success: false, message: "Mapped field identity and access are protected" });
      }
    }
    if (isExtensionField(field) && req.body.config) req.body.config = { ...req.body.config, storage: "extension" };
    if (req.body.apiName !== undefined && !isSafeIdentifier(req.body.apiName)) return res.status(400).json({ success: false, message: "apiName must be a safe identifier" });
    if (req.body.fieldType !== undefined && !FIELD_TYPES.has(req.body.fieldType)) return res.status(400).json({ success: false, message: "Unsupported field type" });
    if (req.body.sourceColumn !== undefined && req.body.sourceColumn !== null && !isSafeIdentifier(req.body.sourceColumn)) return res.status(400).json({ success: false, message: "sourceColumn must be a safe identifier" });
    try {
      const candidate = { ...field };
      for (const [api, column] of Object.entries({ apiName: "api_name", fieldType: "field_type", sourceColumn: "source_column", required: "required", writable: "writable", readable: "readable", config: "config", active: "active" })) {
        if (req.body[api] !== undefined) candidate[column] = req.body[api];
      }
      if (req.body.options !== undefined) candidate.options = req.body.options;
      await validatePicklistDefinition(db, candidate, req);
      await validateLookupConfiguration(field.object_id, candidate.field_type, candidate.config, req);
      await checkFormulaChange(field.object_id, candidate, field.id, req);
      if (field.active === true && candidate.active === false) {
        if (await fieldStoredValueCount(db, field, req.user.companyId) > 0) {
          return res.status(409).json({ success: false, code: "FIELD_HAS_VALUES", message: "Field contains stored values and cannot be deactivated" });
        }
        const references = await activeFieldReferences(db, field, req.user.companyId);
        if (references.length) {
          return res.status(409).json({
            success: false,
            code: "FIELD_IN_USE",
            message: `Field is referenced by active metadata: ${references.join(", ")}`,
          });
        }
      }
      const updated = await db("UPDATE platform_fields SET api_name=COALESCE($1,api_name), label=COALESCE($2,label), field_type=COALESCE($3,field_type), source_column=$4, required=COALESCE($5,required), readable=COALESCE($6,readable), writable=COALESCE($7,writable), options=COALESCE($8::jsonb,options), config=COALESCE($9::jsonb,config), display_order=COALESCE($10,display_order), active=COALESCE($11,active),user_modified=true WHERE id=$12 RETURNING *", [req.body.apiName, req.body.label, req.body.fieldType, req.body.sourceColumn === undefined ? field.source_column : req.body.sourceColumn, req.body.required, req.body.readable, req.body.writable, req.body.options === undefined ? null : JSON.stringify(req.body.options), req.body.config === undefined ? null : JSON.stringify(req.body.config), req.body.displayOrder, req.body.active, field.id]);
      res.json({ success: true, data: updated.rows[0] });
    } catch (error) {
      if (error instanceof FormulaError || error instanceof ConditionError) return res.status(400).json({ success: false, code: error.code, message: error.message });
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A field with this API name already exists" });
      console.error("Platform field update error:", error);
      res.status(500).json({ success: false, message: "Unable to update platform field" });
    }
  });

  router.delete("/platform/fields/:fieldId", ...manage, async (req, res) => {
    try {
    const existing = await db("SELECT f.*, o.company_id AS object_company_id, o.source_table, o.object_key FROM platform_fields f JOIN platform_objects o ON o.id=f.object_id WHERE f.id=$1 AND (f.company_id IS NULL OR f.company_id=$2) AND (o.company_id IS NULL OR o.company_id=$2)", [req.params.fieldId, req.user.companyId]);
    const field = existing.rows[0];
    if (!field || (field.company_id === null && !canManageGlobal(req))) return res.status(404).json({ success: false, message: "Field not found or not editable" });
    if (systemObject(field) && !field.company_id) return res.status(409).json({ success: false, message: "System fields cannot be deleted" });
    if (field.source_column && field.field_type !== "formula" && field.field_type !== "rollup") {
      return res.status(400).json({ success: false, code: "FIELD_MAPPED", message: "Mapped database fields cannot be deactivated or deleted" });
    }
    if (await fieldStoredValueCount(db, field, req.user.companyId) > 0) {
      return res.status(409).json({ success: false, code: "FIELD_HAS_VALUES", message: "Field contains stored values and cannot be deactivated" });
    }
    const references = await activeFieldReferences(db, field, req.user.companyId);
    if (references.length) {
      return res.status(409).json({
        success: false,
        code: "FIELD_IN_USE",
        message: `Field is referenced by active metadata: ${references.join(", ")}`,
      });
    }
    await checkFormulaChange(field.object_id, { ...field, active: false }, field.id, req);
    const result = await db("UPDATE platform_fields f SET active=false WHERE f.id=$1 AND (f.company_id=$2 OR (f.company_id IS NULL AND $3=true)) RETURNING f.*", [req.params.fieldId, req.user.companyId, canManageGlobal(req)]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Field not found or not editable" });
    res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error instanceof FormulaError) return res.status(400).json({ success: false, code: error.code, message: error.message });
      console.error("Platform field deactivate error:", error);
      res.status(500).json({ success: false, message: "Unable to deactivate field" });
    }
  });

  async function checkFormulaChange(objectId, candidate, replaceId, req) {
    for (const key of ["active", "readable", "writable", "required"]) {
      if (candidate[key] !== undefined && typeof candidate[key] !== "boolean") throw new FormulaError(`${key} must be a boolean`);
    }
    const existing = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label", [objectId, req.user.companyId]);
    const fields = [...existing.rows.filter(field => field.id !== replaceId), candidate];
    validateConditionConfig(candidate.config?.visibilityCondition, fields, "visibilityCondition");
    validateConditionConfig(candidate.config?.requiredCondition, fields, "requiredCondition");
    for (const key of ["visibilityCondition", "requiredCondition"]) {
      const conditions = candidate.config?.[key]?.conditions || [];
      if (conditions.some((condition) => condition.field === candidate.api_name)) {
        throw new ConditionError(`${key} cannot reference its own field`);
      }
    }
    if (candidate.field_type === "rollup") {
      const config = normalizeRollupConfig(candidate);
      if (!config || !config.relationshipKey) throw new FormulaError("Rollup fields require a relationshipKey in config");
      if (candidate.source_column !== undefined && candidate.source_column !== null) throw new FormulaError("Rollup fields are calculated values and cannot map to a source column");
      const rawOperation = candidate.config?.operation ?? candidate.config?.aggregate ?? candidate.config?.rollupOperation;
      if (rawOperation !== undefined && !ROLLUP_OPERATIONS.has(String(rawOperation).toUpperCase())) throw new FormulaError("Unsupported rollup operation");
      if (config.operation !== "COUNT" && !config.sourceField) throw new FormulaError(`${config.operation} rollups require a source field`);
      const relationship = await db("SELECT * FROM platform_relationships WHERE parent_object_id=$1 AND relationship_key=$2 AND active=true", [objectId, config.relationshipKey]);
      const relationshipRow = relationship.rows.find((row) => row.company_id === undefined || row.company_id === null || String(row.company_id) === String(req.user.companyId));
      if (!relationshipRow) throw new FormulaError(`Rollup relationship "${config.relationshipKey}" is not available on this object`);
      if (!relationshipRow.child_field_id) throw new FormulaError("Rollup relationship must define its child relationship field");
      const childFieldsResult = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND active=true ORDER BY display_order", [relationshipRow.child_object_id]);
      const childFields = childFieldsResult.rows.filter((childField) => childField.company_id === undefined || childField.company_id === null || String(childField.company_id) === String(req.user.companyId));
      const relationshipField = childFields.find((childField) => childField.id === relationshipRow.child_field_id);
      if (!relationshipField || !relationshipField.source_column || !isSafeIdentifier(relationshipField.source_column)) throw new FormulaError("Rollup relationship field is unavailable or unmapped");
      const sourceFieldInfo = (config.sourceField && childFields.find((childField) => childField.api_name === config.sourceField || childField.source_column === config.sourceField)) || null;
      if (config.operation !== "COUNT" && (!sourceFieldInfo || !["number", "decimal", "currency"].includes(sourceFieldInfo.field_type) || !sourceFieldInfo.source_column || !isSafeIdentifier(sourceFieldInfo.source_column))) {
        throw new FormulaError(`${config.operation} rollups require a numeric child field`);
      }
      if (config.condition) {
        const childFieldList = childFields;
        const candidateConfig = config.condition && typeof config.condition === "object" && config.condition.conditions ? config.condition : { match: "all", conditions: Array.isArray(config.condition) ? config.condition : [config.condition] };
        validateConditionConfig(candidateConfig, childFieldList, "rollup.condition");
      }
      if (candidate.active !== false) {
        const storedType = config.resultType || "number";
        if (!["number", "decimal", "currency", "boolean", "text"].includes(storedType)) throw new FormulaError("Rollup result type is unsupported");
      }
    }
    if (candidate.field_type === "formula" && candidate.active !== false) compileFormulas([{ ...candidate, active: true }, ...fields.filter(field => field !== candidate)]);
    compileFormulas(fields);
  }

  function hasReferencedFieldInFormula(expression, field) {
    if (typeof expression !== "string" || !expression.trim()) return false;
    return expression.includes(field.api_name) || expression.includes(String(field.id));
  }

  function hasReferencedFieldInFormula(expression, field) {
    if (typeof expression !== "string" || !expression.trim()) return false;
    return expression.includes(field.api_name) || expression.includes(String(field.id));
  }

  router.get("/platform/relationships", ...manage, async (req, res) => {
    const result = await db("SELECT r.*, p.object_key AS parent_object_key, c.object_key AS child_object_key FROM platform_relationships r JOIN platform_objects p ON p.id=r.parent_object_id JOIN platform_objects c ON c.id=r.child_object_id WHERE r.active=true AND (p.company_id IS NULL OR p.company_id=$1) ORDER BY r.relationship_key", [req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.post("/platform/relationships", ...manage, async (req, res) => {
    const { parentObjectId, childObjectId, relationshipKey, relationshipType = "lookup", childFieldId = null, onDelete = "restrict", onUpdate = "restrict" } = req.body || {};
    if (!relationshipKey || !RELATIONSHIP_TYPES.has(relationshipType) || !RELATIONSHIP_POLICIES.has(onDelete) || !RELATIONSHIP_POLICIES.has(onUpdate)) return res.status(400).json({ success: false, message: "Invalid relationship type or policy" });
    const referenceError = await validateReferences(req, parentObjectId, childObjectId, childFieldId);
    if (referenceError) return res.status(400).json({ success: false, message: referenceError });
    const parent = await getObject(parentObjectId, req);
    const child = await getObject(childObjectId, req);
    if (!canManageGlobal(req) && (parent.company_id === null || child.company_id === null)) return res.status(403).json({ success: false, message: "Only a Superadmin can change global relationships" });
    try {
      const result = await db("INSERT INTO platform_relationships (parent_object_id,child_object_id,relationship_key,relationship_type,child_field_id,on_delete,on_update) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [parentObjectId, childObjectId, relationshipKey, relationshipType, childFieldId, onDelete, onUpdate]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A relationship with this key already exists" });
      console.error("Platform relationship create error:", error);
      res.status(400).json({ success: false, message: "Unable to create relationship" });
    }
  });

  router.put("/platform/relationships/:relationshipId", ...manage, async (req, res) => {
    const current = await db("SELECT r.*, p.company_id FROM platform_relationships r JOIN platform_objects p ON p.id=r.parent_object_id WHERE r.id=$1 AND (p.company_id IS NULL OR p.company_id=$2)", [req.params.relationshipId, req.user.companyId]);
    const relationship = current.rows[0];
    if (!relationship || (relationship.company_id === null && !canManageGlobal(req))) return res.status(404).json({ success: false, message: "Relationship not found or not editable" });
    const parentId = req.body.parentObjectId || relationship.parent_object_id;
    const childId = req.body.childObjectId || relationship.child_object_id;
    const childFieldId = req.body.childFieldId === undefined ? relationship.child_field_id : req.body.childFieldId;
    const referenceError = await validateReferences(req, parentId, childId, childFieldId);
    if (referenceError) return res.status(400).json({ success: false, message: referenceError });
    const parent = await getObject(parentId, req);
    const child = await getObject(childId, req);
    if (!canManageGlobal(req) && (parent.company_id === null || child.company_id === null)) return res.status(403).json({ success: false, message: "Only a Superadmin can change global relationships" });
    const relationshipType = req.body.relationshipType || relationship.relationship_type;
    const onDelete = req.body.onDelete || relationship.on_delete;
    const onUpdate = req.body.onUpdate || relationship.on_update;
    if (!RELATIONSHIP_TYPES.has(relationshipType) || !RELATIONSHIP_POLICIES.has(onDelete) || !RELATIONSHIP_POLICIES.has(onUpdate)) return res.status(400).json({ success: false, message: "Invalid relationship type or policy" });
    const updated = await db("UPDATE platform_relationships SET parent_object_id=$1,child_object_id=$2,relationship_key=COALESCE($3,relationship_key),relationship_type=$4,child_field_id=$5,on_delete=$6,on_update=$7,active=COALESCE($8,active),user_modified=true WHERE id=$9 RETURNING *", [parentId, childId, req.body.relationshipKey, relationshipType, childFieldId, onDelete, onUpdate, req.body.active, relationship.id]);
    res.json({ success: true, data: updated.rows[0] });
  });

  router.delete("/platform/relationships/:relationshipId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_relationships r SET active=false,user_modified=true WHERE r.id=$1 AND EXISTS (SELECT 1 FROM platform_objects o WHERE o.id=r.parent_object_id AND (o.company_id=$2 OR (o.company_id IS NULL AND $3=true))) RETURNING r.*", [req.params.relationshipId, req.user.companyId, canManageGlobal(req)]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Relationship not found or not editable" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/objects/:objectId/list-views", ...manage, async (req, res) => {
    const object = await getObject(req.params.objectId, req);
    if (!object) return res.status(404).json({ success: false, message: "Object not found" });
    const result = await db("SELECT * FROM platform_list_views WHERE object_id=$1 AND company_id=$2 AND active=true ORDER BY label", [object.id, req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.post("/platform/objects/:objectId/list-views", ...manage, async (req, res) => {
    const object = await getObject(req.params.objectId, req, { forMutation: true });
    if (!object) return res.status(404).json({ success: false, message: "Object not found or not editable" });
    const fields = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order", [object.id, req.user.companyId]);
    const validFields = new Set(fields.rows.map((field) => field.api_name));
    const columns = Array.isArray(req.body?.columns) ? req.body.columns.filter((column) => typeof column === "string" && validFields.has(column)) : [];
    if (!req.body || typeof req.body.label !== "string" || !req.body.label.trim() || !columns.length) {
      return res.status(400).json({ success: false, message: "A label and at least one valid column are required" });
    }
    const viewKey = req.body.viewKey || toSafeApiName(req.body.label, "list_view");
    try {
      const result = await db(
        "INSERT INTO platform_list_views (object_id,company_id,view_key,label,description,columns,filters,sort,page_size,is_default) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10) RETURNING *",
        [object.id, req.user.companyId, viewKey, req.body.label.trim(), req.body.description || null, JSON.stringify(columns), JSON.stringify(req.body.filters || {}), JSON.stringify(normalizeListViewSort(req.body.sort)), Number(req.body.pageSize || 50), req.body.isDefault === true]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A list view with this key already exists" });
      console.error("Platform list view create error:", error);
      res.status(500).json({ success: false, message: "Unable to create list view" });
    }
  });

  router.put("/platform/list-views/:listViewId", ...manage, async (req, res) => {
    const existing = await db("SELECT * FROM platform_list_views WHERE id=$1 AND company_id=$2", [req.params.listViewId, req.user.companyId]);
    const view = existing.rows[0];
    if (!view) return res.status(404).json({ success: false, message: "List view not found or not editable" });
    const fields = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order", [view.object_id, req.user.companyId]);
    const validFields = new Set(fields.rows.map((field) => field.api_name));
    const columns = req.body.columns === undefined ? view.columns : (Array.isArray(req.body.columns) ? req.body.columns.filter((column) => typeof column === "string" && validFields.has(column)) : []);
    if (req.body.columns !== undefined && !columns.length) return res.status(400).json({ success: false, message: "List view columns must include at least one valid field" });
    if (req.body.viewKey !== undefined && !isSafeIdentifier(req.body.viewKey)) return res.status(400).json({ success: false, message: "viewKey must be a safe identifier" });
    try {
      const result = await db(
        "UPDATE platform_list_views SET view_key=COALESCE($1,view_key), label=COALESCE($2,label), description=COALESCE($3,description), active=COALESCE($4,active), columns=COALESCE($5::jsonb,columns), filters=COALESCE($6::jsonb,filters), sort=COALESCE($7::jsonb,sort), page_size=COALESCE($8,page_size), is_default=COALESCE($9,is_default), user_modified=true,updated_at=NOW() WHERE id=$10 RETURNING *",
        [req.body.viewKey, req.body.label, req.body.description, req.body.active, req.body.columns === undefined ? null : JSON.stringify(columns), req.body.filters === undefined ? null : JSON.stringify(req.body.filters || {}), req.body.sort === undefined ? null : JSON.stringify(normalizeListViewSort(req.body.sort)), req.body.pageSize === undefined ? null : Number(req.body.pageSize), req.body.isDefault, view.id]
      );
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A list view with this key already exists" });
      console.error("Platform list view update error:", error);
      res.status(500).json({ success: false, message: "Unable to update list view" });
    }
  });

  router.delete("/platform/list-views/:listViewId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_list_views SET active=false,user_modified=true WHERE id=$1 AND company_id=$2 RETURNING *", [req.params.listViewId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "List view not found or not editable" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/objects/:objectKey/reports", authenticate, async (req, res) => {
    try {
      const { object, fields: metadataFields } = await getRecordMetadata(req.params.objectKey, req);
      if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
      const result = await db(`SELECT * FROM platform_reports WHERE object_id=$1 AND company_id=$2${req.query.includeInactive === "true" ? "" : " AND active=true"} ORDER BY label`, [object.id, req.user.companyId]);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Platform report list error:", error);
      res.status(500).json({ success: false, message: "Unable to load object reports" });
    }
  });

  router.post("/platform/objects/:objectKey/reports", ...manage, async (req, res) => {
    try {
      const { object } = await getRecordMetadata(req.params.objectKey, req);
      if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
      const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
      if (!label) return res.status(400).json({ success: false, message: "A report label is required" });
      const reportKey = typeof req.body?.reportKey === "string" ? req.body.reportKey : toSafeApiName(label, "report");
      if (!isSafeIdentifier(reportKey)) return res.status(400).json({ success: false, message: "reportKey must be a safe identifier" });
      const config = normalizeReportConfig(req.body?.config || {});
      const result = await db(
        "INSERT INTO platform_reports (object_id,company_id,report_key,label,description,config) VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *",
        [object.id, req.user.companyId, reportKey, label, req.body?.description || null, JSON.stringify(config)]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A report with this key already exists" });
      console.error("Platform report create error:", error);
      res.status(500).json({ success: false, message: "Unable to create report" });
    }
  });

  router.get("/platform/objects/:objectKey/reports/:reportKey", authenticate, async (req, res) => {
    try {
      const { object, fields: metadataFields } = await getRecordMetadata(req.params.objectKey, req);
      if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
      const result = await db("SELECT * FROM platform_reports WHERE object_id=$1 AND company_id=$2 AND report_key=$3 AND active=true", [object.id, req.user.companyId, req.params.reportKey]);
      const report = result.rows[0];
      if (!report) return res.status(404).json({ success: false, message: "Report not found" });
      const fields = await applyFieldSecurity(db, metadataFields, req);
      const fieldByApiName = new Map(fields.filter((field) => field.active !== false && field.readable !== false).map((field) => [field.api_name, field]));
      const config = normalizeReportConfig(report.config);
      const whereClauses = [];
      const params = [];
      if (object.company_scoped) {
        params.push(req.user.companyId);
        whereClauses.push(`company_id=$${params.length}`);
      }
      if (object.store_scoped) {
        if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
        params.push(req.user.storeId);
        whereClauses.push(`store_id=$${params.length}`);
      }
      for (const filter of config.filters) {
        const field = fieldByApiName.get(filter.field);
        if (!platformFieldSql(field, object) || field.readable === false) continue;
        const column = `${platformFieldSql(field, object)}`;
        if (filter.operator === "is_null") {
          whereClauses.push(`${column} IS ${filter.value === false ? "NOT " : ""}NULL`);
        } else if (filter.operator === "in" && Array.isArray(filter.value) && filter.value.length) {
          params.push(filter.value.slice(0, 100));
          whereClauses.push(`${column} = ANY($${params.length})`);
        } else if (["eq", "neq", "gt", "gte", "lt", "lte"].includes(filter.operator)) {
          params.push(filter.value);
          whereClauses.push(`${column} ${({ eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" })[filter.operator]} $${params.length}`);
        } else if (filter.operator === "contains") {
          params.push(`%${String(filter.value ?? "").slice(0, 200)}%`);
          whereClauses.push(`${column} ILIKE $${params.length}`);
        }
      }
      appendSystemReadScope(object, req, whereClauses, params);
      const where = whereClauses.length ? ` WHERE ${whereClauses.join(" AND ")}` : "";
      const selectedFields = (config.fields.length ? config.fields : fields.filter((field) => field.readable !== false).map((field) => field.api_name))
        .map((name) => fieldByApiName.get(name))
        .filter((field) => platformFieldSql(field, object) && field.readable !== false);
      const selectList = selectedFields.length
        ? selectedFields.map((field) => `${platformFieldSql(field, object)} AS "${field.api_name}"`).join(", ")
        : "id";
      const orderBy = config.sort.map((item) => {
        const field = fieldByApiName.get(item.field);
        return platformFieldSql(field, object) && field.readable !== false
          ? `${platformFieldSql(field, object)} ${item.direction === "desc" ? "DESC" : "ASC"}` : null;
      }).filter(Boolean).join(", ");
      if (!config.groupBy) {
        const rows = await db(`SELECT ${selectList} FROM "${object.source_table}"${where}${orderBy ? ` ORDER BY ${orderBy}` : ""} LIMIT 500`, params);
        return res.json({ success: true, data: { report, rows: rows.rows, summary: { total: rows.rows.length } } });
      }
      const groupField = fieldByApiName.get(config.groupBy);
      if (!platformFieldSql(groupField, object)) {
        return res.status(400).json({ success: false, message: `Report grouping field "${config.groupBy}" is unavailable` });
      }
      const metricSql = config.metrics.map((metric) => {
        const metricType = metric.type || "count";
        if (metricType === "count") return "COUNT(*)::int AS \"count\"";
        const targetField = metric.field ? fieldByApiName.get(metric.field) : groupField;
        if (!platformFieldSql(targetField, object)) return "COUNT(*)::int AS \"count\"";
        if (metricType === "sum") return `COALESCE(SUM(${platformFieldSql(targetField, object)})::numeric, 0) AS "sum"`;
        if (metricType === "avg") return `COALESCE(AVG(${platformFieldSql(targetField, object)})::numeric, 0) AS "avg"`;
        if (metricType === "min") return `COALESCE(MIN(${platformFieldSql(targetField, object)})::numeric, 0) AS "min"`;
        if (metricType === "max") return `COALESCE(MAX(${platformFieldSql(targetField, object)})::numeric, 0) AS "max"`;
        return "COUNT(*)::int AS \"count\"";
      }).join(", ");
      const groupSort = config.sort.find((item) => item.field === config.groupBy);
      const rows = await db(`SELECT ${platformFieldSql(groupField, object)} AS "group_value", ${metricSql} FROM "${object.source_table}"${where} GROUP BY ${platformFieldSql(groupField, object)} ORDER BY ${platformFieldSql(groupField, object)} ${groupSort?.direction === "desc" ? "DESC" : "ASC"}`, params);
      res.json({ success: true, data: { report, rows: rows.rows, summary: rows.rows } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("Platform report execution error:", error);
      res.status(500).json({ success: false, message: "Unable to execute report" });
    }
  });

  router.put("/platform/reports/:reportId", ...manage, async (req, res) => {
    const existing = await db("SELECT * FROM platform_reports WHERE id=$1 AND company_id=$2", [req.params.reportId, req.user.companyId]);
    const report = existing.rows[0];
    if (!report) return res.status(404).json({ success: false, message: "Report not found or not editable" });
    const nextConfig = req.body?.config === undefined ? report.config : normalizeReportConfig(req.body.config);
    const result = await db(
      "UPDATE platform_reports SET label=COALESCE($1,label), description=COALESCE($2,description), active=COALESCE($3,active), config=COALESCE($4::jsonb,config), user_modified=true,updated_at=NOW() WHERE id=$5 RETURNING *",
      [req.body?.label, req.body?.description, req.body?.active, JSON.stringify(nextConfig), report.id]
    );
    res.json({ success: true, data: result.rows[0] });
  });

  router.delete("/platform/reports/:reportId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_reports SET active=false,user_modified=true WHERE id=$1 AND company_id=$2 RETURNING *", [req.params.reportId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Report not found or not editable" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/apps", ...manage, async (req, res) => {
    const result = await db("SELECT * FROM platform_apps WHERE company_id=$1 AND active=true ORDER BY label", [req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

router.get("/platform/runtime/apps", authenticate, async (req, res) => {
  const apps = await db(
    "SELECT * FROM platform_apps WHERE company_id=$1 AND active=true ORDER BY label",
    [req.user.companyId]
  );

  const pages = await db(
    `SELECT *
     FROM platform_pages
     WHERE company_id=$1
       AND active=true
     ORDER BY label`,
    [req.user.companyId]
  );

  const pagesByApp = new Map();

  for (const page of pages.rows) {
    const key = String(page.app_id);

    if (!pagesByApp.has(key)) {
      pagesByApp.set(key, []);
    }

    pagesByApp.get(key).push(page);
  }

  const data = apps.rows.map((app) => ({
    ...app,
    pages: pagesByApp.get(String(app.id)) || [],
  }));

  res.json({
    success: true,
    data,
  });
});

  router.get("/platform/runtime/pages/:pageKey", authenticate, async (req, res) => {
    const key = String(req.params.pageKey || "").trim();
    if (!isSafeIdentifier(key)) return res.status(400).json({ success: false, message: "Invalid page key" });
    const result = await db(
      `SELECT p.*, a.app_key, a.label AS app_label
       FROM platform_pages p
       JOIN platform_apps a ON a.id=p.app_id AND a.company_id=p.company_id AND a.active=true
       WHERE p.page_key=$1 AND p.company_id=$2 AND p.active=true
       LIMIT 1`,
      [key, req.user.companyId]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Page not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  /*
   * RECORD COLLECTION RUNTIME — the ONE generic record feed for record-bound
   * Custom Page components (MultiContainer today; future Table/List/Cards/
   * Kanban components reuse it unchanged).
   *
   *   Platform Object → Record Collection (this endpoint) → Visual Component
   *
   * It deliberately wraps the EXISTING generic record reader rather than adding
   * a second query path: same platform_objects/platform_fields metadata, same
   * field-security, same company/store scoping, same appendSystemReadScope
   * read rules and the SAME platform_object_permissions gate — a Record
   * Collection can never expose records the caller could not read through the
   * object runtime. Conditions are validated with the CANONICAL condition
   * engine (services/platformConditions.js — the same validateConditionConfig
   * used by workflows and validation rules), then translated to parameterised
   * SQL through object field metadata. No page-specific vocabulary, no
   * embedded SQL in components, no second engine.
   */
  router.post("/platform/runtime/record-collection", authenticate, async (req, res) => {
    try {
      const collection = req.body || {};
      const objectKey = typeof collection.objectKey === "string" ? collection.objectKey : null;
      if (!objectKey || !isSafeIdentifier(objectKey)) return res.status(400).json({ success: false, message: "A valid Record Collection objectKey is required" });
      const metadata = await db(
        "SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
        [objectKey, req.user.companyId]
      );
      const object = metadata.rows[0];
      if (!object || !object.source_table || !isSafeIdentifier(object.source_table)) return res.status(404).json({ success: false, message: "Object records are not available" });
      /* Runtime permission enforcement — component visibility is never a substitute. */
      if (!(await hasPlatformObjectPermission(db, req, object.id, "view"))) return res.status(403).json({ success: false, message: "You do not have permission to view records for this object" });
      if (object.store_scoped && !req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });

      const fieldsResult = await db(
        "SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order",
        [object.id, req.user.companyId]
      );
      const fields = await applyFieldSecurity(db, fieldsResult.rows, req);
      const readable = fields.filter((field) => field.readable !== false && field.field_type !== "formula" && field.field_type !== "rollup" && isSafeIdentifier(field.api_name) && Boolean(platformFieldSql(field, object)));
      const fieldByApiName = new Map(readable.map((field) => [field.api_name, field]));

      const clauses = [];
      const params = [];
      if (object.company_scoped) { params.push(req.user.companyId); clauses.push(`company_id=$${params.length}`); }
      if (object.store_scoped) { params.push(req.user.storeId); clauses.push(`store_id=$${params.length}`); }

      /*
       * Collection conditions — canonical condition engine.
       *
       * validateConditionConfig (the SAME function workflows and validation
       * rules pass through) validates every entry against this object's field
       * metadata: operators, numeric/boolean coercion, readability. Evaluation
       * is the engine's row-level evaluateCondition() semantics translated to
       * parameterised SQL through platformFieldSql(); "changed*" operators are
       * record-transition operators and are rejected here as meaningless for a
       * standing filter.
       */
      const conditions = Array.isArray(collection.conditions) ? collection.conditions.slice(0, 20) : [];
      const conditionMatch = collection.conditionMatch === "any" ? "any" : "all";
      try {
        if (conditions.length) validateConditionConfig({ match: conditionMatch, conditions }, fields, "Record Collection conditions");
      } catch (error) {
        if (error instanceof ConditionError) return res.status(400).json({ success: false, code: error.code, message: error.message });
        throw error;
      }
      const transitionOperators = new Set(["changed", "changed_from", "changed_to", "changed_from_to"]);
      const collectionConditions = conditions.filter((condition) => !transitionOperators.has(condition.operator));
      if (collectionConditions.length !== conditions.length) return res.status(400).json({ success: false, message: "Record Collection conditions use record-transition operators, which do not apply to a standing filter" });
      for (const condition of collectionConditions) {
        const field = fieldByApiName.get(String(condition?.field || ""));
        if (!field) return res.status(400).json({ success: false, message: `Collection conditions reference unavailable field "${condition?.field || "?"}"` });
        const column = platformFieldSql(field, object);
        if (condition.operator === "is_empty" || condition.operator === "is_not_empty") {
          clauses.push(`(${column} IS ${condition.operator === "is_empty" ? "" : "NOT "}NULL${field.source_column ? ` OR CAST(${column} AS TEXT) = ''` : ""})`);
          continue;
        }
        const value = condition.value;
        if (value === null || value === undefined || typeof value === "object") { params.push(null); }
        else params.push(value);
        const placeholder = `$${params.length}`;
        const comparable = `NULLIF(CAST(${column} AS TEXT), '')`;
        if (condition.operator === "not_equals") clauses.push(`(${column} IS DISTINCT FROM ${placeholder})`);
        else if (condition.operator === "greater_than") clauses.push(`${column} > ${placeholder}`);
        else if (condition.operator === "greater_than_or_equal") clauses.push(`${column} >= ${placeholder}`);
        else if (condition.operator === "less_than") clauses.push(`${column} < ${placeholder}`);
        else if (condition.operator === "less_than_or_equal") clauses.push(`${column} <= ${placeholder}`);
        else if (condition.operator === "is_empty") clauses.push(`(${comparable} IS NULL)`);
        else if (condition.operator === "is_not_empty") clauses.push(`(${comparable} IS NOT NULL)`);
        else clauses.push(`${column} = ${placeholder}`);
      }
      /* "any" wraps ONLY the condition clauses (already appended); scope
         clauses appended after this point stay AND-ed as mandatory. */
      const conditionClauseCount = clauses.length - (object.company_scoped ? 1 : 0) - (object.store_scoped ? 1 : 0);
      let conditionClauses = clauses.splice(0, conditionClauseCount);
      if (conditionClauseCount > 0 && conditionMatch === "any") conditionClauses = [`(${conditionClauses.join(" OR ")})`];
      clauses.unshift(...conditionClauses);
      if (["customers"].includes(object.source_table) && !req.platformCompanyCustomers) {
        /* Mirror the appendSystemReadScope customer-store rule for record feeds. */
        if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
        params.push(req.user.storeId, req.user.companyId);
        clauses.push(`EXISTS (SELECT 1 FROM customer_stores cs WHERE cs.customer_id="customers".id AND cs.store_id=$${params.length - 1} AND cs.company_id=$${params.length} AND cs.active=true)`);
      }
      appendSystemReadScope(object, req, clauses, params);

      /* Sort entries must name readable fields. */
      const sortEntries = Array.isArray(collection.sort) ? collection.sort.slice(0, 3) : [];
      const orderParts = [];
      for (const entry of sortEntries) {
        const field = fieldByApiName.get(String(entry?.field || ""));
        if (!field) return res.status(400).json({ success: false, message: `Collection sort references unavailable field "${entry?.field || "?"}"` });
        orderParts.push(`${platformFieldSql(field, object)} ${entry.direction === "asc" ? "ASC" : "DESC"}`);
      }
      if (!orderParts.length) orderParts.push("created_at DESC NULLS LAST");

      const limit = boundedInteger(collection.maxRecords ?? collection.maxRecords ?? 10, 10, 50);
      const requestedFields = Array.isArray(collection.fields) ? collection.fields.map(String).filter((name) => fieldByApiName.has(name)) : [];
      const selectFields = requestedFields.length ? requestedFields : readable.slice(0, 12).map((field) => field.api_name);
      const selectList = ["id", ...selectFields.map((name) => `${platformFieldSql(fieldByApiName.get(name), object)} AS "${name}"`)];
      const offset = Math.max(0, Number.parseInt(collection.offset, 10) || 0);
      const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      const result = await db(
        `SELECT ${selectList.join(", ")} FROM "${object.source_table}"${where} ORDER BY ${orderParts.join(", ")} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const count = await db(`SELECT COUNT(*)::int AS total FROM "${object.source_table}"${where}`, params);
      const records = await populateRollups(db, object, fields, result.rows, req);
      res.json({ success: true, data: records, records, objectKey: object.object_key, limit, offset, total: count.rows[0]?.total || 0 });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("Record collection runtime error:", error);
      res.status(500).json({ success: false, message: "Unable to load record collection" });
    }
  });

  /*
   * PAGE INTERACTION RUNTIME — the ONE executor for Custom Page On Click
   * bindings (MultiContainer/Table record clicks AND Button clicks).
   *
   * It reuses the existing execution machinery only:
   *   - workflowUuid  → platform_rules workflow, executed via the existing
   *     executeWorkflowActions pipeline (run + step records, permissions,
   *     registry validation) — the canonical UI invocation path
   *   - actionKey     → registered Action Registry handler, with its declared
   *     requiredPermissions enforced here before execution
   *
   * The workflow's Current Record is the clicked record when the interaction
   * comes from a record-bound component; for unbound Buttons the record is
   * OPTIONAL — the workflow runs with page context (user/company/store) only.
   * There is no second workflow engine and no second action engine here.
   */
  router.post("/platform/runtime/page-interactions/execute", authenticate, async (req, res, next) => {
    try {
      const interaction = req.body || {};
      const type = String(interaction.type || "");
      const recordId = interaction.recordId ? String(interaction.recordId) : null;
      const objectKey = typeof interaction.objectKey === "string" && isSafeIdentifier(interaction.objectKey) ? interaction.objectKey : null;
      if (recordId && !recordIdIsValid(recordId)) return res.status(400).json({ success: false, message: "Invalid record identifier" });

      /* Resolve the bound object (required for actions, optional for
         record-less workflows) and the Current Record when supplied. */
      let object = null;
      let record = null;
      if (objectKey) {
        const objectResult = await db(
          "SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
          [objectKey, req.user.companyId]
        );
        object = objectResult.rows[0] || null;
        if (!object) return res.status(404).json({ success: false, message: "Object not found" });
        if (recordId) {
          const recordClauses = ["id=$1"];
          const recordParams = [recordId];
          if (object.company_scoped) { recordParams.push(req.user.companyId); recordClauses.push(`company_id=$${recordParams.length}`); }
          if (object.store_scoped) {
            if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
            recordParams.push(req.user.storeId); recordClauses.push(`store_id=$${recordParams.length}`);
          }
          appendSystemReadScope(object, req, recordClauses, recordParams);
          const recordResult = await db(`SELECT * FROM "${object.source_table}" WHERE ${recordClauses.join(" AND ")}`, recordParams);
          if (!recordResult.rows.length) return res.status(404).json({ success: false, message: "Record not found" });
          record = recordResult.rows[0];
        }
      }

      if (type === "workflow") {
        const workflowUuid = String(interaction.workflowUuid || "");
        if (!recordIdIsValid(workflowUuid)) return res.status(400).json({ success: false, message: "A valid workflow reference is required" });
        const workflowResult = await db(
          "SELECT * FROM platform_rules WHERE id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) LIMIT 1",
          [workflowUuid, req.user.companyId]
        );
        const workflow = workflowResult.rows[0];
        if (!workflow) return res.status(404).json({ success: false, message: "Configured workflow not found" });
        if (workflow.object_id && object && String(workflow.object_id) !== String(object.id)) {
          return res.status(400).json({ success: false, message: "The configured workflow belongs to a different object" });
        }
        const actions = Array.isArray(workflow.action?.actions) ? workflow.action.actions : [];
        if (!actions.length) return res.status(422).json({ success: false, message: "Configured workflow contains no executable actions" });
        for (const workflowAction of actions) {
          validateWorkflowAction(workflowAction);
          const definition = getWorkflowActionDefinition(workflowAction.type || workflowAction.key);
          for (const requiredPermission of definition?.requiredPermissions || []) {
            if (!(await hasExecutionPermission(req, requiredPermission))) {
              return res.status(403).json({ success: false, message: `You do not have permission to execute ${workflowAction.type || workflowAction.key}` });
            }
          }
        }
        const run = await createWorkflowRun({
          db,
          companyId: req.user.companyId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          objectId: object?.id || null,
          recordId: record?.id || null,
          triggerKey: "page_interaction",
          status: "RUNNING",
          metadata: { actorUserId: req.user.id || null, pageInteraction: true },
        });
        try {
          const results = await executeWorkflowActions({
            actions,
            db,
            req,
            object,
            record,
            recordId: record?.id || null,
            companyId: req.user.companyId,
            runId: run?.id || null,
            trigger: "page_interaction",
          });
          if (run?.id) {
            await db(
              "UPDATE platform_workflow_runs SET status=$1, completed_at=NOW(), updated_at=NOW() WHERE id=$2 AND company_id=$3",
              ["COMPLETED", run.id, req.user.companyId]
            );
          }
          return res.json({ success: true, data: { runId: run?.id || null, results } });
        } catch (error) {
          if (run?.id) {
            await db(
              "UPDATE platform_workflow_runs SET status=$1, completed_at=NOW(), updated_at=NOW(), metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb WHERE id=$3 AND company_id=$4",
              ["FAILED", JSON.stringify({ error: error.message || "Workflow execution failed" }), run.id, req.user.companyId]
            );
          }
          throw error;
        }
      }

      if (type === "action") {
        const actionKey = String(interaction.actionKey || "").trim();
        if (!actionKey) return res.status(400).json({ success: false, message: "A registered action key is required" });
        const core = listRegisteredPlatformActions().find((item) => item.key === actionKey);
        if (!core) return res.status(404).json({ success: false, message: "Registered action not found" });
        if (["RECORD_SAVE", "RECORD_DELETE"].includes(core.key)) {
          return res.status(409).json({ success: false, message: "RECORD_SAVE and RECORD_DELETE belong to the canonical record page lifecycle" });
        }
        if (core.key === "WORKFLOW") return res.status(422).json({ success: false, message: "Use the Workflow interaction type to run workflows" });
        for (const requiredPermission of core.requiredPermissions || []) {
          if (!(await hasExecutionPermission(req, requiredPermission))) {
            return res.status(403).json({ success: false, message: `You do not have permission to execute ${core.displayName || core.key}` });
          }
        }
        const definition = getWorkflowActionDefinition(core.key);
        if (!definition) return res.status(422).json({ success: false, message: "Registered action handler is unavailable" });
        try {
          definition.validation?.({ type: core.key });
        } catch { /* argument-shape validation happens inside the executor. */ }
        const result = await executeWorkflowAction({
          db, req, object, record, recordId: record?.id || null, companyId: req.user.companyId,
          action: { type: core.key, ...(interaction.config || {}) },
        });
        return res.json({ success: true, data: result });
      }

      return res.status(400).json({ success: false, message: "Unsupported page interaction type" });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      next(error);
    }
  });

  /*
   * MY PROFILE RECORD — the ONE canonical record-page feed for the signed-in
   * user's own account. It resolves the users-backed Platform Object (the
   * canonical "employee" object by default, or the objectKey the shell is
   * already looking at) and returns that record with the SAME metadata-driven
   * fields the generic object runtime renders, so the shell can open the
   * profile through the ONE /app/objects/<key> record route — the SAME record
   * page architecture every other Object uses. No ad hoc profile surface, no
   * second record-view system, no SQL in components.
   *
   * Self access is deliberately READ-ONLY and limited to the caller's own row:
   * viewing your own account record must not require the object's can_view
   * grant (which would otherwise expose the whole directory). Every write path
   * stays behind the existing manage/permission gates untouched.
   */
  /*
   * RECORD PAGE FEED — the ONE canonical resolver for a record deep link
   * (/app/objects/<key>/records/<recordId>): the navigation-target resolver
   * and the shell both point Object Record navigation here, and the record
   * page renders it through the SAME generic object runtime.
   *
   * The user's OWN record keeps its dedicated feed (GET /runtime/my-record)
   * — self access deliberately bypasses the object grant. Every OTHER record
   * resolves through THIS feed, which enforces the platform's normal
   * visibility exactly like the records list:
   *
   *   active object of this company (or a system object)
   *     → the caller's platform_object_permissions can_view grant
   *       (superadmin excepted, matching loadObjectNavigation)
   *   → object company/store scoping + appendSystemReadScope
   *     → readable fields through field security
   *
   * A forged or cross-company record id therefore 403/404s here and the
   * navigation layer never exposes data the object runtime would refuse.
   */
  router.get("/platform/runtime/record-page", authenticate, async (req, res) => {
    try {
      const objectKey = typeof req.query.objectKey === "string" && isSafeIdentifier(req.query.objectKey) ? req.query.objectKey : null;
      const recordId = typeof req.query.recordId === "string" ? req.query.recordId : "";
      if (!objectKey || !recordIdIsValid(recordId)) return res.status(400).json({ success: false, message: "A valid object key and record identifier are required" });
      const metadata = await db(
        "SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
        [objectKey, req.user.companyId]
      );
      const object = metadata.rows[0];
      if (!object || !object.source_table || !isSafeIdentifier(object.source_table)) {
        return res.status(404).json({ success: false, message: "Object is not available" });
      }
      if (!(await hasPlatformObjectPermission(db, req, object.id, "view"))) {
        return res.status(403).json({ success: false, message: "You do not have permission to view records for this object" });
      }
      if (object.store_scoped && !req.user.storeId) {
        return res.status(403).json({ success: false, message: "A store session is required" });
      }
      const fieldsResult = await db(
        "SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order",
        [object.id, req.user.companyId]
      );
      const fields = await applyFieldSecurity(db, safeSystemFields(object, fieldsResult.rows), req);
      const readable = fields.filter((field) => field.readable !== false && field.field_type !== "formula" && field.field_type !== "rollup" && isSafeIdentifier(field.api_name) && Boolean(platformFieldSql(field, object)));
      const columns = readable.map((field) => `${platformFieldSql(field, object)} AS "${field.api_name}"`);
      if (!columns.length) return res.status(404).json({ success: false, message: "Record is not available" });

      /* Scope is the requested row plus the object's normal company/store
         visibility — never a wider read. */
      const clauses = ["id=$1"];
      const params = [recordId];
      if (object.company_scoped) {
        params.push(req.user.companyId);
        clauses.push(`company_id=$${params.length}`);
      }
      if (object.store_scoped) {
        params.push(req.user.storeId);
        clauses.push(`store_id=$${params.length}`);
      }
      appendSystemReadScope(object, req, clauses, params);
      const result = await db(`SELECT ${columns.join(", ")}, "${object.source_table}".id AS "id" FROM "${object.source_table}" WHERE ${clauses.join(" AND ")}`, params);
      const record = result.rows[0] || null;
      if (!record) return res.status(404).json({ success: false, message: "Record not found" });

      return res.json({
        success: true,
        data: {
          object,
          record,
          fields: readable,
          objectKey: object.object_key,
          recordPath: `${OBJECT_RUNTIME_ROUTE_PREFIX}${encodeURIComponent(object.object_key)}/records/${encodeURIComponent(record.id)}`,
        },
      });
    } catch (error) {
      console.error("Record page feed error:", error);
      res.status(500).json({ success: false, message: "Unable to load the record" });
    }
  });

  router.get("/platform/runtime/my-record", authenticate, async (req, res) => {
    try {
      const objectKey = typeof req.query.objectKey === "string" && isSafeIdentifier(req.query.objectKey) ? req.query.objectKey : "employee";
      /* A recordId is accepted for deep links (browser refresh of the profile
         route) but is validated to be the caller's OWN record — self access
         never widens to another user's row. */
      const requestedRecordId = typeof req.query.recordId === "string" ? req.query.recordId : "";
      if (requestedRecordId) {
        if (!recordIdIsValid(requestedRecordId)) return res.status(400).json({ success: false, message: "Invalid record identifier" });
        if (requestedRecordId !== req.user.id) return res.status(403).json({ success: false, message: "You can only open your own record through the profile route" });
      }
      const metadata = await db(
        "SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
        [objectKey, req.user.companyId]
      );
      const object = metadata.rows[0];
      if (!object || !object.source_table || !isSafeIdentifier(object.source_table)) {
        return res.status(404).json({ success: false, message: "User record object is not available" });
      }
      /* Only the users-backed object family qualifies — a tenant must not be
         able to repoint the profile at an arbitrary object. */
      const system = systemObject(object);
      if (!system || system.table !== "users") {
        return res.status(400).json({ success: false, message: "The configured object does not represent user accounts" });
      }
      if (object.store_scoped && !req.user.storeId) {
        return res.status(403).json({ success: false, message: "A store session is required" });
      }

      const fieldsResult = await db(
        "SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order",
        [object.id, req.user.companyId]
      );
      const fields = await applyFieldSecurity(db, safeSystemFields(object, fieldsResult.rows), req);
      const readable = fields.filter((field) => field.readable !== false && field.field_type !== "formula" && field.field_type !== "rollup" && isSafeIdentifier(field.api_name) && Boolean(platformFieldSql(field, object)));
      const columns = readable.map((field) => `${platformFieldSql(field, object)} AS "${field.api_name}"`);
      if (!columns.length) return res.status(404).json({ success: false, message: "User record is not available" });

      /* Scope is the caller's OWN row (id=$1) plus the object's normal
         company/store visibility — never a wider read. */
      const clauses = ["id=$1"];
      const params = [req.user.id];
      if (object.company_scoped) {
        params.push(req.user.companyId);
        clauses.push(`company_id=$${params.length}`);
      }
      if (object.store_scoped) {
        params.push(req.user.storeId);
        clauses.push(`store_id=$${params.length}`);
      }
      appendSystemReadScope(object, req, clauses, params);
      const result = await db(`SELECT ${columns.join(", ")}, "${object.source_table}".id AS "id" FROM "${object.source_table}" WHERE ${clauses.join(" AND ")}`, params);
      const record = result.rows[0] || null;
      if (!record) return res.status(404).json({ success: false, message: "Your user record could not be found" });

      return res.json({
        success: true,
        data: {
          object,
          record,
          fields: readable,
          objectKey: object.object_key,
          recordPath: `${OBJECT_RUNTIME_ROUTE_PREFIX}${encodeURIComponent(object.object_key)}/records/${encodeURIComponent(record.id)}`,
        },
      });
    } catch (error) {
      console.error("My record error:", error);
      res.status(500).json({ success: false, message: "Unable to load your record" });
    }
  });

  /*
   * NAVIGATION TARGET REGISTRY — the server-side discovery feed for Builder
   * components (Custom Button On Click → Navigate and every future
   * navigation-capable component).
   *
   * Destinations are discovered from the SAME authoritative sources the
   * shells already use — never a second route list:
   *
   *   customPages → the company-scoped active platform_pages rows (key +
   *                 label only; the Builder stores the KEY, not the label)
   *   objectPages → the SAME loadObjectNavigation() payload the app-catalog
   *                 returns: object visibility, module licence/enablement,
   *                 device profile and the caller's object permissions are
   *                 all filtered server-side, so a destination a caller
   *                 cannot reach never becomes configurable in the first
   *                 place.
   *
   * System pages are not duplicated here: the client derives them from the
   * ONE navCatalogue with the caller's permission state (already shipped by
   * /api/auth/me/permissions), and the runtime resolver re-checks them at
   * click time. Navigation remains discoverability only — every destination
   * endpoint keeps enforcing its own authorization.
   */
  router.get("/platform/runtime/navigation-targets", authenticate, async (req, res) => {
    try {
      const [userResult, permissionResult, entitlementResult] = await Promise.all([
        db("SELECT is_superadmin FROM users WHERE id=$1 AND active=true", [req.user.id]),
        db(
          `SELECT p.code
           FROM role_permissions rp
           JOIN permissions p ON p.id=rp.permission_id
           WHERE rp.role_id=$1`,
          [req.user.roleId]
        ),
        getCompanyEntitlements(db, req.user.companyId),
      ]);
      const isSuperadmin = userResult.rows[0]?.is_superadmin === true;
      const permissions = permissionResult.rows.map((row) => row.code);
      const navigation = await loadObjectNavigation(req, { isSuperadmin, permissions, entitlements: entitlementResult });
      const pagesResult = await db(
        "SELECT page_key, label FROM platform_pages WHERE company_id=$1 AND active=true ORDER BY label",
        [req.user.companyId]
      );
      res.json({
        success: true,
        data: {
          customPages: pagesResult.rows
            .filter((page) => isSafeIdentifier(page.page_key))
            .map((page) => ({ key: page.page_key, label: page.label || page.page_key })),
          objectPages: navigation.entries,
        },
      });
    } catch (error) {
      console.error("Navigation targets error:", error);
      res.status(500).json({ success: false, message: "Unable to load navigation targets" });
    }
  });

  router.get("/platform/runtime/apps/:appId", authenticate, async (req, res) => {
    const result = await db("SELECT * FROM platform_apps WHERE id=$1 AND company_id=$2 AND active=true", [req.params.appId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "App not found" });
    const pages = await db("SELECT * FROM platform_pages WHERE app_id=$1 AND company_id=$2 AND active=true ORDER BY label", [req.params.appId, req.user.companyId]);
    res.json({ success: true, data: { ...result.rows[0], pages: pages.rows } });
  });

  router.get("/platform/apps/:appId", ...manage, async (req, res) => {
    const result = await db("SELECT * FROM platform_apps WHERE id=$1 AND company_id=$2 AND active=true", [req.params.appId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "App not found" });
    const pages = await db("SELECT * FROM platform_pages WHERE app_id=$1 AND company_id=$2 AND active=true ORDER BY label", [result.rows[0].id, req.user.companyId]);
    res.json({ success: true, data: { ...result.rows[0], pages: pages.rows } });
  });

  router.post("/platform/apps", ...manage, async (req, res) => {
    if (!req.body || typeof req.body.label !== "string" || !req.body.label.trim()) {
      return res.status(400).json({ success: false, message: "A valid app label is required" });
    }
    const appKey = typeof req.body.appKey === "string" ? req.body.appKey : toSafeApiName(req.body.label, "app");
    if (!isSafeIdentifier(appKey)) return res.status(400).json({ success: false, message: "appKey must be a safe identifier" });
    const config = normalizeAppConfig(req.body.config);
    try {
      const result = await db(
        "INSERT INTO platform_apps (company_id,app_key,label,description,config) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *",
        [req.user.companyId, appKey, req.body.label.trim(), req.body.description || null, JSON.stringify(config)]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "An app with this key already exists" });
      console.error("Platform app create error:", error);
      res.status(500).json({ success: false, message: "Unable to create app" });
    }
  });

  router.put("/platform/apps/:appId", ...manage, async (req, res) => {
    const existing = await db("SELECT * FROM platform_apps WHERE id=$1 AND company_id=$2", [req.params.appId, req.user.companyId]);
    const app = existing.rows[0];
    if (!app) return res.status(404).json({ success: false, message: "App not found or not editable" });
    const nextConfig = req.body?.config === undefined ? app.config : normalizeAppConfig(req.body.config);
    const result = await db(
      "UPDATE platform_apps SET app_key=COALESCE($1,app_key), label=COALESCE($2,label), description=COALESCE($3,description), active=COALESCE($4,active), config=COALESCE($5::jsonb,config), updated_at=NOW() WHERE id=$6 RETURNING *",
      [req.body?.appKey, req.body?.label, req.body?.description, req.body?.active, JSON.stringify(nextConfig), app.id]
    );
    res.json({ success: true, data: result.rows[0] });
  });

  router.delete("/platform/apps/:appId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_apps SET active=false WHERE id=$1 AND company_id=$2 RETURNING *", [req.params.appId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "App not found or not editable" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/apps/:appId/pages", ...manage, async (req, res) => {
    const app = await db("SELECT * FROM platform_apps WHERE id=$1 AND company_id=$2 AND active=true", [req.params.appId, req.user.companyId]);
    if (!app.rows.length) return res.status(404).json({ success: false, message: "App not found" });
    const result = await db("SELECT * FROM platform_pages WHERE app_id=$1 AND company_id=$2 AND active=true ORDER BY label", [app.rows[0].id, req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.post("/platform/apps/:appId/pages", ...manage, async (req, res) => {
    const app = await db("SELECT * FROM platform_apps WHERE id=$1 AND company_id=$2 AND active=true", [req.params.appId, req.user.companyId]);
    if (!app.rows.length) return res.status(404).json({ success: false, message: "App not found" });
    if (!req.body || typeof req.body.label !== "string" || !req.body.label.trim()) {
      return res.status(400).json({ success: false, message: "A valid page label is required" });
    }
    const pageKey = typeof req.body.pageKey === "string" ? req.body.pageKey : toSafeApiName(req.body.label, "page");
    if (!isSafeIdentifier(pageKey)) return res.status(400).json({ success: false, message: "pageKey must be a safe identifier" });
    const pageType = ["object", "list_view", "report"].includes(req.body.pageType) ? req.body.pageType : "object";
    const definition = normalizePageDefinition(req.body.definition);
    try {
      const result = await db(
        "INSERT INTO platform_pages (app_id,company_id,page_key,label,route_path,page_type,definition) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *",
        [app.rows[0].id, req.user.companyId, pageKey, req.body.label.trim(), req.body.routePath || "/", pageType, JSON.stringify(definition)]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A page with this key already exists" });
      console.error("Platform page create error:", error);
      res.status(500).json({ success: false, message: "Unable to create page" });
    }
  });

  router.put("/platform/pages/:pageId", ...manage, async (req, res) => {
    const page = await db("SELECT * FROM platform_pages WHERE id=$1 AND company_id=$2", [req.params.pageId, req.user.companyId]);
    if (!page.rows.length) return res.status(404).json({ success: false, message: "Page not found or not editable" });
    const definition = req.body?.definition === undefined ? page.rows[0].definition : normalizePageDefinition(req.body.definition);
    const result = await db(
      "UPDATE platform_pages SET page_key=COALESCE($1,page_key), label=COALESCE($2,label), route_path=COALESCE($3,route_path), page_type=COALESCE($4,page_type), definition=COALESCE($5::jsonb,definition), active=COALESCE($6,active), updated_at=NOW() WHERE id=$7 RETURNING *",
      [req.body?.pageKey, req.body?.label, req.body?.routePath, req.body?.pageType, JSON.stringify(definition), req.body?.active, page.rows[0].id]
    );
    res.json({ success: true, data: result.rows[0] });
  });

  router.delete("/platform/pages/:pageId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_pages SET active=false WHERE id=$1 AND company_id=$2 RETURNING *", [req.params.pageId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Page not found or not editable" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/layouts", ...manage, async (req, res) => {
    const includeInactive = req.query.includeInactive === "true";
    const result = await db(`SELECT * FROM platform_layouts
      WHERE (company_id IS NULL OR company_id=$1) ${includeInactive ? "" : "AND active=true"} ORDER BY name`, [req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.get("/platform/layouts/effective", authenticate, async (req, res) => {
    const object = await getObject(req.query.objectId, req);
    if (!object) return res.status(404).json({ success: false, message: "Object not found" });
    const pageType = req.query.pageType || req.query.page_type || "detail";
    if (!PAGE_TYPES.has(pageType)) return res.status(400).json({ success: false, message: "Invalid page type" });
    const result = await db(
      `SELECT * FROM platform_layouts
       WHERE object_id=$1 AND page_type=$2 AND active=true
         AND (company_id IS NULL OR company_id=$3)
         AND (role_id IS NULL OR role_id=$4)
       ORDER BY CASE WHEN role_id=$4 THEN 0 WHEN is_default=true THEN 1 WHEN company_id=$3 THEN 2 ELSE 3 END,
         updated_at DESC, id`,
      [object.id, pageType, req.user.companyId, req.user.roleId || null]
    );
    res.json({ success: true, data: resolvePageLayout(result.rows) });
  });

  router.post("/platform/layouts/:layoutId/clone", ...manage, async (req, res) => {
    const existing = await db("SELECT * FROM platform_layouts WHERE id=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [req.params.layoutId, req.user.companyId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: "Layout not found" });
    const source = existing.rows[0];
    const name = String(req.body?.name || `${source.name} Copy`).trim();
    if (!name) return res.status(400).json({ success: false, message: "A layout name is required" });
    const layoutKey = toSafeApiName(name, "layout");
    try {
      const result = await db(
        "INSERT INTO platform_layouts (object_id,page_type,role_id,company_id,record_type_id,name,layout_key,definition,active,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,true,false) RETURNING *",
        [source.object_id, source.page_type, source.role_id, req.user.companyId, source.record_type_id, name, layoutKey, JSON.stringify(source.definition)]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A layout with this API key already exists for this object and page type" });
      console.error("Platform layout clone error:", error);
      res.status(500).json({ success: false, message: "Unable to clone platform layout" });
    }
  });

  router.get("/platform/layouts/:layoutId", ...manage, async (req, res) => {
    const result = await db("SELECT * FROM platform_layouts WHERE id=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [req.params.layoutId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Layout not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.post("/platform/layouts", ...manage, async (req, res) => {
    if (!validLayoutInput(req.body)) return res.status(400).json({ success: false, message: "A valid layout definition is required" });
    const object = await getObject(req.body.objectId, req);
    if (!object) return res.status(400).json({ success: false, message: "Object not found" });
    const definitionError = await validateLayoutDefinition(db, req.body.definition, object, req);
    if (definitionError) return res.status(400).json({ success: false, message: definitionError });
    const companyId = req.body.companyId || req.user.companyId;
    if (companyId !== req.user.companyId && !canManageGlobal(req)) return res.status(403).json({ success: false, message: "Cannot manage another company's layout" });
    if (!(await validateLayoutRole(db, req.body.roleId, req))) return res.status(400).json({ success: false, message: "Role does not belong to this company" });
    let recordTypeId = req.body.recordTypeId || null;
    if (recordTypeId && !(await resolveRecordType(object, recordTypeId, req))) return res.status(400).json({ success: false, message: "Record type does not belong to this object and company" });
    // The layout API key is always generated deterministically from the layout
    // label using the same safeApiName convention as objects and fields. Client
    // layoutKey values are ignored, duplicates are rejected (never suffixed),
    // and legacy rows keep their stored key because ON CONFLICT only fires for
    // a layout with the same object/page/role/company identity.
    const pageType = req.body.pageType ?? req.body.page_type;
    const layoutKey = toSafeApiName(req.body.layoutKey || req.body.name, "layout");
    try {
      const result = recordTypeId
        ? await db("INSERT INTO platform_layouts (object_id,page_type,role_id,company_id,record_type_id,name,layout_key,definition,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *", [object.id, pageType, req.body.roleId || null, companyId, recordTypeId, req.body.name.trim(), layoutKey, JSON.stringify(req.body.definition), req.body.isDefault === true])
        : await db("INSERT INTO platform_layouts (object_id,page_type,role_id,company_id,name,layout_key,definition,is_default) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT (object_id,page_type,role_id,company_id) DO UPDATE SET name=EXCLUDED.name, definition=EXCLUDED.definition, is_default=CASE WHEN EXCLUDED.is_default THEN true ELSE platform_layouts.is_default END, active=true, updated_at=NOW() RETURNING *", [object.id, pageType, req.body.roleId || null, companyId, req.body.name.trim(), layoutKey, JSON.stringify(req.body.definition), req.body.isDefault === true]);
      await syncLayoutButtons(db, req, result.rows[0], { deactivateExisting: false });
      if (req.body.isDefault === true) {
        await db("UPDATE platform_layouts SET is_default=false WHERE object_id=$1 AND page_type=$2 AND id<>$3 AND (company_id IS NULL OR company_id=$4)", [object.id, pageType, result.rows[0].id, req.user.companyId]);
      }
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") {
        if (error.constraint === "uq_platform_layouts_object_page_key") return res.status(409).json({ success: false, message: "A layout with this API key already exists for this object and page type. Choose a different layout name." });
        return res.status(409).json({ success: false, message: "A layout already exists for this object, page type, role and company" });
      }
      console.error("Platform layout create error:", error);
      res.status(500).json({ success: false, message: "Unable to create platform layout" });
    }
  });

  router.put("/platform/layouts/:layoutId", ...manage, async (req, res) => {
    if (!validLayoutInput(req.body)) return res.status(400).json({ success: false, message: "A valid layout definition is required" });
    const existing = await db("SELECT * FROM platform_layouts WHERE id=$1 AND (company_id IS NULL OR company_id=$2)", [req.params.layoutId, req.user.companyId]);
    if (!existing.rows.length || (existing.rows[0].company_id === null && !canManageGlobal(req))) return res.status(404).json({ success: false, message: "Layout not found or not editable" });
    // Layout API keys are immutable: renaming the display label only changes
    // name, never the generated layout_key. The page type cannot change to one
    // that already has a layout with the same generated key (unique index).
    const pageType = req.body.pageType ?? req.body.page_type;
    const recordTypeId = req.body.recordTypeId === undefined ? existing.rows[0].record_type_id || null : req.body.recordTypeId || null;
    const existingObject = await getObject(existing.rows[0].object_id, req);
    if (!existingObject) return res.status(404).json({ success: false, message: "Object not found" });
    const definitionError = await validateLayoutDefinition(db, req.body.definition, existingObject, req);
    if (definitionError) return res.status(400).json({ success: false, message: definitionError });
    if (recordTypeId) {
      if (!existingObject || !(await resolveRecordType(existingObject, recordTypeId, req))) return res.status(400).json({ success: false, message: "Record type does not belong to this object and company" });
    }
    if (!(await validateLayoutRole(db, req.body.roleId, req))) return res.status(400).json({ success: false, message: "Role does not belong to this company" });
    try {
      const result = recordTypeId
        ? await db("UPDATE platform_layouts SET page_type=$1,role_id=$2,record_type_id=$3,name=$4,definition=$5::jsonb,active=COALESCE($6,active),is_default=CASE WHEN COALESCE($6,active)=false THEN false ELSE COALESCE($7,is_default) END,user_modified=true,updated_at=NOW() WHERE id=$8 RETURNING *", [pageType, req.body.roleId || null, recordTypeId, req.body.name.trim(), JSON.stringify(req.body.definition), req.body.active, req.body.isDefault, req.params.layoutId])
        : await db("UPDATE platform_layouts SET page_type=$1,role_id=$2,name=$3,definition=$4::jsonb,active=COALESCE($5,active),is_default=CASE WHEN COALESCE($5,active)=false THEN false ELSE COALESCE($6,is_default) END,user_modified=true,updated_at=NOW() WHERE id=$7 RETURNING *", [pageType, req.body.roleId || null, req.body.name.trim(), JSON.stringify(req.body.definition), req.body.active, req.body.isDefault, req.params.layoutId]);
      await syncLayoutButtons(db, req, result.rows[0]);
      if (req.body.isDefault === true) {
        await db("UPDATE platform_layouts SET is_default=false WHERE object_id=$1 AND page_type=$2 AND id<>$3 AND (company_id IS NULL OR company_id=$4)", [result.rows[0].object_id, result.rows[0].page_type, result.rows[0].id, req.user.companyId]);
      }
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A layout with this API key already exists for this object and page type. Choose a different layout name." });
      console.error("Platform layout update error:", error);
      res.status(500).json({ success: false, message: "Unable to update platform layout" });
    }
  });

  router.post("/platform/layouts/:layoutId/default", ...manage, async (req, res) => {
    const existing = await db("SELECT * FROM platform_layouts WHERE id=$1 AND (company_id IS NULL OR company_id=$2)", [req.params.layoutId, req.user.companyId]);
    if (!existing.rows.length || (existing.rows[0].company_id === null && !canManageGlobal(req))) return res.status(404).json({ success: false, message: "Layout not found or not editable" });
    if (!existing.rows[0].active) return res.status(400).json({ success: false, message: "Only active layouts can be the default" });
    const layout = existing.rows[0];
    try {
      await db("UPDATE platform_layouts SET is_default=false, updated_at=NOW() WHERE object_id=$1 AND page_type=$2 AND (company_id IS NULL OR company_id=$3)", [layout.object_id, layout.page_type, req.user.companyId]);
      const result = await db("UPDATE platform_layouts SET is_default=true,user_modified=true,updated_at=NOW() WHERE id=$1 RETURNING *", [req.params.layoutId]);
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      console.error("Platform layout default error:", error);
      res.status(500).json({ success: false, message: "Unable to set default platform layout" });
    }
  });

  router.delete("/platform/layouts/:layoutId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_layouts SET active=false,is_default=false,user_modified=true WHERE id=$1 AND (company_id=$2 OR (company_id IS NULL AND $3=true)) RETURNING *", [req.params.layoutId, req.user.companyId, canManageGlobal(req)]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Layout not found or not editable" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.post("/platform/layouts/:layoutId/activate", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_layouts SET active=true,user_modified=true,updated_at=NOW() WHERE id=$1 AND (company_id=$2 OR (company_id IS NULL AND $3=true)) RETURNING *", [req.params.layoutId, req.user.companyId, canManageGlobal(req)]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Layout not found or not editable" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/rules", ...manage, async (req, res) => {
    const result = await db("SELECT * FROM platform_rules WHERE (company_id IS NULL OR company_id=$1) ORDER BY name", [req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.get("/platform/function-registry", ...manage, async (req, res) => {
    res.json({
      success: true,
      data: getRegisteredFunctionsRegistry().map(({ handler, validation, ...definition }) => definition),
    });
  });

  router.get("/platform/workflow-actions", ...manage, async (req, res) => {
    res.json({
      success: true,
      data: getWorkflowActionRegistry().map(({ key, displayName, description, async: isAsync, requiredPermissions = [], requiredEntitlement = null }) => ({
        key,
        displayName,
        description,
        async: isAsync === true,
        requiredPermissions,
        requiredEntitlement,
      })),
    });
  });

  async function checkRule(req, rule) {
    if (typeof rule.name !== "string" || !rule.name.trim() || rule.name.length > 200 || typeof rule.trigger_key !== "string" || !rule.trigger_key.trim()
      || !Array.isArray(rule.conditions) || !rule.action || typeof rule.action !== "object" || Array.isArray(rule.action) || typeof rule.active !== "boolean") return "Invalid rule name, trigger, conditions, action or status";
    if (!["after_create", "after_update", "after_save", "before_save", "before_create", "before_update", "field_changed", "before_delete", "after_delete"].includes(rule.trigger_key)) return "Unsupported automation trigger";
    if (rule.object_id && !await getObject(rule.object_id, req)) return "Object not found";
    const conditionFields = rule.object_id ? await db("SELECT * FROM platform_fields WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label", [rule.object_id, req.user.companyId]) : { rows: [] };
    try {
      validateConditionConfig({ match: rule.action.match || "all", conditions: rule.conditions }, conditionFields.rows, "Automation conditions");
    } catch (error) {
      if (error instanceof ConditionError) return error.message;
      throw error;
    }
    const isWorkflow = rule.action.type === "workflow";
    const workflowMatch = isWorkflow ? rule.action.match || "all" : null;
    if (isWorkflow && !["all", "any"].includes(workflowMatch)) return "Workflow actions require a match mode of all or any";
    if (isWorkflow && (!Array.isArray(rule.action.actions) || !rule.action.actions.length)) return "Workflow actions require at least one action";
    const registryTypes = new Set(getWorkflowActionRegistry().map((definition) => definition.key));
    const legacyTypes = new Set(["validation", "set_field", "show_message", "SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP", "CALL_WEBHOOK", "HTTP_REQUEST", "workflow"]);
    const allowed = new Set([...registryTypes, ...legacyTypes]);
    const actions = isWorkflow ? rule.action.actions : (Array.isArray(rule.action.actions) ? rule.action.actions : [rule.action]);
    if (!actions.length || actions.some((action) => !action || !allowed.has(action.type || action.key))) return "Automation contains an unsupported action";
    for (const action of actions) {
      try {
        if (action.type === "workflow") {
          if (!Array.isArray(action.actions) || !action.actions.length) throw new Error("Workflow actions require at least one action");
          continue;
        }
        validateWorkflowAction(action);
      } catch (error) {
        return error.message;
      }
    }
    if (actions.some((action) => action.type === "set_field" && (typeof action.field !== "string" || action.value === undefined))) return "Each field update action requires a field and value";
    if (actions.some((action) => action.type === "show_message" && (!action.message || typeof action.message !== "string"))) return "Each message action requires a message";
    if (actions.some((action) => ["SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP"].includes(action.type) && (!action.templateId || !action.recipient))) return "Communication actions require a template and recipient";
    if (actions.some((action) => ["CALL_WEBHOOK", "HTTP_REQUEST"].includes(action.type) && (!action.connectorId || !action.endpoint))) return "Webhook actions require a connector and endpoint";
    if (rule.active) {
      for (const providerAction of actions.filter((action) => ["SEND_EMAIL", "SEND_SMS", "SEND_WHATSAPP"].includes(action.type))) {
        const configured = await hasConfiguredCommunicationProvider({ db, companyId: req.user.companyId, providerKind: providerAction.type.replace("SEND_", "") });
        if (!configured) return `${providerAction.type.replace("SEND_", "")} provider is not configured; configure the company integration before activating this workflow`;
      }
    }
    if (isWorkflow) {
      const fields = rule.object_id ? await db("SELECT * FROM platform_fields WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label", [rule.object_id, req.user.companyId]) : { rows: [] };
      for (const action of actions.filter((candidate) => candidate.type === "set_field")) {
        const field = fields.rows.find((candidate) => candidate.api_name === action.field);
        if (!field || field.active === false || field.writable === false || field.readable === false) return `Automation action field "${action.field}" is not writable`;
      }
      return null;
    }
    if (actions.some((action) => action.type === "validation")) {
      rule.action = { ...rule.action, type: "validation" };
    }
    if (actions.some((action) => action.type !== "validation")) {
      const fields = rule.object_id ? await db("SELECT * FROM platform_fields WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label", [rule.object_id, req.user.companyId]) : { rows: [] };
      for (const action of actions.filter((candidate) => candidate.type === "set_field")) {
        const field = fields.rows.find((candidate) => candidate.api_name === action.field);
        if (!field || field.active === false || field.writable === false || field.readable === false) return `Automation action field "${action.field}" is not writable`;
      }
    }
    if (!actions.some((action) => action.type === "validation")) return null;
    return validationRuleError(rule, conditionFields.rows);
  }

  router.post("/platform/rules", ...manage, async (req, res) => {
    try {
      const { objectId = null, objectKey = null, name, triggerKey, conditions = [], action = {}, active = false } = req.body || {};
      const resolvedObject = objectId || objectKey ? await getObject(objectId || objectKey, req) : null;
      if ((objectId || objectKey) && !resolvedObject) return res.status(400).json({ success: false, message: "Object not found" });
      const ruleError = await checkRule(req, { object_id: resolvedObject?.id || null, name, trigger_key: triggerKey, conditions, action, active });
      if (ruleError) return res.status(400).json({ success: false, message: ruleError });
      const result = await db("INSERT INTO platform_rules (object_id,name,trigger_key,conditions,action,active,company_id,created_by) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8) RETURNING *", [resolvedObject?.id || null, name.trim(), triggerKey, JSON.stringify(conditions), JSON.stringify(action), active, req.user.companyId, req.user.id]);
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (["22P02", "23503"].includes(error.code)) return res.status(400).json({ success: false, message: "Invalid rule reference" });
      console.error("Platform rule create error:", error);
      res.status(500).json({ success: false, message: "Unable to create rule" });
    }
  });

  router.put("/platform/rules/:ruleId", ...manage, async (req, res) => {
    try {
      const existing = await db("SELECT * FROM platform_rules WHERE id=$1 AND company_id=$2", [req.params.ruleId, req.user.companyId]);
      if (!existing.rows.length) return res.status(404).json({ success: false, message: "Rule not found or not editable" });
      const rule = existing.rows[0];
      const next = { ...rule };
      for (const [api, column] of Object.entries({ objectId: "object_id", name: "name", triggerKey: "trigger_key", conditions: "conditions", action: "action", active: "active" })) {
      if (req.body[api] !== undefined) next[column] = req.body[api];
      }
      if (req.body.objectId !== undefined || req.body.objectKey !== undefined) {
        const resolvedObject = req.body.objectId || req.body.objectKey
          ? await getObject(req.body.objectId || req.body.objectKey, req)
          : null;
        if ((req.body.objectId || req.body.objectKey) && !resolvedObject) {
          return res.status(400).json({ success: false, message: "Object not found" });
        }
        if (resolvedObject) next.object_id = resolvedObject.id;
      }
      // Deactivation must remain possible even after a referenced field is removed.
      const deactivateOnly = req.body.active === false && Object.keys(req.body).length === 1;
      const ruleError = deactivateOnly ? null : await checkRule(req, next);
      if (ruleError) return res.status(400).json({ success: false, message: ruleError });
      const result = await db("UPDATE platform_rules SET object_id=COALESCE($1,object_id),name=COALESCE($2,name),trigger_key=COALESCE($3,trigger_key),conditions=COALESCE($4::jsonb,conditions),action=COALESCE($5::jsonb,action),active=COALESCE($6,active),user_modified=true,updated_at=NOW() WHERE id=$7 RETURNING *", [req.body.objectId, req.body.name, req.body.triggerKey, req.body.conditions === undefined ? null : JSON.stringify(req.body.conditions), req.body.action === undefined ? null : JSON.stringify(req.body.action), req.body.active, rule.id]);
      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (["22P02", "23503"].includes(error.code)) return res.status(400).json({ success: false, message: "Invalid rule reference" });
      console.error("Platform rule update error:", error);
      res.status(500).json({ success: false, message: "Unable to update rule" });
    }
  });

  router.delete("/platform/rules/:ruleId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_rules SET active=false,user_modified=true WHERE id=$1 AND company_id=$2 RETURNING *", [req.params.ruleId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Rule not found or not editable" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.post("/platform/rules/:ruleId/clone", ...manage, async (req, res) => {
    try {
      const source = await db("SELECT * FROM platform_rules WHERE id=$1 AND company_id=$2", [req.params.ruleId, req.user.companyId]);
      if (!source.rows.length) return res.status(404).json({ success: false, message: "Rule not found" });
      const rule = source.rows[0];
      const name = typeof req.body?.name === "string" && req.body.name.trim()
        ? req.body.name.trim()
        : `${rule.name} (Copy)`;
      const result = await db(
        "INSERT INTO platform_rules (object_id,name,trigger_key,conditions,action,active,company_id,created_by) VALUES ($1,$2,$3,$4,$5,false,$6,$7) RETURNING *",
        [rule.object_id, name, rule.trigger_key, rule.conditions, rule.action, req.user.companyId, req.user.id]
      );
      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A workflow with this name already exists" });
      console.error("Platform rule clone error:", error);
      res.status(500).json({ success: false, message: "Unable to clone rule" });
    }
  });

  router.get("/platform/automation-logs", ...manage, async (req, res) => {
    const result = await db("SELECT * FROM platform_automation_logs WHERE company_id=$1 ORDER BY created_at DESC LIMIT 200", [req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });


  router.get("/platform/approval-processes/:processId", ...manage, async (req, res) => {
    const process = await db("SELECT p.*, o.object_key FROM platform_approval_processes p JOIN platform_objects o ON o.id=p.object_id WHERE p.id=$1 AND p.company_id=$2", [req.params.processId, req.user.companyId]);
    if (!process.rows.length) return res.status(404).json({ success: false, message: "Approval process not found" });
    const steps = await db("SELECT * FROM platform_approval_steps WHERE process_id=$1 ORDER BY step_order", [req.params.processId]);
    res.json({ success: true, data: { ...process.rows[0], steps: steps.rows } });
  });

  router.put("/platform/approval-processes/:processId", ...manage, async (req, res) => {
    const existing = await db("SELECT * FROM platform_approval_processes WHERE id=$1 AND company_id=$2", [req.params.processId, req.user.companyId]);
    if (!existing.rows.length) return res.status(404).json({ success: false, message: "Approval process not found" });
    const process = existing.rows[0];
    const next = req.body || {};
    if (next.name !== undefined && (!String(next.name).trim() || String(next.name).length > 200)) return res.status(400).json({ success: false, message: "A valid process name is required" });
    const processFields = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label", [process.object_id, req.user.companyId]);
    if (next.conditions !== undefined) {
      try { validateConditionConfig(next.conditions, processFields.rows, "Approval entry conditions"); }
      catch (error) { if (error instanceof ConditionError) return res.status(400).json({ success: false, message: error.message }); throw error; }
    }
    if (Array.isArray(next.steps) && (!next.steps.length || next.steps.some((step) => !step?.label?.trim() || !step.roleId))) {
      return res.status(400).json({ success: false, message: "At least one valid ordered approval step is required" });
    }
    const requestedLifecycle = next.lifecycleStatus ?? next.lifecycle_status ?? (next.active === true ? "ACTIVE" : next.active === false ? "INACTIVE" : undefined);
    if (requestedLifecycle !== undefined && !["DRAFT", "ACTIVE", "INACTIVE"].includes(String(requestedLifecycle).toUpperCase())) return res.status(400).json({ success: false, message: "lifecycleStatus must be DRAFT, ACTIVE or INACTIVE" });
    const lifecycleStatus = requestedLifecycle === undefined ? null : String(requestedLifecycle).toUpperCase();
    const activeValue = lifecycleStatus === null ? next.active : lifecycleStatus === "ACTIVE";
    const result = await db("UPDATE platform_approval_processes SET name=COALESCE($1,name),conditions=COALESCE($2::jsonb,conditions),active=COALESCE($3,active),lifecycle_status=COALESCE($4,lifecycle_status),updated_at=NOW() WHERE id=$5 RETURNING *", [next.name, next.conditions === undefined ? null : JSON.stringify(next.conditions), activeValue, lifecycleStatus, process.id]);
    if (Array.isArray(next.steps)) {
      await db("DELETE FROM platform_approval_steps WHERE process_id=$1", [process.id]);
      for (let index = 0; index < next.steps.length; index += 1) {
        const step = next.steps[index];
        const role = await db("SELECT id FROM roles WHERE id=$1 AND company_id=$2", [step.roleId, req.user.companyId]);
        if (!role.rows.length || !step.label?.trim()) return res.status(400).json({ success: false, message: "Each approval step requires a valid company role and label" });
        await db("INSERT INTO platform_approval_steps (process_id,step_order,label,role_id) VALUES ($1,$2,$3,$4)", [process.id, index + 1, step.label.trim(), step.roleId]);
      }
    }
    res.json({ success: true, data: result.rows[0] });
  });

  router.delete("/platform/approval-processes/:processId", ...manage, async (req, res) => {
    const result = await db("UPDATE platform_approval_processes SET active=false,lifecycle_status='INACTIVE',updated_at=NOW() WHERE id=$1 AND company_id=$2 RETURNING *", [req.params.processId, req.user.companyId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Approval process not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/approval-processes", ...manage, async (req, res) => {
    const result = await db(
      "SELECT p.*, o.object_key FROM platform_approval_processes p JOIN platform_objects o ON o.id=p.object_id WHERE p.company_id=$1 ORDER BY p.name",
      [req.user.companyId]
    );
    res.json({ success: true, data: result.rows });
  });

  router.post("/platform/approval-processes", ...manage, async (req, res) => {
    const { objectId, name, conditions = {}, steps = [], active = false } = req.body || {};
    const requestedLifecycle = String(req.body?.lifecycleStatus ?? req.body?.lifecycle_status ?? (active ? "ACTIVE" : "DRAFT")).toUpperCase();
    if (!["DRAFT", "ACTIVE", "INACTIVE"].includes(requestedLifecycle)) return res.status(400).json({ success: false, message: "lifecycleStatus must be DRAFT, ACTIVE or INACTIVE" });
    if (!objectId || typeof name !== "string" || !name.trim() || !Array.isArray(steps) || !steps.length) {
      return res.status(400).json({ success: false, message: "An object, process name and at least one approval step are required" });
    }
    const object = await getObject(objectId, req, { forMutation: true });
    if (!object) return res.status(404).json({ success: false, message: "Object not found or not editable" });
    try {
      const fields = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) ORDER BY display_order, label", [object.id, req.user.companyId]);
      validateConditionConfig(conditions, fields.rows, "Approval entry conditions");
      const process = await db(
        "INSERT INTO platform_approval_processes (object_id,company_id,name,conditions,active,lifecycle_status) VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *",
        [object.id, req.user.companyId, name.trim(), JSON.stringify(conditions), requestedLifecycle === "ACTIVE", requestedLifecycle]
      );
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        if (!step?.roleId || typeof step.label !== "string" || !step.label.trim()) return res.status(400).json({ success: false, message: "Each approval step requires a role and label" });
        const role = await db("SELECT id FROM roles WHERE id=$1 AND company_id=$2", [step.roleId, req.user.companyId]);
        if (!role.rows.length) return res.status(400).json({ success: false, message: "Approval step role is not available to this company" });
        await db("INSERT INTO platform_approval_steps (process_id,step_order,label,role_id) VALUES ($1,$2,$3,$4)", [process.rows[0].id, index + 1, step.label.trim(), step.roleId]);
      }
      res.status(201).json({ success: true, data: process.rows[0] });
    } catch (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "An approval process with this name already exists" });
      console.error("Platform approval process create error:", error);
      res.status(500).json({ success: false, message: "Unable to create approval process" });
    }
  });

  router.get("/platform/approval-requests", authenticate, async (req, res) => {
    const result = await db(
      "SELECT r.*, p.name AS process_name, s.label AS step_label FROM platform_approval_requests r JOIN platform_approval_processes p ON p.id=r.process_id JOIN platform_approval_steps s ON s.process_id=r.process_id AND s.step_order=r.current_step WHERE r.company_id=$1 AND ($2::text IS NULL OR r.status=$2) ORDER BY r.submitted_at DESC",
      [req.user.companyId, req.query.status || null]
    );
    res.json({ success: true, data: result.rows });
  });

  router.get("/platform/approval-requests/:requestId/history", authenticate, async (req, res) => {
    const result = await db("SELECT a.* FROM platform_approval_actions a JOIN platform_approval_requests r ON r.id=a.request_id WHERE a.request_id=$1 AND r.company_id=$2 ORDER BY a.created_at ASC", [req.params.requestId, req.user.companyId]);
    res.json({ success: true, data: result.rows });
  });

  router.post("/platform/approval-requests/:requestId/decision", authenticate, async (req, res) => {
    try {
      const result = await decidePlatformApproval({ db, requestId: req.params.requestId, decision: req.body?.decision, comment: req.body?.comment, req });
      res.status(result.status).json(result.status === 200 ? { success: true, data: result.data } : { success: false, message: result.message });
    } catch (error) {
      console.error("Platform approval decision error:", error);
      res.status(500).json({ success: false, message: "Unable to process approval decision" });
    }
  });

  router.get("/platform/modules", ...manage, async (req, res) => {
    const result = await db("SELECT * FROM platform_modules ORDER BY name");
    res.json({ success: true, data: result.rows });
  });

  router.get("/platform/modules/:moduleId", ...manage, async (req, res) => {
    const result = await db("SELECT * FROM platform_modules WHERE id=$1", [req.params.moduleId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Module not found" });
    const objects = await db("SELECT * FROM platform_objects WHERE module_id=$1 AND active=true ORDER BY label", [req.params.moduleId]);
    res.json({ success: true, data: { ...result.rows[0], objects: objects.rows } });
  });

  router.patch("/platform/modules/:moduleId", ...manage, async (req, res) => {
    if (!canManageGlobal(req)) return res.status(403).json({ success: false, message: "Only a Superadmin can activate or deactivate a platform module" });
    if (typeof req.body.installed !== "boolean") return res.status(400).json({ success: false, message: "installed must be a boolean" });
    const result = await db("UPDATE platform_modules SET installed=$1,updated_at=NOW() WHERE id=$2 RETURNING *", [req.body.installed, req.params.moduleId]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Module not found" });
    res.json({ success: true, data: result.rows[0] });
  });

  router.get("/platform/app-catalog", ...manage, async (req, res) => {
    const result = await db(
      `SELECT m.*, a.enabled AS company_enabled, a.store_id AS enabled_store_id
       FROM platform_modules m
       LEFT JOIN LATERAL (
         SELECT enabled, store_id
         FROM platform_module_access
         WHERE module_id=m.id AND company_id=$1
           AND (store_id IS NULL OR store_id=$2)
         ORDER BY (store_id IS NOT NULL) DESC
         LIMIT 1
       ) a ON TRUE
       ORDER BY m.name`,
      [req.user.companyId, req.user.storeId || null]
    );
    const byKey = new Map(internalAppCatalog.map((entry) => [entry.key, entry]));
    const data = result.rows.map((module) => {
      const definition = byKey.get(module.module_key) || module.metadata || {};
      return {
        ...definition,
        ...module,
        permissions: definition.permissions || [],
        enabled: module.company_enabled ?? module.installed === true,
        company_enabled: module.company_enabled ?? null,
      };
    });
    res.json({ success: true, data });
  });

  router.patch("/platform/app-catalog/:moduleKey", authenticate, authorize("module.access.manage", "settings.manage"), async (req, res) => {
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({ success: false, message: "enabled must be a boolean" });
    }
    const moduleResult = await db(
      "SELECT id FROM platform_modules WHERE module_key=$1",
      [req.params.moduleKey]
    );
    if (!moduleResult.rows.length) return res.status(404).json({ success: false, message: "Application not found" });
    const storeId = req.body.storeId || null;
    if (storeId) {
      const store = await db("SELECT id FROM stores WHERE id=$1 AND company_id=$2 AND active=true", [storeId, req.user.companyId]);
      if (!store.rows.length) return res.status(400).json({ success: false, message: "Store is not available to this company" });
    }
    const existing = await db(
      "UPDATE platform_module_access SET enabled=$1,updated_at=NOW() WHERE module_id=$2 AND company_id=$3 AND store_id IS NOT DISTINCT FROM $4 RETURNING *",
      [req.body.enabled, moduleResult.rows[0].id, req.user.companyId, storeId]
    );
    const result = existing.rows.length ? existing : await db(
      `INSERT INTO platform_module_access (module_id, company_id, store_id, enabled)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [moduleResult.rows[0].id, req.user.companyId, storeId, req.body.enabled]
    );
    res.json({ success: true, data: result.rows[0] });
  });

  /*
   * METADATA-DRIVEN OBJECT NAVIGATION (services/platformObjectNavigation.js).
   *
   * ONE bounded payload for the whole menu: the configured pages, the objects
   * they reference, the modules those objects depend on and the caller's object
   * permissions. No fields, layouts, formulas, workflows or records — object
   * metadata loads only when an object page is opened. Every query is scoped to
   * the caller's company; access decisions live in the shared pure service.
   */
  async function loadObjectNavigation(req, { isSuperadmin, permissions, entitlements }) {
    const pagesResult = await db(
      `SELECT p.id, p.app_id, p.company_id, p.page_key, p.label, p.page_type, p.definition, p.active,
              a.app_key, a.label AS app_label, a.active AS app_active, a.company_id AS app_company_id
         FROM platform_pages p
         JOIN platform_apps a ON a.id = p.app_id
        WHERE p.company_id = $1 AND a.company_id = $1 AND p.active = true AND a.active = true`,
      [req.user.companyId]
    );
    const pages = pagesResult.rows || [];
    if (!pages.length) return { entries: [], excluded: [] };

    const apps = [...new Map(pages.map((page) => [String(page.app_id), {
      id: page.app_id,
      app_key: page.app_key,
      label: page.app_label,
      active: page.app_active,
      company_id: page.app_company_id,
    }])).values()];

    const definitions = pages.map((page) => normalizeObjectPageDefinition(page.definition));
    const objectKeys = [...new Set(definitions.map((definition) => definition.objectKey).filter(Boolean))];

    const objects = objectKeys.length
      ? (await db(
        "SELECT id, object_key, label, active, company_id, module_id FROM platform_objects WHERE object_key = ANY($1::text[]) AND (company_id IS NULL OR company_id = $2)",
        [objectKeys, req.user.companyId]
      )).rows || []
      : [];

    const moduleKeys = [...new Set(definitions.map((definition) => definition.moduleKey).filter(Boolean))];
    const moduleIds = [...new Set(objects.map((object) => object.module_id).filter(Boolean))];

    const modules = (moduleKeys.length || moduleIds.length)
      ? (await db(
        `SELECT m.id, m.module_key, access.enabled AS company_enabled,
                p.package_key, p.manifest AS package_manifest, installation.status AS package_status
           FROM platform_modules m
           JOIN package_registry p ON p.module_id = m.id AND p.active = true
           LEFT JOIN company_package_installations installation
             ON installation.package_id = p.id AND installation.company_id = $1
           LEFT JOIN LATERAL (
             SELECT enabled FROM platform_module_access
              WHERE module_id = m.id AND company_id = $1 AND (store_id IS NULL OR store_id = $4)
              ORDER BY (store_id IS NOT NULL) DESC LIMIT 1
           ) access ON TRUE
          WHERE m.installed = true AND (m.id = ANY($2::uuid[]) OR m.module_key = ANY($3::text[]))`,
        [req.user.companyId, moduleIds, moduleKeys, req.user.storeId || null]
      )).rows || []
      : [];

    const objectIds = objects.map((object) => object.id);
    const objectPermissions = (!isSuperadmin && objectIds.length)
      ? (await db(
        "SELECT object_id, can_view FROM platform_object_permissions WHERE role_id=$1 AND company_id=$2 AND object_id = ANY($3::uuid[])",
        [req.user.roleId || null, req.user.companyId, objectIds]
      )).rows || []
      : [];

    /* The device/app profile only matters when a page declares one, so the POS
       startup path never pays for the lookup. */
    const needsProfile = definitions.some((definition) => (definition.profiles || []).length > 0);
    let deviceProfile;
    if (needsProfile) {
      const terminal = await db(
        "SELECT app_profile FROM terminals WHERE store_id=$1 AND active=true ORDER BY created_at LIMIT 1",
        [req.user.storeId || null]
      );
      deviceProfile = normalizeDeviceProfile(terminal.rows?.[0]?.app_profile);
    }

    return objectNavigationEntries({
      pages,
      apps,
      objects,
      modules,
      objectPermissions,
      entitlements,
      permissions,
      isSuperadmin,
      deviceProfile,
      companyId: req.user.companyId,
    });
  }

  router.get("/platform/runtime/app-catalog", authenticate, async (req, res) => {
    const [userResult, permissionResult, moduleResult, entitlementResult] = await Promise.all([
      db("SELECT is_superadmin FROM users WHERE id=$1 AND active=true", [req.user.id]),
      db(
        `SELECT p.code
         FROM role_permissions rp
         JOIN permissions p ON p.id=rp.permission_id
         WHERE rp.role_id=$1`,
        [req.user.roleId]
      ),
      db(
        `SELECT m.*, access.enabled AS company_enabled
                , p.package_key, p.manifest AS package_manifest
                , installation.status AS package_status
         FROM platform_modules m
         JOIN package_registry p ON p.module_id=m.id AND p.active=true
         LEFT JOIN company_package_installations installation
           ON installation.package_id=p.id AND installation.company_id=$1
         LEFT JOIN LATERAL (
           SELECT enabled
           FROM platform_module_access
           WHERE module_id=m.id AND company_id=$1
             AND (store_id IS NULL OR store_id=$2)
           ORDER BY (store_id IS NOT NULL) DESC
           LIMIT 1
         ) access ON TRUE
         WHERE m.installed=true
         ORDER BY m.name`,
        [req.user.companyId, req.user.storeId || null]
      ),
      getCompanyEntitlements(db, req.user.companyId),
    ]);
    const isSuperadmin = userResult.rows[0]?.is_superadmin === true;
    const permissions = permissionResult.rows.map((row) => row.code);
    const byKey = new Map(internalAppCatalog.map((entry) => [entry.key, entry]));
    /*
     * Visibility is decided by the SHARED rule (services/authorization.js) so
     * the runtime catalogue, the navigation filter and the route guards cannot
     * disagree about Platform Superadmin. See moduleRuntimeAccess() for why the
     * company enablement gate still applies to a Superadmin while the
     * entitlement gates do not.
     */
    const data = moduleResult.rows
      .map((module) => ({ ...byKey.get(module.module_key), ...module }))
      .filter((module) => {
        const definition = byKey.get(module.module_key);
        return moduleRuntimeAccess({
          enabledByCompany: module.company_enabled ?? true,
          packageInstalled: module.package_status === "active",
          licensed: isPackageLicensed(entitlementResult, { manifest: module.package_manifest || {} }),
          permitted: isSuperadmin || Boolean(definition?.permissions?.some((code) => permissions.includes(code))),
          isSuperadmin,
        }).allowed;
      });
    /* The configured Object navigation rides in the SAME payload as the module
       catalogue, so the menu is discovered with one bounded request. */
    const navigation = await loadObjectNavigation(req, { isSuperadmin, permissions, entitlements: entitlementResult });
    res.json({ success: true, data, objectPages: navigation.entries });
  });

  async function getRecordMetadata(objectKey, req) {
    const objectResult = await db(
      "SELECT * FROM platform_objects WHERE object_key=$1 AND (company_id IS NULL OR company_id=$2)",
      [objectKey, req.user.companyId]
    );
    const object = objectResult.rows[0];
    if (!object) return { object: null, fields: [] };
    if (systemObject(object)) object.company_scoped = true;
    const fieldsResult = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND (company_id IS NULL OR company_id=$2) ORDER BY active DESC, display_order, label", [object.id, req.user.companyId]);
    return { object, fields: await enrichFields(db, safeSystemFields(object, fieldsResult.rows), req) };
  }

  async function hasExecutionPermission(req, permission) {
    if (req.user?.isSuperadmin === true) return true;
    const result = await db(
      `SELECT 1
       FROM role_permissions rp
       JOIN permissions p ON p.id=rp.permission_id
       WHERE rp.role_id=$1 AND p.code=$2
       LIMIT 1`,
      [req.user?.roleId, permission]
    );
    return result.rows.length > 0;
  }

  router.post("/platform/objects/:objectKey/records/:recordId/buttons/:buttonKey/execute", authenticate, async (req, res, next) => {
    try {
      if (!recordIdIsValid(req.params.recordId)) return res.status(400).json({ success: false, message: "Invalid record identifier" });
      const { object } = await getRecordMetadata(req.params.objectKey, req);
      if (!object || !object.source_table || !isSafeIdentifier(object.source_table)) return res.status(404).json({ success: false, message: "Object records are not available" });
      const buttonResult = await db(
        `SELECT * FROM platform_buttons WHERE object_id=$1 AND button_key=$2 AND active=true AND (company_id IS NULL OR company_id=$3) LIMIT 1`,
        [object.id, req.params.buttonKey, req.user.companyId]
      );
      const button = buttonResult.rows[0];
      if (!button) return res.status(404).json({ success: false, message: "Registered button not found" });
      if (button.required_permission && !(await hasExecutionPermission(req, button.required_permission))) {
        return res.status(403).json({ success: false, message: "You do not have permission to execute this button" });
      }
      const recordClauses = ["id=$1"], recordParams = [req.params.recordId];
      if (object.company_scoped) { recordParams.push(req.user.companyId); recordClauses.push(`company_id=$${recordParams.length}`); }
      if (object.store_scoped) {
        if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
        recordParams.push(req.user.storeId); recordClauses.push(`store_id=$${recordParams.length}`);
      }
      appendSystemReadScope(object, req, recordClauses, recordParams);
      const recordResult = await db(`SELECT * FROM "${object.source_table}" WHERE ${recordClauses.join(" AND ")}`, recordParams);
      if (!recordResult.rows.length) return res.status(404).json({ success: false, message: "Record not found" });
      const record = recordResult.rows[0];

      if (button.target_type === "workflow") {
        const workflowResult = await db(
          `SELECT * FROM platform_rules WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) AND (id::text=$3 OR name=$3) LIMIT 1`,
          [object.id, req.user.companyId, button.target_key]
        );
        const workflow = workflowResult.rows[0];
        if (!workflow) return res.status(404).json({ success: false, message: "Configured workflow not found" });
        const actions = Array.isArray(workflow.action?.actions) ? workflow.action.actions : [];
        if (!actions.length) return res.status(422).json({ success: false, message: "Configured workflow contains no executable actions" });
        const results = await executeWorkflowActions({ actions, db, req, object, record, recordId: req.params.recordId, companyId: req.user.companyId, trigger: "record_page_button" });
        return res.json({ success: true, data: { results } });
      }

      const target = await resolveButtonTarget(req, {
        targetType: "action",
        targetKey: button.target_key || button.action_key,
      }, object.id);
      if (target.error) return res.status(422).json({ success: false, message: target.error });
      const handlerKey = target.handlerKey;
      if (["RECORD_SAVE", "RECORD_DELETE"].includes(handlerKey)) {
        return res.status(409).json({ success: false, message: `${handlerKey} is handled by the canonical record page lifecycle` });
      }
      const definition = getWorkflowActionDefinition(handlerKey);
      if (!definition) return res.status(422).json({ success: false, message: "Registered action handler is unavailable" });
      for (const permission of definition.requiredPermissions || []) {
        if (!(await hasExecutionPermission(req, permission))) return res.status(403).json({ success: false, message: `You do not have permission to execute ${handlerKey}` });
      }
      const result = await executeWorkflowAction({
        db, req, object, record, recordId: req.params.recordId, companyId: req.user.companyId,
        action: { type: handlerKey, ...(target.action?.config || {}), inputs: { ...(button.input_mappings || {}), ...(req.body?.inputs || {}) } },
      });
      return res.json({ success: true, data: result });
    } catch (error) { next(error); }
  });

  router.post("/platform/objects/:objectKey/records/:recordId/actions/:actionKey/execute", authenticate, async (req, res, next) => {
    try {
      if (!recordIdIsValid(req.params.recordId)) return res.status(400).json({ success: false, message: "Invalid record identifier" });

      const { object } = await getRecordMetadata(req.params.objectKey, req);
      if (!object || !object.source_table || !isSafeIdentifier(object.source_table)) {
        return res.status(404).json({ success: false, message: "Object records are not available" });
      }

      const layoutResult = await db(
        `SELECT l.definition
         FROM platform_layouts l
         WHERE l.object_id=$1 AND l.page_type='detail' AND l.active=true
           AND (l.company_id IS NULL OR l.company_id=$2)
         AND (l.role_id IS NULL OR l.role_id=$3)`,
        [object.id, req.user.companyId, req.user.roleId || null]
      );
      const selectedLayout = resolvePageLayout(layoutResult.rows);
      const components = normalizePageDefinition(selectedLayout?.definition).components;
      const component = components.find((candidate, index) =>
        candidate?.type === "action" &&
        candidate?.visible !== false &&
        configuredActionKey(candidate, index) === req.params.actionKey
      );
      if (!component) return res.status(404).json({ success: false, message: "Configured record action not found" });

      const action = String(component.action || "").toLowerCase();
      const permission = action === "run_workflow" ? "workflow.execute" : action === "call_function" ? "functions.execute" : null;
      if (!permission) return res.status(400).json({ success: false, message: "This record action is not executable" });
      if (!(await hasExecutionPermission(req, permission))) return res.status(403).json({ success: false, message: "You do not have permission to execute this action" });

      const recordClauses = ["id=$1"];
      const recordParams = [req.params.recordId];
      if (object.company_scoped) {
        recordParams.push(req.user.companyId);
        recordClauses.push(`company_id=$${recordParams.length}`);
      }
      if (object.store_scoped) {
        if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
        recordParams.push(req.user.storeId);
        recordClauses.push(`store_id=$${recordParams.length}`);
      }
      appendSystemReadScope(object, req, recordClauses, recordParams);
      const recordResult = await db(
        `SELECT * FROM "${object.source_table}" WHERE ${recordClauses.join(" AND ")}`,
        recordParams
      );
      if (!recordResult.rows.length) return res.status(404).json({ success: false, message: "Record not found" });
      const record = recordResult.rows[0];

      if (action === "call_function") {
        const functionKey = component.functionKey || component.function_key;
        const definition = getRegisteredFunction(functionKey);
        if (!definition) return res.status(422).json({ success: false, message: "Configured registered function is unavailable" });
        const result = await executeWorkflowAction({
          db,
          req,
          object,
          record,
          recordId: req.params.recordId,
          companyId: req.user.companyId,
          action: { type: "CALL_FUNCTION", functionKey, inputs: component.inputs || {} },
        });
        return res.json({ success: true, data: result });
      }

      const workflowId = component.workflowId || component.workflow_id || component.ruleId || component.rule_id;
      if (!workflowId) return res.status(422).json({ success: false, message: "Configured workflow is missing" });
      const workflowResult = await db(
        `SELECT * FROM platform_rules
         WHERE id=$1 AND active=true AND object_id=$2
           AND (company_id IS NULL OR company_id=$3)
         LIMIT 1`,
        [workflowId, object.id, req.user.companyId]
      );
      const workflow = workflowResult.rows[0];
      if (!workflow) return res.status(404).json({ success: false, message: "Configured workflow not found" });
      const actions = Array.isArray(workflow.action?.actions) ? workflow.action.actions : [];
      if (!actions.length) return res.status(422).json({ success: false, message: "Configured workflow contains no executable actions" });
      for (const workflowAction of actions) {
        validateWorkflowAction(workflowAction);
        const definition = getWorkflowActionDefinition(workflowAction.type || workflowAction.key);
        for (const requiredPermission of definition?.requiredPermissions || []) {
          if (!(await hasExecutionPermission(req, requiredPermission))) {
            return res.status(403).json({ success: false, message: `You do not have permission to execute ${workflowAction.type || workflowAction.key}` });
          }
        }
      }

      const run = await createWorkflowRun({
        db,
        companyId: req.user.companyId,
        workflowId: workflow.id,
        workflowName: workflow.name,
        objectId: object.id,
        recordId: req.params.recordId,
        triggerKey: "record_page_action",
        status: "RUNNING",
        metadata: { actionKey: req.params.actionKey, actorUserId: req.user.id || null },
      });
      try {
        const results = await executeWorkflowActions({
          actions,
          db,
          req,
          object,
          record,
          recordId: req.params.recordId,
          companyId: req.user.companyId,
          runId: run?.id || null,
          trigger: "record_page_action",
        });
        if (run?.id) {
          await db(
            "UPDATE platform_workflow_runs SET status=$1, completed_at=NOW(), updated_at=NOW() WHERE id=$2 AND company_id=$3",
            ["COMPLETED", run.id, req.user.companyId]
          );
        }
        return res.json({ success: true, data: { runId: run?.id || null, results } });
      } catch (error) {
        if (run?.id) {
          await db(
            "UPDATE platform_workflow_runs SET status=$1, completed_at=NOW(), updated_at=NOW(), metadata=COALESCE(metadata,'{}'::jsonb) || $2::jsonb WHERE id=$3 AND company_id=$4",
            ["FAILED", JSON.stringify({ error: error.message || "Workflow execution failed" }), run.id, req.user.companyId]
          );
        }
        throw error;
      }
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      next(error);
    }
  });

  async function resolveImportLookupMatches(targetObject, targetFields, rawValue, req) {
    const value = typeof rawValue === "string" ? rawValue.trim() : rawValue;
    if (value === null || value === undefined || value === "") return { matches: [], ambiguous: false, reason: null };
    const safeText = String(value);
    if (recordIdIsValid(safeText)) {
      const scope = ["id=$1"];
      const params = [safeText];
      if (targetObject.company_scoped) { params.push(req.user.companyId); scope.push(`company_id=$${params.length}`); }
      if (targetObject.store_scoped) { if (!req.user.storeId) throw Object.assign(new Error("A store session is required"), { status: 403 }); params.push(req.user.storeId); scope.push(`store_id=$${params.length}`); }
      const result = await db(`SELECT id FROM "${targetObject.source_table}" WHERE ${scope.join(" AND ")}`, params);
      return { matches: result.rows.map((row) => String(row.id)), ambiguous: false, reason: null };
    }
    const candidates = (targetFields || []).filter((field) => {
      if (!field || field.active === false || field.field_type === "formula" || field.field_type === "rollup") return false;
      const config = field.config && typeof field.config === "object" ? field.config : {};
      const api = String(field.api_name || "").toLowerCase();
      const isUnique = field.unique === true || config.unique === true || config.businessKey === true || config.business_key === true || config.uniqueBusinessKey === true || config.unique_business_key === true || config.externalId === true || config.external_id === true;
      return isUnique || /(?:sku|barcode|code|external|serial|reference|number|identifier)$/.test(api) || /(?:sku|barcode|code|external|serial|reference|number|identifier)/.test(String(field.label || "").toLowerCase());
    });
    const matches = [];
    for (const field of candidates) {
      const normalized = normalizeFieldValue(field, safeText);
      if (normalized === null || normalized === "") continue;
      const scope = [`${metadataColumn(field)}=$1`];
      const params = [normalized];
      if (targetObject.company_scoped) { params.push(req.user.companyId); scope.push(`company_id=$${params.length}`); }
      if (targetObject.store_scoped) { if (!req.user.storeId) throw Object.assign(new Error("A store session is required"), { status: 403 }); params.push(req.user.storeId); scope.push(`store_id=$${params.length}`); }
      const result = await db(`SELECT id FROM "${targetObject.source_table}" WHERE ${scope.join(" AND ")}`, params);
      for (const row of result.rows) matches.push(String(row.id));
    }
    const unique = [...new Set(matches)];
    return { matches: unique, ambiguous: unique.length > 1, reason: unique.length > 1 ? "ambiguous" : null };
  }

  async function validateLookupReference(field, value, req) {
    if (field.field_type !== "lookup" || !field.config || typeof field.config !== "object") return null;
    const targetKey = field.config.relatedObjectKey || field.config.related_object_key || field.config.objectKey;
    let targetObject = null;
    let targetFields = [];
    if (targetKey) {
      const targetResult = await db("SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [targetKey, req.user.companyId]);
      targetObject = targetResult.rows[0];
      if (targetObject) {
        const metadata = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order", [targetObject.id, req.user.companyId]);
        targetFields = await enrichFields(db, safeSystemFields(targetObject, metadata.rows), req);
      }
    }
    if (!targetObject || !targetObject.source_table || !isSafeIdentifier(targetObject.source_table)) {
      return `${field.label} references an unavailable object`;
    }
    if (value === null || value === undefined || value === "") return null;
    const matchResult = await resolveImportLookupMatches(targetObject, targetFields, value, req);
    if (!matchResult.matches.length) return `${field.label} references a record that does not exist`;
    if (matchResult.ambiguous) return `${field.label} match is ambiguous; multiple records satisfy the configured relationship key`;
    return null;
  }

  async function validateLookupConfiguration(objectId, fieldType, config, req) {
    if (fieldType !== "lookup") return;
    const relationshipKey = config?.relationshipKey;
    if (!relationshipKey) throw new ConditionError("Lookup fields must select a relationship");
    const relationship = await db(
      "SELECT r.*, p.object_key AS parent_object_key, c.object_key AS child_object_key FROM platform_relationships r JOIN platform_objects p ON p.id=r.parent_object_id JOIN platform_objects c ON c.id=r.child_object_id WHERE r.relationship_key=$1 AND r.active=true AND ((r.parent_object_id=$2) OR (r.child_object_id=$2)) AND (p.company_id IS NULL OR p.company_id=$3) AND (c.company_id IS NULL OR c.company_id=$3)",
      [relationshipKey, objectId, req.user.companyId]
    );
    if (!relationship.rows[0]) throw new ConditionError("Lookup relationship is not available for this object");
    const current = relationship.rows[0];
    const targetObjectKey = String(current.parent_object_id) === String(objectId)
      ? current.child_object_key
      : current.parent_object_key;
    if (config.relatedObjectKey && config.relatedObjectKey !== targetObjectKey) {
      throw new ConditionError("Lookup target does not match the selected relationship");
    }
  }

  async function resolveRecordType(object, recordTypeId, req) {
    if (!recordTypeId) return null;
    const result = await db("SELECT * FROM platform_record_types WHERE id=$1 AND object_id=$2 AND company_id=$3 AND active=true", [recordTypeId, object.id, req.user.companyId]);
    return result.rows[0] || null;
  }

  async function validateRecordTypeRestrictions(object, restrictions, req) {
    if (!restrictions || typeof restrictions !== "object" || Array.isArray(restrictions)) {
      throw new ConditionError("Picklist restrictions must be an object");
    }

    async function validateRecordTypeDefaults(object, defaults, req) {
      if (defaults === undefined || defaults === null) return;
      if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
        throw new ConditionError("Record type default values must be an object");
      }
      const names = Object.keys(defaults);
      if (names.some((name) => !isSafeIdentifier(name))) throw new ConditionError("Record type defaults must use field API names");
      if (!names.length) return;
      const fields = await db(
        "SELECT api_name,field_type,active,readable,writable FROM platform_fields WHERE object_id=$1 AND api_name=ANY($2::text[]) AND active=true AND (company_id IS NULL OR company_id=$3)",
        [object.id, names, req.user.companyId]
      );
      const available = new Map(fields.rows.map((field) => [field.api_name, field]));
      for (const name of names) {
        const field = available.get(name);
        if (!field || field.writable === false || ["formula", "rollup"].includes(field.field_type)) {
          throw new ConditionError(`Record type default field "${name}" is not writable on this object`);
        }
      }
    }

    const fieldIds = Object.keys(restrictions);
    if (!fieldIds.length) return;
    if (fieldIds.some((fieldId) => !recordIdIsValid(fieldId))) {
      throw new ConditionError("Record type restrictions must reference valid field identifiers");
    }

    const fields = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND id=ANY($2::uuid[]) AND active=true AND (company_id IS NULL OR company_id=$3)", [object.id, fieldIds, req.user.companyId]);
    const fieldsById = new Map(fields.rows.map((field) => [String(field.id), field]));

    for (const [fieldId, values] of Object.entries(restrictions)) {
      const field = fieldsById.get(String(fieldId));
      if (!field || !["select", "picklist"].includes(field.field_type)) {
        throw new ConditionError("Record type restrictions must reference active picklist fields on this object");
      }
      if (!Array.isArray(values) || values.length === 0) {
        throw new ConditionError("Each record type picklist restriction must contain at least one value");
      }

      const options = await valueSetOptions(db, field, req);
      const activeValues = new Set(options.filter((option) => option.active !== false).map((option) => String(option.value)));
      for (const value of values) {
        const normalized = String(value);
        if (!isSafeIdentifier(normalized) || !activeValues.has(normalized)) {
          throw new ConditionError("Record type restrictions must use active configured picklist values");
        }
      }
    }
  }

  async function validateRecordTypeValues(object, fields, recordType, input, req) {
    if (!recordType) return null;
    const restrictions = await db("SELECT field_id,value FROM platform_record_type_picklist_values WHERE record_type_id=$1 AND active=true", [recordType.id]);
    const byField = new Map();
    for (const row of restrictions.rows) {
      if (!byField.has(row.field_id)) byField.set(row.field_id, new Set());
      byField.get(row.field_id).add(row.value);
    }
    for (const field of fields) {
      const allowed = byField.get(field.id);
      if (!allowed || input[field.api_name] === undefined || input[field.api_name] === null || input[field.api_name] === "") continue;
      if (!allowed.has(String(input[field.api_name]))) return `${field.label} is not available for record type ${recordType.label}`;
    }
    return null;
  }

  async function associateRecordType(object, recordId, recordType, req) {
    if (!recordType) {
      await db("DELETE FROM platform_record_associations WHERE object_id=$1 AND record_id=$2 AND company_id=$3", [object.id, recordId, req.user.companyId]);
      return;
    }
    await db("INSERT INTO platform_record_associations (object_id,record_id,record_type_id,company_id) VALUES ($1,$2,$3,$4) ON CONFLICT (object_id,record_id) DO UPDATE SET record_type_id=EXCLUDED.record_type_id,updated_at=NOW()", [object.id, recordId, recordType.id, req.user.companyId]);
  }

  async function loadRecordTypeAssociations(object, recordIds, req) {
    if (!recordIds.length) return { rows: [] };
    try {
      return await db(
        "SELECT record_id,record_type_id FROM platform_record_associations WHERE object_id=$1 AND company_id=$2 AND record_id=ANY($3::uuid[])",
        [object.id, req.user.companyId, recordIds]
      );
    } catch (error) {
      if (error.code) throw error;
      console.warn("Platform record type associations are unavailable; returning records without type metadata.");
      return { rows: [] };
    }
  }

  async function writeRecordHistory(object, recordId, fields, oldRecord, newRecord, action, req) {
    const changes = fields.filter((field) => field.api_name && (
      action !== "update" ||
      JSON.stringify(oldRecord?.[field.api_name] ?? null) !== JSON.stringify(newRecord?.[field.api_name] ?? null)
    ));
    try {
      for (const field of changes) {
        await db(
          "INSERT INTO platform_record_history (company_id,object_id,object_key,record_id,field_api_name,old_value,new_value,action,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)",
          [
            req.user.companyId,
            object.id,
            object.object_key,
            recordId,
            field.api_name,
            JSON.stringify(action === "create" ? null : oldRecord?.[field.api_name] ?? null),
            JSON.stringify(action === "delete" ? null : newRecord?.[field.api_name] ?? null),
            action,
            req.user.id || null,
          ]
        );
      }
    } catch (error) {
      console.error("Platform record history write error:", error);
    }
  }

  async function validateRecordInput(req, object, fields, input, { requireRequired = false } = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "Record data must be an object" };
    const activeFields = fields.filter((field) => field.active === true);
    const activeByName = new Map(activeFields.map((field) => [field.api_name, field]));
    const allByName = new Map(fields.map((field) => [field.api_name, field]));
    const values = [];
    for (const [apiName, value] of Object.entries(input)) {
      const field = activeByName.get(apiName);
      if (!field) {
        if (allByName.has(apiName)) return { error: `Field "${apiName}" is inactive` };
        return { error: `Unknown field "${apiName}"` };
      }
      if (field.field_type === "formula" || field.field_type === "rollup") return { error: `Calculated field "${apiName}" is read-only` };
      if (field.writable === false || field.writeable === false || field.protected === true || field.system === true || field.is_protected === true || field.read_only === true || field.readOnly === true) {
        return { error: `Field "${apiName}" is protected or read-only` };
      }
      const column = metadataColumn(field);
      if (!column) return { error: `Field "${apiName}" is unmapped` };
      if (["id", "company_id", "store_id"].includes(column) || ["company_id", "store_id"].includes(String(field.source_column || ""))) return { error: `Field "${apiName}" is managed by the server` };
      const valueError = fieldValueError(field, value);
      if (valueError) return { error: valueError };
      if (["select", "picklist"].includes(field.field_type)) {
        const options = await valueSetOptions(db, field, req);
        const valid = options.some((option) => option.active !== false && option.value === String(value));
        if (!valid) return { error: `${field.label} must be one of the active configured options` };
      }
      const lookupError = await validateLookupReference(field, value, req);
      if (lookupError) return { error: lookupError };
      values.push({ field, column, value: normalizeFieldValue(field, value) });
    }
    if (requireRequired) {
      for (const field of activeFields.filter((candidate) => candidate.required && candidate.field_type !== "formula" && candidate.field_type !== "rollup")) {
        if (!Object.prototype.hasOwnProperty.call(input, field.api_name) || input[field.api_name] === null || input[field.api_name] === "") {
          return { error: `${field.label} is required` };
        }
      }
    }
    if (!values.length) return { error: "At least one mapped field is required" };
    return { values };
  }

  function normalizeRequestedOperation(operation) {
    const value = String(operation ?? "auto").trim().toLowerCase();
    if (["create", "update", "upsert", "auto"].includes(value)) return value;
    return "auto";
  }

  function resolveImportAction(operation, existingId) {
    const requested = normalizeRequestedOperation(operation);
    const hasExistingId = !!existingId && recordIdIsValid(String(existingId));
    if (requested === "create") return "create";
    if (requested === "update") return hasExistingId ? "update" : "error";
    if (requested === "upsert") return hasExistingId ? "update" : "create";
    if (requested === "auto") return hasExistingId ? "update" : "create";
    return "create";
  }

  function getImportKeyCandidates(fields, input = {}) {
    const candidates = [];
    for (const field of fields) {
      if (!field || !field.active || !field.api_name || !metadataColumn(field)) continue;
      const config = field.config && typeof field.config === "object" ? field.config : {};
      const isUnique = field.unique === true || config.unique === true || config.businessKey === true || config.business_key === true || config.uniqueBusinessKey === true || config.unique_business_key === true || config.externalId === true || config.external_id === true;
      if (!isUnique && !/(?:sku|barcode|code|external|serial|reference|number|identifier)$/.test(String(field.api_name).toLowerCase()) && !/(?:sku|barcode|code|external|serial|reference|number|identifier)/.test(String(field.label || "").toLowerCase())) continue;
      if (input[field.api_name] === undefined || input[field.api_name] === null || String(input[field.api_name]).trim() === "") continue;
      const normalized = normalizeFieldValue(field, input[field.api_name]);
      if (normalized === null || normalized === "") continue;
      candidates.push({ field, value: normalized });
    }
    return candidates;
  }

  function getImportUniqueFields(fields) {
    const byName = new Map();
    for (const field of fields) {
      if (!field || !field.active || !field.api_name || !metadataColumn(field)) continue;
      const config = field.config && typeof field.config === "object" ? field.config : {};
      const isUnique = field.unique === true || config.unique === true || config.businessKey === true || config.business_key === true || config.uniqueBusinessKey === true || config.unique_business_key === true || config.externalId === true || config.external_id === true;
      const api = String(field.api_name).toLowerCase();
      if (isUnique || /(?:sku|barcode|code|external|serial|reference|number|identifier)$/.test(api) || /(?:sku|barcode|code|external|serial|reference|number|identifier)/.test(String(field.label || "").toLowerCase())) {
        byName.set(api, field);
      }
    }
    return [...byName.values()];
  }

  function summarizeImportPreview(rows, preview) {
    const summary = {
      total: rows.length,
      valid: 0,
      warnings: 0,
      errors: 0,
      create: 0,
      update: 0,
      skipped: 0,
      failed: 0,
      new: 0,
      skip: 0,
      error: 0,
    };
    for (const item of preview || []) {
      if (item.status === "warning") summary.warnings += 1;
      if (item.status === "valid") summary.valid += 1;
      if (item.status === "error") summary.errors += 1;
      if (item.action === "create") summary.create += 1;
      if (item.action === "update") summary.update += 1;
    }
    summary.skipped = summary.errors;
    summary.failed = summary.errors;
    summary.new = summary.create;
    summary.skip = summary.skipped;
    summary.error = summary.errors;
    return summary;
  }

  function findImportUniqueValues(fields, input = {}) {
    const values = [];
    for (const field of getImportUniqueFields(fields)) {
      const raw = input?.[field.api_name];
      if (raw === undefined || raw === null || raw === "") continue;
      const normalized = normalizeFieldValue(field, raw);
      if (normalized === null || normalized === "") continue;
      values.push({ field, value: normalized });
    }
    return values;
  }

  function buildImportRowInput(row, fieldByApiName) {
    const normalized = {};
    for (const [header, value] of Object.entries(row || {})) {
      const key = String(header).toLowerCase();
      if (key === "id") normalized.id = value;
      const match = fieldByApiName.get(key);
      if (match) normalized[match.api_name] = value;
    }
    const existingId = normalized.id ? String(normalized.id).trim() : null;
    const { id: _, ...input } = normalized;
    return { input, existingId };
  }

  async function findDatabaseDuplicateMatches(req, object, fields, input, { allowSameRecordId = false } = {}) {
    const matches = [];
    for (const field of getImportUniqueFields(fields)) {
      const raw = input?.[field.api_name];
      if (raw === undefined || raw === null || raw === "") continue;
      const normalized = normalizeFieldValue(field, raw);
      if (normalized === null || normalized === "") continue;
      const scope = [`${metadataColumn(field)}=$1`];
      const params = [normalized];
      if (object.company_scoped) { params.push(req.user.companyId); scope.push(`company_id=$${params.length}`); }
      if (object.store_scoped) {
        if (!req.user.storeId) throw Object.assign(new Error("A store session is required"), { status: 403 });
        params.push(req.user.storeId); scope.push(`store_id=$${params.length}`);
      }
      const existing = await db(`SELECT id FROM "${object.source_table}" WHERE ${scope.join(" AND ")}`, params);
      for (const row of existing.rows) {
        const existingIdValue = String(row.id);
        if (allowSameRecordId && existingIdValue === String(allowSameRecordId)) continue;
        matches.push({ field: field.api_name, fieldLabel: field.label || field.api_name, value: normalized, id: row.id });
      }
    }
    return matches;
  }

  async function validateImportDuplicateState(req, object, fields, input, { operation, existingId = null, csvSeen = new Map() } = {}) {
    const requested = normalizeRequestedOperation(operation);
    const directId = existingId && recordIdIsValid(String(existingId)) ? String(existingId) : null;
    if (csvSeen && csvSeen instanceof Map) {
      for (const candidate of findImportUniqueValues(fields, input)) {
        const key = `${candidate.field.api_name}:${String(candidate.value)}`;
        if (csvSeen.has(key)) {
          return {
            status: "error",
            field: candidate.field.api_name,
            value: candidate.value,
            code: "CSV_DUPLICATE_VALUE",
            message: `Duplicate ${candidate.field.label || candidate.field.api_name} value within the CSV: ${candidate.value}`,
          };
        }
        csvSeen.set(key, true);
      }
    }
    if (requested === "upsert") {
      const target = await resolveImportTarget(req, object, fields, input, { operation: requested, existingId: directId });
      if (target.action === "error") {
        return {
          status: "error",
          field: null,
          value: null,
          code: "IMPORT_MATCHING_ERROR",
          message: target.message || "Ambiguous or invalid upsert match",
        };
      }
      if (target.action === "update") return { status: "valid" };
    }
    if (requested === "create") {
      const duplicateMatches = await findDatabaseDuplicateMatches(req, object, fields, input, { allowSameRecordId: directId || false });
      if (duplicateMatches.length) {
        const match = duplicateMatches[0];
        return {
          status: "error",
          field: match.field,
          value: match.value,
          code: "EXISTING_RECORD_DUPLICATE",
          message: `${match.fieldLabel || match.field} ${match.value} already exists in this company scope`,
        };
      }
    }
    if (requested === "update") {
      const duplicateMatches = await findDatabaseDuplicateMatches(req, object, fields, input, { allowSameRecordId: directId || false });
      const conflicting = directId
        ? duplicateMatches.filter((match) => String(match.id) !== String(directId))
        : duplicateMatches;
      if (conflicting.length) {
        const match = conflicting[0];
        return {
          status: "error",
          field: match.field,
          value: match.value,
          code: "EXISTING_RECORD_DUPLICATE",
          message: directId
            ? `Update would duplicate ${match.fieldLabel || match.field} ${match.value} on a different record in this company scope`
            : `Update target could not be uniquely identified because ${match.fieldLabel || match.field} ${match.value} already exists in this company scope`,
        };
      }
    }
    return { status: "valid" };
  }

  async function resolveImportTarget(req, object, fields, input, { operation, existingId = null } = {}) {
    const requested = normalizeRequestedOperation(operation);
    const action = resolveImportAction(requested, existingId);
    const directId = existingId && recordIdIsValid(String(existingId)) ? String(existingId) : null;
    if (action === "update" && directId) {
      const scope = ["id=$1"];
      const params = [directId];
      if (object.company_scoped) { params.push(req.user.companyId); scope.push(`company_id=$${params.length}`); }
      if (object.store_scoped) {
        if (!req.user.storeId) throw Object.assign(new Error("A store session is required"), { status: 403 });
        params.push(req.user.storeId); scope.push(`store_id=$${params.length}`);
      }
      const existing = await db(`SELECT id FROM "${object.source_table}" WHERE ${scope.join(" AND ")}`, params);
      if (!existing.rows.length) return { action: "error", message: `Update target ${existingId} was not found` };
      return { action: "update", targetId: directId, matches: [directId] };
    }
    if (requested !== "upsert") return { action, targetId: directId || null, matches: directId ? [directId] : [] };
    const candidateKeys = [];
    for (const { field, value } of getImportKeyCandidates(fields, input)) {
      const scope = [`${metadataColumn(field)}=$1`];
      const params = [value];
      if (object.company_scoped) { params.push(req.user.companyId); scope.push(`company_id=$${params.length}`); }
      if (object.store_scoped) {
        if (!req.user.storeId) throw Object.assign(new Error("A store session is required"), { status: 403 });
        params.push(req.user.storeId); scope.push(`store_id=$${params.length}`);
      }
      const matches = await db(`SELECT id FROM "${object.source_table}" WHERE ${scope.join(" AND ")}`, params);
      const ids = matches.rows.map((row) => String(row.id));
      for (const id of ids) candidateKeys.push(id);
    }
    const unique = [...new Set(candidateKeys)];
    if (unique.length > 1) return { action: "error", message: "Ambiguous upsert match: multiple existing records match the configured unique/business key" };
    if (unique.length === 1) return { action: "update", targetId: unique[0], matches: unique };
    return { action: "create", targetId: null, matches: [] };
  }

  async function validateImportRow(req, object, fields, input, { lineNumber, action, existingId = null, operation = null, csvSeen = null } = {}) {
    const result = { lineNumber, action, status: "valid", field: null, value: null, message: null, code: null, warnings: [] };
    const requested = normalizeRequestedOperation(operation ?? action ?? "auto");
    const duplicateCheck = await validateImportDuplicateState(req, object, fields, input, { operation: requested, existingId, csvSeen });
    if (duplicateCheck.status === "error") {
      result.status = "error";
      result.field = duplicateCheck.field || null;
      result.value = duplicateCheck.value || null;
      result.code = duplicateCheck.code || "DUPLICATE_VALUE";
      result.message = duplicateCheck.message;
      return result;
    }
    const targetPlan = await resolveImportTarget(req, object, fields, input, { operation: requested, existingId });
    if (targetPlan.action === "error") {
      result.status = "error";
      result.code = "IMPORT_MATCHING_ERROR";
      result.message = targetPlan.message;
      return result;
    }
    const canonicalAction = targetPlan.action === "update" ? "update" : "create";
    result.action = canonicalAction;
    const permission = await hasPlatformObjectPermission(db, req, object.id, canonicalAction === "update" ? "edit" : "create");
    if (!permission) {
      result.status = "error";
      result.code = "IMPORT_PERMISSION_REQUIRED";
      result.message = `${canonicalAction} permission is required`;
      return result;
    }
    const targetId = targetPlan.targetId || (existingId && recordIdIsValid(String(existingId)) ? String(existingId) : null);
    if (canonicalAction === "update" && targetId && !recordIdIsValid(String(targetId))) {
      result.status = "error";
      result.code = "INVALID_MATCHING_IDENTIFIER";
      result.message = "The row's matching identifier is not a valid record id";
      return result;
    }
    if (canonicalAction === "update" && !targetId) {
      result.status = "error";
      result.code = "UPDATE_TARGET_NOT_FOUND";
      result.message = "Update target was not found";
      return result;
    }
    const validation = await validateRecordInput(req, object, fields, input, { requireRequired: canonicalAction === "create" });
    if (validation.error) {
      result.status = "error";
      result.code = "FIELD_VALIDATION_FAILED";
      result.message = validation.error;
      return result;
    }
    result.values = validation.values;
    const trigger = canonicalAction === "update" ? "before_update" : "before_create";
    const ruleCheck = await recordRuleCheck(req, object, fields, validation.values, trigger, canonicalAction === "update" ? targetId : null, { allowMissingExisting: true });
    if (ruleCheck.status) {
      result.status = "error";
      result.code = "OBJECT_VALIDATION_RULE_FAILED";
      result.message = ruleCheck.message || "Validation failed";
      const first = ruleCheck.errors?.[0];
      if (first) {
        result.field = first.field || null;
        result.value = first.value || null;
      }
      return result;
    }
    return result;
  }

  function operationFromAction(action) {
    return action === "update" ? "update" : action === "create" ? "create" : "upsert";
  }

  async function recordRuleCheck(req, object, fields, values, trigger, recordId = null, { allowMissingExisting = false } = {}) {
    const result = await db("SELECT * FROM platform_rules WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) AND trigger_key IN ($3,'before_save') AND action->>'type'='validation' ORDER BY id", [object.id, req.user.companyId, trigger]);
    let current = {};
    if (recordId) {
      const params = [recordId];
      const scope = ["id=$1"];
      if (object.company_scoped) { params.push(req.user.companyId); scope.push(`company_id=$${params.length}`); }
      if (object.store_scoped) { params.push(req.user.storeId); scope.push(`store_id=$${params.length}`); }
      const existing = await db(`SELECT *, xmin::text AS "__validation_version" FROM "${object.source_table}" WHERE ${scope.join(" AND ")}`, params);
      if (!existing.rows.length) {
        if (allowMissingExisting) return {};
        return { status: 404, message: "Record not found" };
      }
      current = existing.rows[0];
    }
    const candidate = { ...current, ...Object.fromEntries(values.map(({ field, value }) => [field.api_name, value])) };
    try {
      const calculated = compileFormulas(fields)(candidate);
      const withRollups = await populateRollups(db, object, fields, [calculated], req);
      const resolved = Array.isArray(withRollups) && withRollups.length ? withRollups[0] : calculated;
      const conditionalError = validateConditionalRequired(fields, resolved);
      if (conditionalError) return { status: 422, code: "CONDITIONAL_REQUIRED", message: conditionalError };
      if (!result.rows.length) return {};
      const errors = evaluateValidationRules(result.rows, fields, resolved);
      if (errors.length) return { status: 422, code: "VALIDATION_RULE_FAILED", message: errors.map(error => error.message).join("; "), errors };
    } catch (error) {
      if (error instanceof ConditionError) return { status: 422, code: error.code, message: error.message };
      return { status: 422, code: "VALIDATION_RULE_INVALID", message: "An active validation rule cannot be evaluated. Ask an administrator to review its configuration." };
    }
    return { version: current.__validation_version, current };
  }

  router.post("/platform/objects/:objectKey/records", ...manage, async (req, res) => {
    try {
      const { object, fields: metadataFields } = await getRecordMetadata(req.params.objectKey, req);
      const fields = await applyFieldSecurity(db, metadataFields, req);
      const calculate = compileFormulas(metadataFields);
      if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
      if (!(await hasPlatformObjectPermission(db, req, object.id, "create"))) return res.status(403).json({ success: false, message: "You do not have permission to create records for this object" });
      if (!object.active) return res.status(400).json({ success: false, message: "Object is inactive" });
      if (!object.source_table || !isSafeIdentifier(object.source_table)) return res.status(400).json({ success: false, message: "Object records are not available" });
      if (object.store_scoped && !req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
      const input = req.body?.data || req.body;
      const recordType = await resolveRecordType(object, req.body?.recordTypeId ?? input?.recordTypeId, req);
      if ((req.body?.recordTypeId ?? input?.recordTypeId) && !recordType) return res.status(400).json({ success: false, message: "Record type is not available for this object" });
      const recordValues = { ...input };
      delete recordValues.recordTypeId;
      if (recordType) Object.assign(recordValues, { ...(recordType.default_values || {}), ...recordValues });
      const typeError = await validateRecordTypeValues(object, fields, recordType, recordValues, req);
      if (typeError) return res.status(400).json({ success: false, message: typeError });
      const validation = await validateRecordInput(req, object, fields, recordValues, { requireRequired: true });
      if (validation.error) return res.status(400).json({ success: false, message: validation.error });
      const ruleCheck = await recordRuleCheck(req, object, fields, validation.values, "before_create");
      if (ruleCheck.status) return res.status(ruleCheck.status).json({ success: false, ...ruleCheck });
      const columns = validation.values.map(({ column }) => `"${column}"`);
      const params = validation.values.map(({ value }) => value);
      const placeholders = params.map((_, index) => `$${index + 1}`);
      if (object.company_scoped) {
        columns.push("\"company_id\"");
        placeholders.push(`$${params.length + 1}`);
        params.push(req.user.companyId);
      }
      if (object.store_scoped) {
        columns.push('"store_id"');
        params.push(req.user.storeId);
        placeholders.push(`$${params.length}`);
      }
      const returning = recordReturning(fields, validation.values);
      const result = await db(`INSERT INTO "${object.source_table}" (${columns.join(",")}) VALUES (${placeholders.join(",")}) RETURNING ${returning.join(",")}`, params);
      if (req.body?.recordTypeId !== undefined || input?.recordTypeId !== undefined) await associateRecordType(object, result.rows[0].id, recordType, req);
      await writeRecordHistory(object, result.rows[0].id, fields, null, result.rows[0], "create", req);
      const automation = await executePlatformAutomations({ db, object, fields, record: calculate(result.rows[0]), recordId: result.rows[0].id, trigger: "after_create", req });
      const approval = await submitPlatformApproval({ db, object, fields, recordId: result.rows[0].id, record: calculate(automation.record), req });
      const hydrated = await populateRollups(db, object, metadataFields, [calculate(automation.record)], req);
      res.status(201).json({ success: true, data: { ...publicFormulaRecord(fields, hydrated[0]), recordTypeId: recordType?.id ?? null, approvalStatus: approval?.status || null }, messages: automation.messages, automationExecutions: automation.executions });
    } catch (error) {
      if (error instanceof FormulaError) return res.status(422).json({ success: false, code: error.code, message: error.message });
      if (error.code === "23505") return res.status(409).json({ success: false, message: "A record with these values already exists" });
      if (error.code === "23503") return res.status(400).json({ success: false, message: "A referenced record does not exist" });
      console.error("Platform generic record create error:", error);
      res.status(500).json({ success: false, message: "Unable to create object record" });
    }
  });

  router.put("/platform/objects/:objectKey/records/:recordId", ...manage, async (req, res) => {
    try {
      if (!recordIdIsValid(req.params.recordId)) return res.status(400).json({ success: false, message: "Invalid record identifier" });
      const { object, fields: metadataFields } = await getRecordMetadata(req.params.objectKey, req);
      const fields = await applyFieldSecurity(db, metadataFields, req);
      const calculate = compileFormulas(metadataFields);
      if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
      if (!(await hasPlatformObjectPermission(db, req, object.id, "edit"))) return res.status(403).json({ success: false, message: "You do not have permission to edit records for this object" });
      if (!object.active) return res.status(400).json({ success: false, message: "Object is inactive" });
      if (!object.source_table || !isSafeIdentifier(object.source_table)) return res.status(400).json({ success: false, message: "Object records are not available" });
      if (object.store_scoped && !req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
      const input = req.body?.data || req.body;
      const recordTypeId = req.body?.recordTypeId ?? input?.recordTypeId;
      const recordType = await resolveRecordType(object, recordTypeId, req);
      if (recordTypeId && !recordType) return res.status(400).json({ success: false, message: "Record type is not available for this object" });
      const recordValues = { ...input };
      delete recordValues.recordTypeId;
      const typeError = await validateRecordTypeValues(object, fields, recordType, recordValues, req);
      if (typeError) return res.status(400).json({ success: false, message: typeError });
      const validation = await validateRecordInput(req, object, fields, recordValues);
      if (validation.error) return res.status(400).json({ success: false, message: validation.error });
      const params = validation.values.map(({ value }) => value);
      const assignments = validation.values.map(({ column }, index) => `"${column}"=$${index + 1}`);
      params.push(req.params.recordId);
      let where = `id=$${params.length}`;
      if (object.company_scoped) {
        const ownership = await db(`SELECT company_id FROM "${object.source_table}" WHERE id=$1`, [req.params.recordId]);
        if (ownership.rows.length && String(ownership.rows[0].company_id) !== String(req.user.companyId)) {
          return res.status(403).json({ success: false, message: "Company ownership violation" });
        }
        params.push(req.user.companyId);
        where += ` AND company_id=$${params.length}`;
      }
      if (object.store_scoped) { params.push(req.user.storeId); where += ` AND store_id=$${params.length}`; }
      const ruleCheck = await recordRuleCheck(req, object, fields, validation.values, "before_update", req.params.recordId);
      if (ruleCheck.status) return res.status(ruleCheck.status).json({ success: false, ...ruleCheck });
      // Reject concurrent edits instead of saving against a stale validation snapshot.
      if (ruleCheck.version !== undefined) { params.push(ruleCheck.version); where += ` AND xmin::text=$${params.length}`; }
      const returning = recordReturning(fields, validation.values);
      const result = await db(`UPDATE "${object.source_table}" SET ${assignments.join(",")} WHERE ${where} RETURNING ${returning.join(",")}`, params);
      if (!result.rows.length && ruleCheck.version !== undefined) return res.status(409).json({ success: false, message: "Record changed while validating. Reload it and try again." });
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Record not found" });
      if (req.body?.recordTypeId !== undefined || input?.recordTypeId !== undefined) await associateRecordType(object, result.rows[0].id, recordType, req);
      await writeRecordHistory(object, result.rows[0].id, fields, ruleCheck.current, result.rows[0], "update", req);
      const automation = await executePlatformAutomations({ db, object, fields, record: calculate(result.rows[0]), recordId: result.rows[0].id, trigger: "after_update", previousRecord: ruleCheck.current, req });
      const approval = await submitPlatformApproval({ db, object, fields, recordId: result.rows[0].id, record: calculate(automation.record), req });
      const hydrated = await populateRollups(db, object, metadataFields, [calculate(automation.record)], req);
      res.json({ success: true, data: { ...publicFormulaRecord(fields, hydrated[0]), recordTypeId: recordType?.id ?? null, approvalStatus: approval?.status || null }, messages: automation.messages, automationExecutions: automation.executions });
    } catch (error) {
      if (error instanceof FormulaError) return res.status(422).json({ success: false, code: error.code, message: error.message });
      if (error.code === "23503") return res.status(400).json({ success: false, message: "A referenced record does not exist" });
      console.error("Platform generic record update error:", error);
      res.status(500).json({ success: false, message: "Unable to update object record" });
    }
  });

  router.delete("/platform/objects/" + ":objectKey/records/" + ":recordId", ...manage, async (req, res) => {
    try {
      if (!recordIdIsValid(req.params.recordId)) return res.status(400).json({ success: false, message: "Invalid record identifier" });
      const { object, fields: metadataFields } = await getRecordMetadata(req.params.objectKey, req);
      const fields = await applyFieldSecurity(db, metadataFields, req);
      if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
      if (!(await hasPlatformObjectPermission(db, req, object.id, "delete"))) return res.status(403).json({ success: false, message: "You do not have permission to delete records for this object" });
      if (!object.active) return res.status(400).json({ success: false, message: "Object is inactive" });
      if (!object.source_table || !isSafeIdentifier(object.source_table)) return res.status(404).json({ success: false, message: "Object records are not available" });
      if (object.store_scoped && !req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
      const params = [req.params.recordId];
      let where = "id=$1";
      if (object.company_scoped) {
        params.push(req.user.companyId);
        where += ` AND company_id=$${params.length}`;
      }
      if (object.store_scoped) {
        params.push(req.user.storeId);
        where += ` AND store_id=$${params.length}`;
      }
      const existing = await db(`SELECT * FROM "${object.source_table}" WHERE ${where}`, params);
      if (!existing.rows.length) return res.status(404).json({ success: false, message: "Record not found" });
      // Objects with an active field use archive semantics.  This keeps the
      // RECORD_DELETE command generic while preserving historical relationships
      // (sales, stock, invoices, etc.). Objects without an active field may be
      // physically deleted when their metadata permission allows it.
      const activeField = fields.find(field => field.active !== false && field.source_column === "active");
      let result;
      let archived = false;
      if (activeField) {
        result = await db(`UPDATE "${object.source_table}" SET active=false WHERE ${where} RETURNING *`, params);
        archived = true;
      } else {
        result = await db(`DELETE FROM "${object.source_table}" WHERE ${where} RETURNING *`, params);
        await db("DELETE FROM platform_record_associations WHERE object_id=$1 AND record_id=$2 AND company_id=$3", [object.id, req.params.recordId, req.user.companyId]);
      }
      await writeRecordHistory(object, req.params.recordId, fields, existing.rows[0], archived ? result.rows[0] : null, "delete", req);
      res.json({ success: true, data: { id: req.params.recordId, deleted: !archived && !!result.rows.length, archived: archived && !!result.rows.length } });
    } catch (error) {
      console.error("Platform generic record delete error:", error);
      res.status(500).json({ success: false, message: "Unable to delete object record" });
    }
  });

  router.get("/platform/objects/:objectKey/records", authenticate, async (req, res) => {
    try {
      const metadata = await db("SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)", [req.params.objectKey, req.user.companyId]);
      const object = metadata.rows[0];
      if (!object || !object.source_table || !isSafeIdentifier(object.source_table)) return res.status(404).json({ success: false, message: "Object records are not available" });
      if (!(await hasPlatformObjectPermission(db, req, object.id, "view"))) return res.status(403).json({ success: false, message: "You do not have permission to view records for this object" });
      const metadataFields = await db("SELECT * FROM platform_fields WHERE object_id=$1 AND active=true AND (company_id IS NULL OR company_id=$2) ORDER BY display_order", [object.id, req.user.companyId]);
      if (systemObject(object)) object.company_scoped = true;
      const safeFields = safeSystemFields(object, metadataFields.rows);
      const fields = await applyFieldSecurity(db, safeFields, req);
      const calculate = compileFormulas(safeFields);
      const readableFields = fields.filter((field) => field.readable !== false && field.field_type !== "formula" && field.field_type !== "rollup" && isSafeIdentifier(field.api_name) && Boolean(platformFieldSql(field, object)));
      const listView = req.query.listViewId ? (await db("SELECT * FROM platform_list_views WHERE id=$1 AND object_id=$2 AND company_id=$3 AND active=true", [req.query.listViewId, object.id, req.user.companyId])).rows[0] || null : null;
      const configuredColumns = listView && Array.isArray(listView.columns) ? listView.columns : null;
      const selectedReadable = configuredColumns ? readableFields.filter((field) => configuredColumns.includes(field.api_name) || configuredColumns.includes(field.id)) : readableFields;
      const columns = selectedReadable.map((field) => `${platformFieldSql(field, object)} AS "${field.api_name}"`);
      if (!columns.length && !fields.some(field => (field.field_type === "formula" || field.field_type === "rollup") && field.readable !== false)) return res.json({ success: true, data: [], records: [], page: 1, pageSize: 50, total: 0, pages: 0 });
      const fieldByApiName = new Map(readableFields.map((field) => [field.api_name, field]));
      const filters = parseRecordFilters(req.query);
      if (!filters) return res.status(400).json({ success: false, message: "filter must be a JSON object" });
      const clauses = [];
      const params = [];
      if (object.company_scoped) {
        params.push(req.user.companyId);
        clauses.push(`company_id=$${params.length}`);
      }
      if (object.store_scoped) {
        if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
        params.push(req.user.storeId); clauses.push(`store_id=$${params.length}`);
      }
      if (listView && listView.filters && typeof listView.filters === "object" && !Array.isArray(listView.filters)) {
        for (const [apiName, value] of Object.entries(listView.filters)) {
          const field = fieldByApiName.get(apiName);
          if (!field) continue;
          const values = Array.isArray(value) ? value : [value];
          if (!values.length) continue;
          const placeholders = values.map((item) => {
            params.push(item);
            return `$${params.length}`;
          });

          router.get("/platform/objects/:objectKey/records/:recordId/related/:relationshipKey", authenticate, async (req, res) => {
            try {
              if (!recordIdIsValid(req.params.recordId) || !isSafeIdentifier(req.params.relationshipKey)) {
                return res.status(400).json({ success: false, message: "Invalid related record request" });
              }
              const parentResult = await db(
                "SELECT * FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
                [req.params.objectKey, req.user.companyId]
              );
              const parent = parentResult.rows[0];
              if (!parent) return res.status(404).json({ success: false, message: "Object not found" });

              const parentClauses = ["id=$1"];
              const parentParams = [req.params.recordId];
              if (parent.company_scoped) {
                parentParams.push(req.user.companyId);
                parentClauses.push(`company_id=$${parentParams.length}`);
              }
              if (parent.store_scoped) {
                if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
                parentParams.push(req.user.storeId);
                parentClauses.push(`store_id=$${parentParams.length}`);
              }
              appendSystemReadScope(parent, req, parentClauses, parentParams);
              const parentRecord = await db(`SELECT id FROM "${parent.source_table}" WHERE ${parentClauses.join(" AND ")}`, parentParams);
              if (!parentRecord.rows.length) return res.status(404).json({ success: false, message: "Record not found" });

              const relationshipResult = await db(
                `SELECT r.*, child.object_key AS child_object_key
                 FROM platform_relationships r
                 JOIN platform_objects child ON child.id=r.child_object_id
                 WHERE r.parent_object_id=$1 AND r.relationship_key=$2 AND r.active=true
                   AND (child.company_id IS NULL OR child.company_id=$3)`,
                [parent.id, req.params.relationshipKey, req.user.companyId]
              );
              const relationship = relationshipResult.rows[0];
              if (!relationship) return res.status(404).json({ success: false, message: "Relationship not found" });
              const childMetadata = await getRecordMetadata(relationship.child_object_key, req);
              const child = childMetadata.object;
              if (!child || !child.source_table || !isSafeIdentifier(child.source_table)) {
                return res.status(404).json({ success: false, message: "Related object is unavailable" });
              }
              const childField = childMetadata.fields.find((field) => String(field.id) === String(relationship.child_field_id));
              if (!childField || !platformFieldSql(childField, child)) {
                return res.status(422).json({ success: false, message: "Relationship target field is unavailable" });
              }
              const fields = await applyFieldSecurity(db, childMetadata.fields, req);
              const readableFields = fields.filter((field) => field.readable !== false && isSafeIdentifier(field.api_name) && platformFieldSql(field, child));
              const columns = readableFields.map((field) => `${platformFieldSql(field, child)} AS "${field.api_name}"`);
              const clauses = [`${platformFieldSql(childField, child)}=$1`];
              const params = [req.params.recordId];
              if (child.company_scoped) {
                params.push(req.user.companyId);
                clauses.push(`company_id=$${params.length}`);
              }
              if (child.store_scoped) {
                if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
                params.push(req.user.storeId);
                clauses.push(`store_id=$${params.length}`);
              }
              appendSystemReadScope(child, req, clauses, params);
              const limit = boundedInteger(req.query.limit ?? req.query.pageSize, 25, 100);
              const offset = Math.max(Number.parseInt(req.query.offset || "0", 10) || 0, 0);
              const sortField = typeof req.query.sortField === "string"
                ? readableFields.find((field) => field.api_name === req.query.sortField)
                : null;
              const direction = String(req.query.sortDirection || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
              const order = sortField ? ` ORDER BY ${platformFieldSql(sortField, child)} ${direction}` : " ORDER BY id ASC";
              const count = await db(`SELECT COUNT(*)::int AS total FROM "${child.source_table}" WHERE ${clauses.join(" AND ")}`, params);
              const dataParams = [...params, limit, offset];
              const result = await db(
                `SELECT id${columns.length ? `, ${columns.join(", ")}` : ""} FROM "${child.source_table}" WHERE ${clauses.join(" AND ")}${order} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
                dataParams
              );
              const calculate = compileFormulas(childMetadata.fields);
              const hydrated = await hydrateExtensions(db, child, fields, result.rows, req);
              const calculated = await populateRollups(db, child, childMetadata.fields, hydrated.map((record) => calculate(record)), req);
              const records = calculated.map((record) => publicFormulaRecord(fields, record));
              const total = count.rows[0]?.total || 0;
              res.json({ success: true, data: records, records, relationship, pageSize: limit, offset, total });
            } catch (error) {
              if (error.status) return res.status(error.status).json({ success: false, message: error.message });
              if (error instanceof FormulaError) return res.status(422).json({ success: false, code: error.code, message: error.message });
              console.error("Platform related records load error:", error);
              res.status(500).json({ success: false, message: "Unable to load related records" });
            }
          });
          clauses.push(values.length === 1 ? `${platformFieldSql(field, object)}=${placeholders[0]}` : `${platformFieldSql(field, object)} IN (${placeholders.join(",")})`);
        }
      }
      for (const [apiName, value] of Object.entries(filters)) {
        const field = fieldByApiName.get(apiName);
        if (!field) return res.status(400).json({ success: false, message: `Unknown or unavailable filter field "${apiName}"` });
        const values = Array.isArray(value) ? value : [value];
        if (!values.length) continue;
        const placeholders = values.map((item) => {
          params.push(item);
          return `$${params.length}`;
        });

        clauses.push(values.length === 1 ? `${platformFieldSql(field, object)}=${placeholders[0]}` : `${platformFieldSql(field, object)} IN (${placeholders.join(",")})`);
      }
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      if (search) {
        if (!readableFields.length) return res.status(400).json({ success: false, message: "Search requires a stored readable field" });
        params.push(`%${search}%`);
        const searchParam = `$${params.length}`;
        clauses.push(`(${readableFields.map((field) => `CAST(${platformFieldSql(field, object)} AS TEXT) ILIKE ${searchParam}`).join(" OR ")})`);
      }
      appendSystemReadScope(object, req, clauses, params);
      const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      const countResult = await db(`SELECT COUNT(*)::int AS total FROM "${object.source_table}"${where}`, params);
      const total = countResult.rows[0]?.total || 0;
      const pageSize = listView && Number.isFinite(Number(listView.page_size)) ? Number(listView.page_size) : boundedInteger(req.query.pageSize ?? req.query.limit, 50, 200);
      const pages = total ? Math.ceil(total / pageSize) : 0;
      const page = pages ? Math.min(boundedInteger(req.query.page, 1, pages), pages) : 1;
      const offset = (page - 1) * pageSize;
      const dataParams = [...params, pageSize, offset];
      const sort = listView && listView.sort && typeof listView.sort === "object" ? normalizeListViewSort(listView.sort) : { field: null, direction: "asc" };
      const sortField = sort.field ? fieldByApiName.get(sort.field) : null;
      const orderClause = sortField ? ` ORDER BY ${platformFieldSql(sortField, object)} ${sort.direction === "desc" ? "DESC" : "ASC"}` : ["inventory", "purchase_receipt"].includes(object.object_key) ? ` ORDER BY id` : ` ORDER BY created_at DESC NULLS LAST`;
      const result = await db(`SELECT ${["id", ...columns].join(", ")} FROM "${object.source_table}"${where}${orderClause} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`, dataParams);
      const associations = await loadRecordTypeAssociations(object, result.rows.map((record) => record.id), req);
      const typeByRecord = new Map(associations.rows.map((row) => [String(row.record_id), row.record_type_id]));
      const extended = await hydrateExtensions(db, object, fields, result.rows, req);
      const hydrated = await populateRollups(db, object, fields, extended.map((record) => calculate(record)), req);
      result.rows = hydrated.map((record) => ({ ...publicFormulaRecord(fields, record), recordTypeId: typeByRecord.get(String(record.id)) ?? null }));
      res.json({ success: true, data: result.rows, records: result.rows, page, pageSize, total, pages });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      if (error instanceof FormulaError) return res.status(422).json({ success: false, code: error.code, message: error.message });
      console.error("Platform records load error:", error);
      res.status(500).json({ success: false, message: "Unable to load object records" });
    }
  });

  router.get("/platform/objects/:objectKey/records/export", authenticate, async (req, res) => {
    try {
      const { object, fields: metadataFields } = await getRecordMetadata(req.params.objectKey, req);
      if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
      if (!(await hasPlatformObjectPermission(db, req, object.id, "export"))) return res.status(403).json({ success: false, message: "Export permission is required" });
      const fields = await applyFieldSecurity(db, metadataFields, req);
      const readableFields = fields.filter((field) => field.active === true && field.readable !== false && !isCalculatedField(field) && metadataColumn(field) && isSafeIdentifier(field.api_name));
      if (!readableFields.length) return res.status(400).json({ success: false, message: "This object has no readable exportable fields" });
      const filters = parseRecordFilters(req.query);
      if (filters === null) return res.status(400).json({ success: false, message: "filter must be a JSON object" });
      const clauses = [];
      const params = [];
      if (object.company_scoped) { params.push(req.user.companyId); clauses.push(`company_id=$${params.length}`); }
      if (object.store_scoped) { if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" }); params.push(req.user.storeId); clauses.push(`store_id=$${params.length}`); }
      for (const [apiName, value] of Object.entries(filters)) {
        const field = readableFields.find((candidate) => candidate.api_name === apiName);
        if (!platformFieldSql(field, object)) continue;
        const values = Array.isArray(value) ? value : [value];
        const placeholders = values.map((item) => { params.push(item); return `$${params.length}`; });
        clauses.push(values.length === 1 ? `${platformFieldSql(field, object)}=${placeholders[0]}` : `${platformFieldSql(field, object)} IN (${placeholders.join(",")})`);
      }
      appendSystemReadScope(object, req, clauses, params);
      const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
      const queryFields = ["id", ...readableFields.map((field) => `${platformFieldSql(field, object)} AS "${field.api_name}"`)];
      const result = await db(`SELECT ${queryFields.join(", ")} FROM "${object.source_table}"${where} ORDER BY id`, params);
      const csvRows = [readableFields.map((field) => field.api_name).join(",")];
      for (const row of result.rows) {
        csvRows.push(readableFields.map((field) => csvEscape(row[field.api_name])).join(","));
      }
      const csv = `\ufeff${csvRows.join("\r\n")}`;
      if (typeof writeAudit === "function") await writeAudit(req.user.companyId, req.user.id, "platform.bulk_export", "platform_object", object.id, { objectKey: object.object_key, rowCount: result.rows.length, scope: req.query });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${object.object_key}-records-export-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(csv);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("Platform object export error:", error);
      res.status(500).json({ success: false, message: "Unable to export object records" });
    }
  });

  router.post("/platform/objects/:objectKey/records/import/validate", ...manage, async (req, res) => {
    try {
      const { object, fields: metadataFields } = await getRecordMetadata(req.params.objectKey, req);
      if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
      if (!(await hasPlatformObjectPermission(db, req, object.id, "import"))) return res.status(403).json({ success: false, message: "Import permission is required" });
      const fields = await applyFieldSecurity(db, metadataFields, req);
      const csvText = typeof req.body?.csv === "string" ? req.body.csv : "";
      if (!csvText.trim()) return res.status(400).json({ success: false, message: "CSV content is required" });
      const { headers, rows } = parseCsv(csvText);
      if (!headers.length || !rows.length) return res.status(400).json({ success: false, message: "CSV contains no data rows" });
      const fieldByApiName = new Map(fields.filter((field) => field.active === true).map((field) => [field.api_name.toLowerCase(), field]));
      const errors = [];
      const warnings = [];
      const preview = [];
      const csvSeen = new Map();
      let valid = 0;
      let warningCount = 0;
      const operation = normalizeRequestedOperation(req.body?.operation ?? "auto");
      for (const { row, lineNumber } of rows) {
        const { input, existingId } = buildImportRowInput(row, fieldByApiName);
        const action = resolveImportAction(operation, existingId);
        const validation = await validateImportRow(req, object, fields, input, { lineNumber, action, existingId, operation, csvSeen });
        if (validation.status === "error") {
          errors.push({ row: lineNumber, status: "error", field: validation.field, value: validation.value, message: validation.message, rowData: input, originalRow: row });
          continue;
        }
        if (validation.warnings?.length) {
          warningCount += validation.warnings.length;
          warnings.push(...validation.warnings.map((warning) => ({ row: lineNumber, status: "warning", rowData: input, originalRow: row, ...warning })));
        }
        preview.push({ row: lineNumber, status: validation.warnings?.length ? "warning" : "valid", action: validation.action || action, rowData: input, warnings: validation.warnings || [] });
        valid += 1;
      }
      const summary = summarizeImportPreview(rows, preview);
      summary.warnings = warningCount;
      summary.errors = errors.length;
      summary.create = preview.filter((item) => item.action === "create").length;
      summary.update = preview.filter((item) => item.action === "update").length;
      summary.skip = errors.length;
      summary.error = errors.length;
      summary.failed = errors.length;
      res.json({ success: true, data: { rowCount: rows.length, valid, warnings: warningCount, errors: errors.length, preview, warnings, summary, errors } });
    } catch (error) {
      console.error("Platform import validation error:", error);
      res.status(500).json({ success: false, message: "Unable to validate object import" });
    }
  });

  router.post("/platform/objects/:objectKey/records/import", ...manage, async (req, res) => {
    try {
      const { object, fields: metadataFields } = await getRecordMetadata(req.params.objectKey, req);
      if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
      if (!(await hasPlatformObjectPermission(db, req, object.id, "import"))) return res.status(403).json({ success: false, message: "Import permission is required" });
      const fields = await applyFieldSecurity(db, metadataFields, req);
      const csvText = typeof req.body?.csv === "string" ? req.body.csv : "";
      if (!csvText.trim()) return res.status(400).json({ success: false, message: "CSV content is required" });
      const { rows } = parseCsv(csvText);
      if (!rows.length) return res.status(400).json({ success: false, message: "CSV contains no data rows" });
      const operation = normalizeRequestedOperation(req.body?.operation ?? "auto");
      const fieldByApiName = new Map(fields.filter((field) => field.active === true).map((field) => [field.api_name.toLowerCase(), field]));
      const results = [];
      const errors = [];
      const csvSeen = new Map();
      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const { row, lineNumber } of rows) {
        const { input, existingId } = buildImportRowInput(row, fieldByApiName);
        const action = resolveImportAction(operation, existingId);
        try {
          const validation = await validateImportRow(req, object, fields, input, { lineNumber, action, existingId, operation, csvSeen });
          if (validation.status === "error") {
            errors.push({ row: lineNumber, status: "error", field: validation.field, value: validation.value, message: validation.message, rowData: input, originalRow: row });
            skipped += 1;
            continue;
          }
          const normalizedInput = Object.fromEntries(validation.values.map(({ field, value }) => [field.api_name, value]));
          const finalAction = validation.action || action;
          const targetId = validation.action === "update" ? (existingId || await resolveImportTarget(req, object, fields, input, { operation, existingId }).then((resolved) => resolved.targetId)) : null;
          if (finalAction === "update") {
            const assignmentEntries = Object.entries(normalizedInput);
            const valueParams = assignmentEntries.map(([, value]) => value);
            const assignments = assignmentEntries.map(([key], index) => `"${key}"=$${index + 1}`);
            const scopeParams = [targetId || existingId];
            const scope = [`id=$${valueParams.length + 1}`];
            let nextIndex = valueParams.length + 2;
            if (object.company_scoped) {
              scopeParams.push(req.user.companyId);
              scope.push(`company_id=$${nextIndex}`);
              nextIndex += 1;
            }
            if (object.store_scoped) {
              if (!req.user.storeId) {
                errors.push({ row: lineNumber, status: "error", message: "A store session is required" });
                skipped += 1;
                continue;
              }
              scopeParams.push(req.user.storeId);
              scope.push(`store_id=$${nextIndex}`);
              nextIndex += 1;
            }
            const updateParams = [...valueParams, ...scopeParams];
            const result = await db(
              `UPDATE "${object.source_table}" SET ${assignments.join(",")} WHERE ${scope.join(" AND ")}`,
              updateParams,
            );
            if (!result.rows.length) {
              errors.push({ row: lineNumber, status: "error", message: "Record not found", rowData: input, originalRow: row });
              skipped += 1;
              continue;
            }
            updated += 1;
            results.push({ row: lineNumber, action: "update", id: targetId || existingId, status: "updated" });
          } else {
            const columns = Object.keys(normalizedInput).map((key) => `"${key}"`);
            const values = Object.values(normalizedInput);
            const placeholders = values.map((_, index) => `$${index + 1}`);
            if (object.company_scoped) { columns.push('"company_id"'); values.push(req.user.companyId); placeholders.push(`$${values.length}`); }
            if (object.store_scoped) { columns.push('"store_id"'); values.push(req.user.storeId); placeholders.push(`$${values.length}`); }
            const result = await db(`INSERT INTO "${object.source_table}" (${columns.join(",")}) VALUES (${placeholders.join(",")}) RETURNING id`, values);
            created += 1;
            results.push({ row: lineNumber, action: "create", id: result.rows[0]?.id || null, status: "created" });
          }
        } catch (error) {
          errors.push({ row: lineNumber, status: "error", message: error.message || "Import failed", rowData: input, originalRow: row });
          skipped += 1;
        }
      }
      const summary = { created, updated, skipped, failed: errors.length };
      res.json({ success: true, data: { summary, results, errors } });
      if (typeof writeAudit === "function") await writeAudit(req.user.companyId, req.user.id, "platform.bulk_import", "platform_object", object.id, {
        objectKey: object.object_key,
        operation,
        fileName: req.body?.fileName || req.body?.filename || null,
        created,
        updated,
        skipped,
        failed: errors.length,
      });
    } catch (error) {
      console.error("Platform object import error:", error);
      res.status(500).json({ success: false, message: "Unable to import object records" });
    }
  });

  router.get("/platform/objects/:objectKey/records/:recordId/history", authenticate, async (req, res) => {
    if (!recordIdIsValid(req.params.recordId)) return res.status(400).json({ success: false, message: "Invalid record identifier" });
    const metadata = await db(
      "SELECT id,object_key,source_table,store_scoped FROM platform_objects WHERE object_key=$1 AND active=true AND (company_id IS NULL OR company_id=$2)",
      [req.params.objectKey, req.user.companyId]
    );
    const object = metadata.rows[0];
    if (!object) return res.status(404).json({ success: false, message: "Unknown object" });
    if (!(await hasPlatformObjectPermission(db, req, object.id, "view"))) return res.status(403).json({ success: false, message: "View permission is required" });
    const params = [object.id, req.params.recordId, req.user.companyId];
    const scope = "object_id=$1 AND record_id=$2 AND company_id=$3";
    let storeClause = "";
    if (object.store_scoped) {
      if (!req.user.storeId) return res.status(403).json({ success: false, message: "A store session is required" });
      params.push(req.user.storeId);
      if (!isSafeIdentifier(object.source_table)) {
        return res.status(500).json({ success: false, message: "Object source is invalid" });
      }
      storeClause = ` AND record_id IN (SELECT id FROM "${object.source_table}" WHERE id=$2 AND store_id=$4)`;
    }
    const result = await db(
      `SELECT * FROM platform_record_history WHERE ${scope}${storeClause} ORDER BY created_at DESC`,
      params
    );
    res.json({ success: true, data: result.rows });
  });

  return router;
}
