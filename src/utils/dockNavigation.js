import { sanitizeConfiguredPages, sortConfiguredPages } from './platformObjectNavigation.js';
import { buildObjectPath } from './adminRoutes.js';

// Navigation only: the API has already filtered these objects for this user.
const normalized = value => String(value || '').toLowerCase().replace(/[ _-]/g, '').replace(/ies$/, 'y').replace(/s$/, '');
export function buildDockNavigation(objectPages = [], quickAccess) {
  const seen = new Set();
  const pages = sortConfiguredPages(sanitizeConfiguredPages(objectPages)).filter(page => {
    if (seen.has(page.objectKey)) return false;
    seen.add(page.objectKey);
    return true;
  }).map(page => ({ ...page, route: buildObjectPath(page.objectKey) }));
  const resolve = name => pages.find(page => [page.key, page.label, page.objectKey].some(value => normalized(value) === normalized(name === 'Purchasing' ? 'purchase' : name)));
  const safeQuickAccess = Array.isArray(quickAccess)
    ? quickAccess.filter((name) => name !== 'Settings')
    : quickAccess;
  const selected = Array.isArray(safeQuickAccess) && safeQuickAccess.length
    ? safeQuickAccess.map(resolve).filter(Boolean)
    : pages;
  return { pages, pinned: [...new Map(selected.map(page => [page.objectKey, page])).values()].slice(0, 10) };
}
