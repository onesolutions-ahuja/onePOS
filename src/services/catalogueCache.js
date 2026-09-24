const DB_NAME = "onepos_catalogue";
const DB_VERSION = 2;
const STORE_NAME = "catalogues";
const MODIFIER_STORE_NAME = "modifiers";
const FALLBACK_PREFIX = "onepos_catalogue_v1_";

function cacheKey(tenant) {
  return `${tenant?.companyId || ""}:${tenant?.storeId || ""}`;
}

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(MODIFIER_STORE_NAME)) db.createObjectStore(MODIFIER_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function fallbackRead(key) {
  try {
    const value = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function fallbackWrite(key, value) {
  try {
    localStorage.setItem(`${FALLBACK_PREFIX}${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function loadCatalogueCache(tenant) {
  if (!tenant?.companyId || !tenant?.storeId) return null;
  const key = cacheKey(tenant);
  try {
    const db = await openDatabase();
    if (!db) return fallbackRead(key);
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return fallbackRead(key);
  }
}

export async function saveCatalogueCache(tenant, catalogue) {
  if (!tenant?.companyId || !tenant?.storeId || !catalogue) return false;
  const value = {
    schemaVersion: 1,
    tenant: { companyId: tenant.companyId, storeId: tenant.storeId },
    savedAt: new Date().toISOString(),
    version: catalogue.version || null,
    products: Array.isArray(catalogue.products) ? catalogue.products : [],
    categories: Array.isArray(catalogue.categories) ? catalogue.categories : [],
  };
  try {
    const db = await openDatabase();
    if (!db) return fallbackWrite(cacheKey(tenant), value);
    await new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(value, cacheKey(tenant));
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    return true;
  } catch {
    return fallbackWrite(cacheKey(tenant), value);
  }
}

export function applyCatalogueChanges(current, payload) {
  const products = new Map((current?.products || []).map((product) => [String(product.id), product]));
  for (const product of payload?.products || []) {
    if (product.active === false) products.delete(String(product.id));
    else products.set(String(product.id), product);
  }
  const categories = new Map((current?.categories || []).map((category) => [String(category.id), category]));
  for (const category of payload?.categories || []) {
    if (category.active === false) categories.delete(String(category.id));
    else categories.set(String(category.id), category);
  }
  return {
    version: payload?.version || current?.version || null,
    products: [...products.values()],
    categories: [...categories.values()],
  };
}

export function clearCatalogueCache(tenant) {
  if (!tenant?.companyId || !tenant?.storeId) return;
  try { localStorage.removeItem(`${FALLBACK_PREFIX}${cacheKey(tenant)}`); } catch { /* storage unavailable */ }
}


function modifierKey(tenant, productId) {
  return `${cacheKey(tenant)}:${String(productId || "")}`;
}

export async function loadModifierCache(tenant, productId) {
  if (!tenant?.companyId || !tenant?.storeId || !productId) return null;
  const key = modifierKey(tenant, productId);
  try {
    const db = await openDatabase();
    if (!db) return fallbackRead(`modifier_${key}`);
    return await new Promise((resolve, reject) => {
      const request = db.transaction(MODIFIER_STORE_NAME, "readonly").objectStore(MODIFIER_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return fallbackRead(`modifier_${key}`);
  }
}

export async function saveModifierCache(tenant, productId, rows) {
  if (!tenant?.companyId || !tenant?.storeId || !productId || !Array.isArray(rows)) return false;
  const key = modifierKey(tenant, productId);
  const value = {
    schemaVersion: 1,
    tenant: { companyId: tenant.companyId, storeId: tenant.storeId },
    productId: String(productId),
    savedAt: new Date().toISOString(),
    rows,
  };
  try {
    const db = await openDatabase();
    if (!db) return fallbackWrite(`modifier_${key}`, value);
    await new Promise((resolve, reject) => {
      const request = db.transaction(MODIFIER_STORE_NAME, "readwrite").objectStore(MODIFIER_STORE_NAME).put(value, key);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    return true;
  } catch {
    return fallbackWrite(`modifier_${key}`, value);
  }
}
