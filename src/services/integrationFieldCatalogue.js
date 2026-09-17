/*
 * --------------------------------------------------------------------------
 * Integration Field Catalogue (T9E)
 * --------------------------------------------------------------------------
 *
 * Metadata only for the future Integration frontend field-selection
 * dropdown/tree. No resolution, mapping, database or route logic here.
 *
 * Each entry:
 *   { path, label, type, selectable, array }
 *
 * - path: canonical onePOS source path (dot + optional [] notation).
 * - label: human-friendly display name.
 * - type: "string" | "number" | "date".
 * - selectable: always true here (every listed field is user-selectable).
 * - array: true when the path contains "[]", else false.
 */

const CATALOGUE = [
  // ---- Sales ----
  { path: 'sales.sale_id', label: 'Sale ID', type: 'string', selectable: true, array: false },
  { path: 'sales.receipt_number', label: 'Receipt number', type: 'string', selectable: true, array: false },
  { path: 'sales.total', label: 'Sale total', type: 'number', selectable: true, array: false },
  { path: 'sales.subtotal', label: 'Sale subtotal', type: 'number', selectable: true, array: false },
  { path: 'sales.tax', label: 'Sale tax', type: 'number', selectable: true, array: false },
  { path: 'sales.discount', label: 'Sale discount', type: 'number', selectable: true, array: false },
  { path: 'sales.payment_method', label: 'Payment method', type: 'string', selectable: true, array: false },
  { path: 'sales.customer.name', label: 'Customer name', type: 'string', selectable: true, array: false },
  { path: 'sales.customer.address.postcode', label: 'Customer postcode', type: 'string', selectable: true, array: false },
  { path: 'sales.items[].product.name', label: 'Item product name', type: 'string', selectable: true, array: true },
  { path: 'sales.items[].product.sku', label: 'Item product SKU', type: 'string', selectable: true, array: true },
  { path: 'sales.items[].product.ean', label: 'Item product EAN', type: 'string', selectable: true, array: true },
  { path: 'sales.items[].quantity', label: 'Item quantity', type: 'number', selectable: true, array: true },
  { path: 'sales.items[].unit_price', label: 'Item unit price', type: 'number', selectable: true, array: true },
  { path: 'sales.items[].total', label: 'Item total', type: 'number', selectable: true, array: true },

  // ---- Purchase ----
  { path: 'purchase.purchase_id', label: 'Purchase ID', type: 'string', selectable: true, array: false },
  { path: 'purchase.reference_number', label: 'Purchase reference number', type: 'string', selectable: true, array: false },
  { path: 'purchase.purchase_date', label: 'Purchase date', type: 'date', selectable: true, array: false },
  { path: 'purchase.supplier.name', label: 'Supplier name', type: 'string', selectable: true, array: false },
  { path: 'purchase.items[].product.name', label: 'Purchase item product name', type: 'string', selectable: true, array: true },
  { path: 'purchase.items[].product.sku', label: 'Purchase item product SKU', type: 'string', selectable: true, array: true },
  { path: 'purchase.items[].product.ean', label: 'Purchase item product EAN', type: 'string', selectable: true, array: true },
  { path: 'purchase.items[].quantity', label: 'Purchase item quantity', type: 'number', selectable: true, array: true },
  { path: 'purchase.items[].unit_cost', label: 'Purchase item unit cost', type: 'number', selectable: true, array: true },
  { path: 'purchase.items[].total', label: 'Purchase item total', type: 'number', selectable: true, array: true },

  // ---- Customer return (T9G dispatch entity: SALES_RETURN_CREATED) ----
  { path: 'return.return_id', label: 'Return ID', type: 'string', selectable: true, array: false },
  { path: 'return.return_type', label: 'Return type', type: 'string', selectable: true, array: false },
  { path: 'return.receipt_number', label: 'Original receipt number', type: 'string', selectable: true, array: false },
  { path: 'return.purchase_reference', label: 'Original purchase reference', type: 'string', selectable: true, array: false },
  { path: 'return.supplier_name', label: 'Supplier name', type: 'string', selectable: true, array: false },
  { path: 'return.reason', label: 'Return reason', type: 'string', selectable: true, array: false },
  { path: 'return.refund_total', label: 'Refund total', type: 'number', selectable: true, array: false },
  { path: 'return.created_at', label: 'Return created at', type: 'date', selectable: true, array: false },
  { path: 'return.items[].quantity', label: 'Return item quantity', type: 'number', selectable: true, array: true },
  { path: 'return.items[].product.name', label: 'Return item product name', type: 'string', selectable: true, array: true },
  { path: 'return.items[].product.sku', label: 'Return item product SKU', type: 'string', selectable: true, array: true },
  { path: 'return.items[].product.ean', label: 'Return item product EAN', type: 'string', selectable: true, array: true },
  { path: 'return.items[].reason', label: 'Return item reason', type: 'string', selectable: true, array: true },
];

/**
 * Return a fresh deep copy of the catalogue so callers can never mutate the
 * shared definition.
 *
 * @returns {Array<{path: string, label: string, type: string, selectable: boolean, array: boolean}>}
 */
export function getIntegrationFieldCatalogue() {
  return CATALOGUE.map((entry) => ({ ...entry }));
}

export default { getIntegrationFieldCatalogue };
