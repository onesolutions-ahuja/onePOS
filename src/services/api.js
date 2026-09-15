export async function apiRequest(url, options = {}) {
  const token = localStorage.getItem("onepos_token");
  const response = await fetch(url, {
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
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error(`Server returned an invalid response (${response.status})`); }
  if (!response.ok) throw new Error(data?.message || data?.error || `Request failed (${response.status})`);
  return data;
}
