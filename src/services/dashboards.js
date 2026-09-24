import { apiRequest } from "./api.js";

export const getDashboards = () => apiRequest("/api/dashboards");
export const getDashboard = (id) => apiRequest(`/api/dashboards/${encodeURIComponent(id)}`);
export const saveDashboard = (dashboard) => apiRequest(dashboard.id ? `/api/dashboards/${dashboard.id}` : "/api/dashboards", { method: dashboard.id ? "PUT" : "POST", body: JSON.stringify(dashboard) });
export const duplicateDashboard = (id) => apiRequest(`/api/dashboards/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
export const archiveDashboard = (id) => apiRequest(`/api/dashboards/${encodeURIComponent(id)}`, { method: "DELETE" });
export const runDashboard = (id) => apiRequest(`/api/dashboards/${encodeURIComponent(id)}/run`, { method: "POST" });
