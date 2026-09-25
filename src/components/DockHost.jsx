import { useCallback, useEffect, useMemo, useState } from "react";
import AdminNavDock from "./AdminNavDock.jsx";
import { apiRequest } from "../services/api.js";
import { PAGE_SLUGS } from "../utils/adminRoutes.js";
import {
  EMPTY_PERMISSION_STATE,
  appCatalogueSnapshot,
  filterNavigationByCatalog,
  loadAppCatalogue,
  permittedNavItems,
  subscribeAppCatalogue,
} from "../utils/navCatalogue.js";
import { buildConfiguredNavigation } from "../utils/platformObjectNavigation.js";

/*
 * THE canonical dock runtime for shells that do not already own the admin
 * navigation payload — the Till/POS and the Custom Page runtime.
 *
 * It resolves exactly what the admin shell resolves (the permitted page
 * catalogue + its module/licence filter, and the permitted configured Object
 * pages) and then renders the SAME dock component, which itself loads the SAME
 * saved quick-access configuration. A shell therefore cannot end up with a
 * different dock: only the active destination and the navigation callback
 * differ.
 *
 * `permissionState` may be supplied by a shell that already fetched
 * /api/auth/me/permissions (the till does); otherwise it is loaded once here.
 */
export default function DockHost({
  page = "",
  onNavigate,
  permissionState = null,
  reportItems = [],
  canOpenSettings = true,
}) {
  const [sessionState, setSessionState] = useState(permissionState || EMPTY_PERMISSION_STATE);
  const [catalogue, setCatalogue] = useState(() => appCatalogueSnapshot());

  useEffect(() => {
    if (permissionState) {
      setSessionState(permissionState);
      return undefined;
    }
    let alive = true;
    apiRequest("/api/auth/me/permissions")
      .then((response) => { if (alive && response?.success) setSessionState(response.data); })
      .catch(() => { /* the unconditional catalogue entries stay rendered */ });
    return () => { alive = false; };
  }, [permissionState]);

  useEffect(() => {
    let alive = true;
    const unsubscribe = subscribeAppCatalogue((next) => { if (alive) setCatalogue(next); });
    loadAppCatalogue()
      .then((next) => { if (alive && next) setCatalogue(next); })
      .catch(() => { /* an unloaded catalogue never hides navigation */ });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  const items = useMemo(
    () => filterNavigationByCatalog(permittedNavItems(sessionState), catalogue?.keys ?? null),
    [sessionState, catalogue],
  );

  /* Configured Object pages never take over a built-in destination — the same
     reservation rule the admin shell applies. */
  const reservedLabels = useMemo(() => [...Object.keys(PAGE_SLUGS), ...items.map(([name]) => name), "My Reports"], [items]);
  const configured = useMemo(
    () => buildConfiguredNavigation({
      objectPages: Array.isArray(catalogue?.objectPages) ? catalogue.objectPages : [],
      reservedLabels,
    }),
    [catalogue, reservedLabels],
  );

  /* An Object page announces its own generic runtime route, so the shell can
     push the correct URL for it; built-in pages use their own slug. */
  const openPage = useCallback((name) => {
    const route = configured.routes[name] || null;
    onNavigate?.(name, route ? { route } : undefined);
  }, [configured, onNavigate]);

  return (
    <AdminNavDock
      items={items}
      objectItems={configured.items}
      reportItems={reportItems}
      page={page}
      onNavigate={openPage}
      canOpenSettings={canOpenSettings}
    />
  );
}
