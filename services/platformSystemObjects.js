// Business tables keep their existing write engines. Match by table as well as
// key so a renamed object cannot turn a protected business record into CRUD.
const definitions = [
  ["product", "products", "product.view", "/app/products"],
  ["customer", "customers", "customer.view", "/app/customers"],
  ["supplier", "suppliers", "inventory.view", "/app/suppliers"],
  ["category", "categories", "product.view", "/app/products"],
  ["price_list", "price_lists", "customer.view", "/app/customers"],
  ["employee", "users", "user.view", "/app/employees"],
  ["attendance", "attendance_records", "attendance.view", "/app/employees"],
  ["store", "stores", "store.view", "/app/stores"],
  ["sale", "sales", "sale.view", "/app/reports"],
  ["sale_line", "sale_items", "sale.view", "/app/reports"],
  ["payment", "payments", "reports.payments.view", "/app/reports"],
  ["financial_ledger", "financial_ledger_entries", "reports.payments.view", "/app/reports"],
  ["inventory_movement", "inventory_movements", "inventory.view", "/app/inventory"],
  ["inventory_batch", "inventory_batches", "inventory.view", "/app/inventory"],
  ["customer_credit_account", "customers", "customer.credit.view", "/app/customers"],
  ["customer_credit_ledger", "customer_credit_ledger", "customer.credit.view", "/app/customers"],
  ["inventory", "product_store_stock", "inventory.view", "/app/inventory"],
  ["purchase", "purchases", "purchase.view", "/app/purchases"],
  ["purchase_receipt", "purchase_receipts", "purchase.view", "/app/purchases"],
  ["supplier_invoice", "supplier_invoices", "purchase.view", "/app/suppliers"],
  ["online_order", "online_orders", "online_orders.view", "/app/online-orders"],
];

export const SYSTEM_OBJECTS = Object.freeze(definitions.map(([key, table, permission, route]) =>
  Object.freeze({ key, table, permission, route })));

export function systemObject(object) {
  const exact = SYSTEM_OBJECTS.find(entry => entry.table === object?.source_table || entry.key === object?.object_key);
  if (exact) return exact;
  const family = /^(customer|supplier|inventory|purchase|sale|online_order|payment|refund|return|exchange)(?:_|s$)/.exec(object?.source_table || "")?.[1];
  if (!family) return null;
  const key = ({ payment: "sale", refund: "sale", return: "sale", exchange: "sale", inventory: "inventory_movement" })[family] || family;
  return SYSTEM_OBJECTS.find(entry => entry.key === key) || null;
}

const SYSTEM_OBJECT_RBAC = Object.freeze({
  employee: Object.freeze({ view: "user.view", edit: "user.edit" }),
  attendance: Object.freeze({ view: "attendance.view" }),
});

export function systemObjectRbacPermission(object, action) {
  const definition = systemObject(object);
  return definition ? SYSTEM_OBJECT_RBAC[definition.key]?.[action] || null : null;
}

export function safeSystemFields(object, fields) {
  if (!["users", "stores"].includes(object?.source_table)) return fields;
  const profile = new Set(object.source_table === "users"
    ? ["full_name", "username", "email", "active", "store_id", "created_at", "updated_at"]
    : ["name", "code", "address_line1", "city", "postcode", "phone", "active", "created_at", "updated_at"]);
  return fields.filter(field => !field.source_column || profile.has(field.source_column));
}

export async function hydrateExtensions(db, object, fields, records, req) {
  const custom = fields.filter(field => field.active !== false && isExtensionField(field));
  if (!custom.length || !records.length) return records;
  const stored = await db("SELECT record_id,custom_values FROM platform_record_associations WHERE object_id=$1 AND company_id=$2 AND record_id=ANY($3::uuid[])", [object.id, req.user.companyId, records.map(record => record.id)]);
  const byId = new Map(stored.rows.map(row => [String(row.record_id), row.custom_values]));
  return records.map(record => ({ ...record, ...Object.fromEntries(custom.map(field => [field.api_name, byId.get(String(record.id))?.[field.api_name] ?? null])) }));
}

export function tenantFields(fields, companyId) {
  return fields.filter(field => field.company_id == null || field.company_id === companyId);
}

export function isExtensionField(field) {
  return field.config?.storage === "extension" && !field.source_column;
}

export function platformFieldSql(field, object) {
  if (!field || field.readable === false || !/^[a-z_][a-z0-9_]*$/.test(field.api_name || "")) return null;
  if (field.source_column && /^[a-z_][a-z0-9_]*$/.test(field.source_column)) return `"${field.source_column}"`;
  if (!isExtensionField(field)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(object.id) || !/^[a-z_][a-z0-9_]*$/.test(object.source_table || "")) throw new Error("Invalid extension mapping");
  // Only validated metadata identifiers/UUIDs enter this expression. Correlate
  // on BOTH company and business record; callers scope the business table.
  const value = `(SELECT e.custom_values->>'${field.api_name}' FROM platform_record_associations e WHERE e.object_id='${object.id}'::uuid AND e.record_id="${object.source_table}".id AND e.company_id="${object.source_table}".company_id)`;
  const cast = ({ number: "numeric", decimal: "numeric", currency: "numeric", boolean: "boolean", date: "date", datetime: "timestamptz" })[field.field_type];
  return cast ? `NULLIF(${value},'')::${cast}` : value;
}

export function appendSystemReadScope(object, req, clauses, params) {
  if (["product_store_stock", "inventory_movements", "inventory_batches", "purchases", "purchase_receipts", "online_orders", "sales", "customer_credit_ledger"].includes(object?.source_table) && !object.store_scoped) {
    if (!req.user.storeId) throw Object.assign(new Error("A store session is required"), { status: 403 });
    params.push(req.user.storeId);
    clauses.push(`store_id=$${params.length}`);
  }
  if (object?.source_table === "customers" && !req.platformCompanyCustomers) {
    if (!req.user.storeId) throw Object.assign(new Error("A store session is required"), { status: 403 });
    params.push(req.user.storeId, req.user.companyId);
    clauses.push(`EXISTS (SELECT 1 FROM customer_stores cs WHERE cs.customer_id="customers".id AND cs.store_id=$${params.length - 1} AND cs.company_id=$${params.length} AND cs.active=true)`);
  }
}
