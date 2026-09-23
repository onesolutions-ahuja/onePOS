import { apiRequest } from "./api.js";

export function getCustomReportMetadata() {
  return apiRequest("/api/reports/custom/metadata");
}

export function getPlatformReportFields(objectId) {
  return apiRequest(`/api/reports/custom/platform-objects/${encodeURIComponent(objectId)}/metadata`);
}

export function getCustomReports() {
  return apiRequest("/api/reports/custom");
}

export function getCustomReport(id) {
  return apiRequest(`/api/reports/custom/${encodeURIComponent(id)}`);
}

export function createCustomReport(definition) {
  return apiRequest("/api/reports/custom", {
    method: "POST",
    body: JSON.stringify(definition),
  });
}

export function updateCustomReport(id, definition) {
  return apiRequest(`/api/reports/custom/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(definition),
  });
}

export function runCustomReport(id, definition) {
  return apiRequest(`/api/reports/custom/${encodeURIComponent(id)}/run`, {
    method: "POST",
    body: JSON.stringify(definition || {}),
  });
}

export function previewCustomReport(definition) {
  return apiRequest("/api/reports/custom/preview", {
    method: "POST",
    body: JSON.stringify(definition),
  });
}

export function duplicateCustomReport(id) {
  return apiRequest(`/api/reports/custom/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
  });
}

export function archiveCustomReport(id) {
  return apiRequest(`/api/reports/custom/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function updateCustomReportUsers(id, userIds) {
  return apiRequest(`/api/reports/custom/${encodeURIComponent(id)}/users`, {
    method: "PUT",
    body: JSON.stringify({ userIds }),
  });
}
