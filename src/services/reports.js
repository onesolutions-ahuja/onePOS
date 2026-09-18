import { apiRequest } from "./api.js";

const buildDateQuery = (from, to) => `?dateFrom=${from}&dateTo=${to}`;

export function getSummary(from, to) {
  return apiRequest(`/api/reports/summary${buildDateQuery(from, to)}`);
}

export function getSales(from, to) {
  return apiRequest(`/api/reports/sales${buildDateQuery(from, to)}`);
}

export function getProducts(from, to) {
  return apiRequest(`/api/reports/products${buildDateQuery(from, to)}`);
}

export function getPayments(from, to) {
  return apiRequest(`/api/reports/payments${buildDateQuery(from, to)}`);
}

export function getCustomers(from, to) {
  return apiRequest(`/api/reports/customers${buildDateQuery(from, to)}`);
}

export function getInventoryOverview({ companyId, storeId, dateFrom = null, dateTo = null, limit = 1000, offset = 0 } = {}) {
  const params = [
    companyId,
    storeId,
    dateFrom || null,
    dateTo || null,
    Math.max(1, Math.min(10000, Number(limit) || 1000)),
    Math.max(0, Number(offset) || 0),
  ];
  return apiRequest(`/api/reports/inventory-overview?companyId=${encodeURIComponent(companyId)}&storeId=${encodeURIComponent(storeId)}&dateFrom=${dateFrom || ""}&dateTo=${dateTo || ""}&limit=${params[4]}&offset=${params[5]}`);
}

export function getInventoryMovements({
  companyId,
  storeId,
  dateFrom = null,
  dateTo = null,
  productIds = [],
  movementTypes = [],
  limit = 500,
  offset = 0,
} = {}) {
  const params = [
    companyId,
    storeId,
    dateFrom || null,
    dateTo || null,
    Math.max(1, Math.min(10000, Number(limit) || 500)),
    Math.max(0, Number(offset) || 0),
    ...(Array.isArray(productIds) && productIds.length ? productIds : []),
    ...(Array.isArray(movementTypes) && movementTypes.length ? movementTypes : []),
  ];
  return apiRequest(`/api/reports/inventory-movements?companyId=${encodeURIComponent(companyId)}&storeId=${encodeURIComponent(storeId)}&dateFrom=${dateFrom || ""}&dateTo=${dateTo || ""}&limit=${params[4]}&offset=${params[5]}&productIds=${productIds.map((id) => encodeURIComponent(String(id))).join(",")}&movementTypes=${movementTypes.map((t) => encodeURIComponent(String(t))).join(",")}`);
}

export function getProfit(from, to) {
  return apiRequest(`/api/reports/profit${buildDateQuery(from, to)}`);
}

export function getTill(from, to) {
  return apiRequest(`/api/reports/till${buildDateQuery(from, to)}`);
}

export function getVat(from, to) {
  return apiRequest(`/api/reports/vat${buildDateQuery(from, to)}`);
}
