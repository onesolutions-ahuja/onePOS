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

export function getInventory() {
  return apiRequest("/api/reports/inventory");
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
