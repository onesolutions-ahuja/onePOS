import { isSafeIdentifier } from "./platformMetadata.js";

export const STANDARD_REPORT_SOURCES = [
  {
    key: "sales",
    label: "Sales",
    kind: "standard",
    supportsDates: true,
    grouping: true,
    sorting: true,
    fields: ["date", "store", "user", "product", "sku", "quantity", "gross_sales", "net_sales", "vat", "discount", "transactions"],
  },
  { key: "products", label: "Products", kind: "standard", grouping: true, sorting: true },
  { key: "customers", label: "Customers", kind: "standard", grouping: true, sorting: true },
  { key: "inventory", label: "Inventory", kind: "standard", grouping: true, sorting: true },
  { key: "payments", label: "Payments", kind: "standard", grouping: true, sorting: true },
];

const OPERATORS = new Set(["equals", "not_equals", "contains", "starts_with", "is_blank", "is_not_blank", "gt", "gte", "lt", "lte", "between", "in"]);
const AGGREGATES = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

export function normalizePlatformReportDefinition(definition = {}) {
  return {
    ...definition,
    dataSource: "platform_object",
    objectId: String(definition.objectId || ""),
    fields: [...new Set((Array.isArray(definition.fields) ? definition.fields : []).map(String))],
    filters: Array.isArray(definition.filters) ? definition.filters.slice(0, 20) : [],
    filterLogic: ["all", "any"].includes(String(definition.filterLogic || "all").toLowerCase())
      ? String(definition.filterLogic || "all").toLowerCase()
      : "all",
    groupBy: Array.isArray(definition.groupBy) ? [...new Set(definition.groupBy.map(String))] : [],
    summaries: Array.isArray(definition.summaries) ? definition.summaries.slice(0, 10) : [],
    sort: Array.isArray(definition.sort) ? definition.sort.slice(0, 10) : [],
    presentation: definition.presentation && typeof definition.presentation === "object"
      ? {
        type: ["table", "summary", "bar", "line", "pie", "donut"].includes(String(definition.presentation.type))
          ? String(definition.presentation.type)
          : "table",
        xField: definition.presentation.xField ? String(definition.presentation.xField) : null,
        yField: definition.presentation.yField ? String(definition.presentation.yField) : null,
      }
      : { type: "table", xField: null, yField: null },
  };
}

function fieldKey(field) {
  return String(field.api_name || field.key || "");
}

function buildFieldMap(fields, relationships = []) {
  const fieldMap = new Map(fields
    .filter((field) => field.active !== false && field.readable !== false)
    .map((field) => [fieldKey(field), field]));
  for (const relationship of relationships) {
    const relationshipKey = String(relationship.relationship_key || relationship.key || "");
    const relatedFields = Array.isArray(relationship.fields) ? relationship.fields : [];
    if (!isSafeIdentifier(relationshipKey)) continue;
    for (const field of relatedFields) {
      const key = fieldKey(field);
      if (isSafeIdentifier(key)) fieldMap.set(`${relationshipKey}.${key}`, { ...field, relationshipKey });
    }
  }
  return fieldMap;
}

export function validatePlatformReportDefinition(definition, object, fields, relationships = []) {
  const normalized = normalizePlatformReportDefinition(definition);
  if (!object?.id || !object.source_table || !isSafeIdentifier(object.source_table)) throw new Error("Report object is not available");
  const fieldMap = buildFieldMap(fields, relationships);
  if (!normalized.fields.length || normalized.fields.some((key) => !fieldMap.has(key))) throw new Error("Select at least one valid report field");
  if (normalized.groupBy.some((key) => !fieldMap.has(key))) throw new Error("Invalid grouping field");
  for (const summary of normalized.summaries) {
    const key = String(summary?.field || "");
    const aggregate = String(summary?.aggregate || "").toUpperCase();
    const field = fieldMap.get(key);
    const type = String(field?.field_type || field?.type || "").toLowerCase();
    if (!field || !AGGREGATES.has(aggregate)) throw new Error("Invalid report summary");
    if (["SUM", "AVG", "MIN", "MAX"].includes(aggregate) && !["number", "decimal", "currency", "date", "datetime", "formula", "rollup"].includes(type)) {
      throw new Error(`Aggregate ${aggregate} is not valid for ${key}`);
    }
  }
  for (const filter of normalized.filters) {
    if (!fieldMap.has(String(filter?.field)) || !OPERATORS.has(String(filter?.operator))) throw new Error("Invalid report filter");
  }
  for (const item of normalized.sort) {
    if (!fieldMap.has(String(item?.field)) || !["asc", "desc"].includes(String(item?.direction).toLowerCase())) throw new Error("Invalid sort field");
  }
  return normalized;
}

function fieldExpression(field, alias = "r", relationshipAliases = {}) {
  const sourceColumn = field?.source_column || field?.sourceColumn;
  if (!sourceColumn || !isSafeIdentifier(sourceColumn)) throw new Error("Report field mapping is invalid");
  const sourceAlias = field?.relationshipKey ? relationshipAliases[field.relationshipKey] : alias;
  if (!sourceAlias || !isSafeIdentifier(sourceAlias)) throw new Error("Report relationship mapping is invalid");
  return `${sourceAlias}."${sourceColumn}"`;
}

export function buildPlatformObjectQuery(definition, object, fields, companyId, limit = 1000, scope = {}, relationships = []) {
  const normalized = validatePlatformReportDefinition(definition, object, fields, relationships);
  const fieldMap = buildFieldMap(fields, relationships);
  const params = [companyId];
  const where = object.company_scoped === false ? ["TRUE"] : [`r.company_id = $${params.length}`];
  const relationshipAliases = {};
  const joins = [];
  for (const [index, relationship] of relationships.entries()) {
    const key = String(relationship.relationship_key || relationship.key || "");
    const targetTable = relationship.target_source_table || relationship.source_table;
    const childColumn = relationship.child_source_column || relationship.childSourceColumn;
    if (!isSafeIdentifier(key) || !targetTable || !isSafeIdentifier(targetTable) || !childColumn || !isSafeIdentifier(childColumn)) continue;
    const alias = `rel${index + 1}`;
    relationshipAliases[key] = alias;
    const localColumn = relationship.local_source_column || relationship.localSourceColumn;
    const targetColumn = relationship.target_source_column || relationship.targetSourceColumn;
    joins.push(localColumn && isSafeIdentifier(localColumn) && targetColumn && isSafeIdentifier(targetColumn)
      ? `LEFT JOIN "${targetTable}" ${alias} ON ${alias}."${targetColumn}" = r."${localColumn}"`
      : `LEFT JOIN "${targetTable}" ${alias} ON ${alias}."${childColumn}" = r."id"`);
  }
  let next = params.length + 1;
  if (object.store_scoped === true) {
    if (!scope.storeId) throw new Error("A store session is required to run this report");
    params.push(String(scope.storeId));
    where.push(`r.store_id = $${next}`);
    next += 1;
  }
  const filterClauses = [];
  for (const filter of normalized.filters) {
    const field = fieldMap.get(String(filter.field));
    const expression = fieldExpression(field, "r", relationshipAliases);
    const operator = String(filter.operator);
    if (["is_blank", "is_not_blank"].includes(operator)) {
      filterClauses.push(`${expression} IS ${operator === "is_blank" ? "" : "NOT "}NULL`);
      continue;
    }
    if (operator === "between") {
      filterClauses.push(`${expression} BETWEEN $${next} AND $${next + 1}`);
      const range = Array.isArray(filter.value)
        ? filter.value
        : typeof filter.value === "string" ? filter.value.split(",").map((value) => value.trim()) : [];
      params.push(filter.from ?? range[0] ?? null, filter.to ?? range[1] ?? null);
      next += 2;
      continue;
    }
    const values = Array.isArray(filter.value)
      ? filter.value
      : operator === "in" && typeof filter.value === "string"
        ? filter.value.split(",").map((value) => value.trim()).filter(Boolean)
        : [filter.value];
    const sqlOperator = operator === "equals" ? "=" : operator === "not_equals" ? "<>" : operator === "contains" ? "ILIKE" : operator === "starts_with" ? "ILIKE" : operator === "gt" ? ">" : operator === "gte" ? ">=" : operator === "lt" ? "<" : operator === "lte" ? "<=" : "IN";
    if (operator === "in") {
      filterClauses.push(`${expression} = ANY($${next})`);
      params.push(values);
    } else {
      filterClauses.push(`${expression} ${sqlOperator} $${next}`);
      params.push(operator === "contains" ? `%${values[0]}%` : operator === "starts_with" ? `${values[0]}%` : values[0]);
    }
    next += 1;
  }
  if (filterClauses.length) where.push(`(${filterClauses.join(normalized.filterLogic === "any" ? " OR " : " AND ")})`);
  const selected = normalized.fields.map((key) => `${fieldExpression(fieldMap.get(key), "r", relationshipAliases)} AS "${key}"`);
  const groupKeys = [...new Set([
    ...normalized.groupBy,
    ...(normalized.summaries.length ? normalized.fields : []),
  ])];
  const groups = groupKeys.map((key) => fieldExpression(fieldMap.get(key), "r", relationshipAliases));
  const summaries = normalized.summaries.map((summary) => `${String(summary.aggregate).toUpperCase()}(${summary.aggregate === "COUNT" ? "*" : fieldExpression(fieldMap.get(String(summary.field)), "r", relationshipAliases)}) AS "${summary.aggregate.toLowerCase()}_${summary.field}"`);
  const select = [...selected, ...summaries];
  const order = (normalized.sort.length ? normalized.sort : normalized.groupBy.map((field) => ({ field, direction: "asc" })))
    .map((item) => `"${item.field}" ${String(item.direction).toLowerCase() === "asc" ? "ASC" : "DESC"}`).join(", ");
  const sql = `SELECT ${select.join(", ")} FROM "${object.source_table}" r ${joins.join(" ")} WHERE ${where.join(" AND ")}${groups.length ? ` GROUP BY ${groups.join(", ")}` : ""}${order ? ` ORDER BY ${order}` : ""} LIMIT ${Math.min(Math.max(Number(limit) || 1000, 1), 1000)}`;
  return { sql, params, definition: normalized };
}
