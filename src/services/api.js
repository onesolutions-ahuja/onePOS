import { resolveApiUrl } from "./serverAddress.js";

export async function apiRequest(url, options = {}) {
  const token = localStorage.getItem("onepos_token");
  const response = await fetch(resolveApiUrl(url), {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
