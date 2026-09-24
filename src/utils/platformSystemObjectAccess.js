/*
 * MODULE-MANAGED ("SYSTEM") OBJECT AWARENESS — presentation only.
 *
 * Records of these objects are maintained by the specialised onePOS business
 * module that owns their table, not by the generic Platform record API. The
 * authoritative list and the write protection live in
 * services/platformSystemObjects.js (`SYSTEM_OBJECTS` / `systemObject` /
 * `systemWriteError`), which returns
 *
 *   { code: "SYSTEM_OBJECT_OPERATION_REQUIRED", route: "<module page>" }
 *
 * for every generic create/update/delete/import against them.
 *
 * The generic record screens used this to offer New/Edit/Delete anyway, so the
 * user only learned the truth by being rejected. This mirror lets the UI state
 * that up front — it decides NOTHING about authorization, and it never
 * replaces the backend's protection, which still rejects any write that slips
 * through. tests/platformSystemObjectAccess.test.mjs fails if this list drifts
 * from the server's.
 */
export const MODULE_MANAGED_OBJECTS = Object.freeze(
  [
    ["product", "products", "/app/products"],
    ["customer", "customers", "/app/customers"],
    ["supplier", "suppliers", "/app/suppliers"],
    ["business_division", "business_divisions", "/app/business-divisions"],
    ["category", "categories", "/app/products"],
    ["price_list", "price_lists", "/app/customers"],
    ["employee", "users", "/app/employees"],
    ["store", "stores", "/app/stores"],
    ["sale", "sales", "/app/reports"],
    ["sale_line", "sale_items", "/app/reports"],
    ["payment", "payments", "/app/reports"],
    ["financial_ledger", "financial_ledger_entries", "/app/reports"],
    ["inventory_movement", "inventory_movements", "/app/inventory"],
    ["inventory_batch", "inventory_batches", "/app/inventory"],
    ["customer_credit_account", "customers", "/app/customers"],
    ["customer_credit_ledger", "customer_credit_ledger", "/app/customers"],
    ["inventory", "product_store_stock", "/app/inventory"],
    ["purchase", "purchases", "/app/purchases"],
    ["purchase_receipt", "purchase_receipts", "/app/purchases"],
    ["supplier_invoice", "supplier_invoices", "/app/suppliers"],
    ["online_order", "online_orders", "/app/online-orders"],
  ].map(([key, table, route]) => Object.freeze({ key, table, route })),
);

/* Business tables that belong to a family rather than a named object, e.g.
   `sales_refunds` resolves to the sale module. Mirrors the server's aliases. */
export const MODULE_MANAGED_ALIASES = Object.freeze({
  payment: "sale",
  refund: "sale",
  return: "sale",
  exchange: "sale",
  inventory: "inventory_movement",
});

export const MODULE_MANAGED_FAMILY_PATTERN =
  /^(customer|supplier|inventory|purchase|sale|online_order|payment|refund|return|exchange)(?:_|s$)/;

/** The owning module entry for an object's metadata, or null. Matches the
 *  server: by business table first, then by platform object key, then by the
 *  table's business family. */
export function moduleManagedObject(object) {
  if (!object || typeof object !== "object") return null;
  const sourceTable = typeof object.source_table === "string" ? object.source_table : "";
  const objectKey = typeof object.object_key === "string" ? object.object_key : "";
  const exact = MODULE_MANAGED_OBJECTS.find(
    (entry) => entry.table === sourceTable || (objectKey && entry.key === objectKey),
  );
  if (exact) return exact;
  const family = MODULE_MANAGED_FAMILY_PATTERN.exec(sourceTable)?.[1];
  if (!family) return null;
  const key = MODULE_MANAGED_ALIASES[family] || family;
  return MODULE_MANAGED_OBJECTS.find((entry) => entry.key === key) || null;
}

export function isModuleManagedObject(object) {
  return Boolean(moduleManagedObject(object));
}
