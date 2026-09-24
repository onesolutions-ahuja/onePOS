/*
|--------------------------------------------------------------------------
| Offline storage foundation (T8B)
|--------------------------------------------------------------------------
|
| localStorage-only helpers that let the POS retain the minimum data needed
| to keep operating when the network disappears. No new dependencies.
|
| TENANCY: every record embeds the tenant (companyId + storeId) it belongs
| to, and every read must be given the expected tenant. A record whose
| tenant does not match is rejected (and removed) - cached data is never
| reused across companies or stores. The expected tenant comes from the
| signed session token payload (onepos_token), so the POS never invents an
| identity.
|
| All storage access is guarded: quota errors / private-mode browsers must
| never break the POS. Corruption is treated as absent data.
|
| T8B scope: storage primitives + POS read/write wiring only. Offline sale
| creation, queue draining and receipt numbering come in T8C.
*/

const PRODUCT_CACHE_KEY = "onepos_offline_products";
const SETTINGS_CACHE_KEY = "onepos_offline_settings";
const TILL_CONTEXT_KEY = "onepos_offline_till_context";
const TERMINAL_IDENTITY_KEY = "onepos_offline_terminal_identity";
const OFFLINE_QUEUE_KEY = "onepos_offline_queue";

const STORAGE_VERSION = 1;

/* ========================= low-level storage ========================= */

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    // Corrupt/unreadable entry - remove it so the next write starts clean.
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded / storage disabled - foundation must never throw.
    return false;
  }
}

function removeJson(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/*
 * Wraps data with its storage version, owning tenant and save time.
 * `tenant` is { companyId, storeId }.
 */
function sealRecord(tenant, data) {
  return {
    v: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    tenant: { companyId: tenant.companyId, storeId: tenant.storeId },
    data,
  };
}

/*
 * Opens a sealed record for the expected tenant. Returns null when the
 * record is absent, corrupt, from another tenant, or from a different
 * storage version - stale/foreign data is removed on sight.
 */
function unsealRecord(key, tenant) {
  const record = readJson(key);
  if (!record || typeof record !== "object") return null;
  if (record.v !== STORAGE_VERSION) {
    removeJson(key);
    return null;
  }
  const stored = record.tenant || {};
  if (
    stored.companyId !== tenant.companyId ||
    stored.storeId !== tenant.storeId
  ) {
    // Tenant mismatch: never reuse, and drop the foreign record.
    removeJson(key);
    return null;
  }
  return record;
}

/* ===================== tenant identity (from token) ===================== */

/*
 * Decodes a JWT payload segment (base64url) without any dependency.
 * Used ONLY to read the tenant ids the session already carries.
 */
export function decodeTokenPayload(token) {
  try {
    const part = String(token).split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/*
 * The tenant the POS is currently signed in to, read from the session
 * token: { companyId, storeId, userId, username } or null when there is no
 * readable session. All offline helpers take this as their scope argument.
 */
export function getTenantFromToken() {
  let token = null;
  try { token = localStorage.getItem("onepos_token"); } catch { return null; }
  if (!token) return null;
  const payload = decodeTokenPayload(token);
  if (!payload || !payload.companyId || !payload.storeId) return null;
  return {
    companyId: payload.companyId,
    storeId: payload.storeId,
    userId: payload.id || null,
    username: payload.username || null,
  };
}

/* ========================= product cache ========================= */

export function saveProductCache(tenant, products) {
  if (!tenant || !Array.isArray(products)) return false;
  const fields = ["id", "name", "sku", "barcode", "price", "vatRate", "vatApplicable", "ageRestricted", "category", "categoryId", "stock", "trackStock", "active", "lowStockLevel"];
  return writeJson(PRODUCT_CACHE_KEY, sealRecord(tenant, products.map((product) =>
    Object.fromEntries(fields.filter((field) => product[field] !== undefined).map((field) => [field, product[field]]))
  )));
}

/* Returns the normalised product array for this tenant, or null. */
export function loadProductCache(tenant) {
  const record = unsealRecord(PRODUCT_CACHE_KEY, tenant);
  return record && Array.isArray(record.data) ? record.data : null;
}

/* ========================= settings cache ========================= */

export function saveSettingsCache(tenant, settings) {
  if (!tenant || !settings || typeof settings !== "object") return false;
  return writeJson(SETTINGS_CACHE_KEY, sealRecord(tenant, {
    tax: { vatEnabled: settings.tax?.vatEnabled, defaultVatRate: settings.tax?.defaultVatRate },
    store: { name: settings.store?.name },
    till: { terminalNumber: settings.till?.terminalNumber },
  }));
}

/* Returns the cached settings object (company/tax/store/till), or null. */
export function loadSettingsCache(tenant) {
  const record = unsealRecord(SETTINGS_CACHE_KEY, tenant);
  return record && record.data && typeof record.data === "object"
    ? record.data
    : null;
}

/* ========================= till context ========================= */

/*
 * Context of the till session the SERVER last confirmed as open for this
 * tenant. Context only in T8B - it does not (yet) authorise selling.
 */
export function saveTillContext(tenant, context) {
  if (!tenant || !context || typeof context !== "object") return false;
  return writeJson(TILL_CONTEXT_KEY, sealRecord(tenant, context));
}

export function loadTillContext(tenant) {
  const record = unsealRecord(TILL_CONTEXT_KEY, tenant);
  return record && record.data && typeof record.data === "object"
    ? record.data
    : null;
}

/* Removes the stored context (e.g. the server confirms no open session). */
export function clearTillContext(tenant) {
  if (!tenant) return;
  const record = readJson(TILL_CONTEXT_KEY);
  if (!record) return;
  const stored = record.tenant || {};
  if (
    stored.companyId === tenant.companyId &&
    stored.storeId === tenant.storeId
  ) {
    removeJson(TILL_CONTEXT_KEY);
  }
}

/* ========================= terminal identity ========================= */

/*
 * Persisted identity of the terminal/store/company this browser last saw
 * for this tenant (from server-confirmed data only - never invented).
 */
export function saveTerminalIdentity(tenant, identity) {
  if (!tenant || !identity || typeof identity !== "object") return false;
  return writeJson(TERMINAL_IDENTITY_KEY, sealRecord(tenant, identity));
}

export function loadTerminalIdentity(tenant) {
  const record = unsealRecord(TERMINAL_IDENTITY_KEY, tenant);
  return record && record.data && typeof record.data === "object"
    ? record.data
    : null;
}

/* ===================== offline queue primitives ===================== */

/*
 * Raw FIFO queue storage for T8C (offline sale creation + sync). T8B only
 * provides the primitives - nothing enqueues yet.
 */

export function readOfflineQueue(tenant) {
  const record = unsealRecord(OFFLINE_QUEUE_KEY, tenant);
  return record && Array.isArray(record.data) ? record.data : [];
}

export function writeOfflineQueue(tenant, sales) {
  if (!tenant || !Array.isArray(sales)) return false;
  return writeJson(OFFLINE_QUEUE_KEY, sealRecord(tenant, sales));
}

// Server-verified till identity and sale permissions only. No duplicate bearer token.
const SESSION_KEY = "onepos_offline_session";
async function sessionFingerprint(token) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function saveOfflineSession(user, permissions) {
  try {
    const token = localStorage.getItem("onepos_token");
    const payload = decodeTokenPayload(token);
    if (!payload?.exp || !user || !permissions) return false;
    const fingerprint = await sessionFingerprint(token);
    if (localStorage.getItem("onepos_token") !== token) return false;
    return writeJson(SESSION_KEY, {
      fingerprint, expiresAt: payload.exp * 1000,
      user: { id: user.id, companyId: user.companyId, storeId: user.storeId },
      permissions: {
        isAdmin: permissions.isAdmin === true,
        jarvesEnabled: permissions.jarvesEnabled === true,
        permissions: (permissions.permissions || []).filter((code) => typeof code === "string" && code.startsWith("sale.")),
      },
    });
  } catch { return false; }
}
export async function loadOfflineSession() {
  try {
    const record = readJson(SESSION_KEY);
    const token = localStorage.getItem("onepos_token");
    if (!record || !token || record.expiresAt <= Date.now() || !Number.isFinite(record.expiresAt)) return null;
    if (record.fingerprint !== await sessionFingerprint(token)) return null;
    const tenant = getTenantFromToken();
    if (!tenant || record.user.id !== tenant.userId || record.user.companyId !== tenant.companyId || record.user.storeId !== tenant.storeId) return null;
    return record;
  } catch { return null; }
}
export function clearOfflineSession() { removeJson(SESSION_KEY); }
