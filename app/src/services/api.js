import { resolveApiUrl } from "./serverAddress.js";

export function getActingCompanyId() {
  return localStorage.getItem("onepos_acting_company_id") || "";
}

export function setActingCompanyId(companyId) {
  if (companyId) localStorage.setItem("onepos_acting_company_id", companyId);
  else localStorage.removeItem("onepos_acting_company_id");
}

export async function apiRequest(url, options = {}) {
  const token = localStorage.getItem("onepos_token");
  const response = await fetch(resolveApiUrl(url), {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(getActingCompanyId() ? { "X-Acting-Company-Id": getActingCompanyId() } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { throw Object.assign(new Error(`Server returned an invalid response (${response.status})`), { code: "INVALID_RESPONSE", status: response.status, payload: {} }); }
  if (response.status === 401) throw Object.assign(new Error(data?.message || data?.error || "Authentication required"), { code: "AUTH_REQUIRED", status: 401, payload: data });
  if (!response.ok) throw Object.assign(new Error(data?.message || data?.error || `Request failed (${response.status})`), { code: data?.code, status: response.status, payload: data });
  return data;
}
