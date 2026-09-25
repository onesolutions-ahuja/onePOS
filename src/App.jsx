import { lazy, Suspense, useEffect, useState } from "react";
import { apiRequest } from "./services/api.js";
import { loadOfflineSession, saveOfflineSession, clearOfflineSession } from "./services/offlineStore.js";
import { isNetworkError, isTimeoutError } from "./services/networkStatus.js";
import { timeoutSignal, withTimeout } from "./services/requestTimeout.js";
import { getConnectivity, subscribeConnectivity } from "./services/connectivity.js";
import { parseAppPath, buildAppPath } from "./utils/adminRoutes.js";
import { resolveLandingFlow, resolveLandingPage } from "./utils/runtimeAccess.js";
import Login from "./pages/auth/Login.jsx";

// Route-sized surfaces are intentionally lazy. Admin, POS, Self-Checkout and
// metadata custom pages have largely independent dependency graphs; eagerly
// importing all of them made every /app visit download the entire application.
const POS = lazy(() => import("./pages/pos/POS.jsx"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout.jsx"));
const SelfCheckout = lazy(() => import("./pages/selfCheckout/SelfCheckout.jsx"));
const CustomPageRuntime = lazy(() => import("./components/CustomPageRuntime.jsx"));
/* The canonical dock runtime. Lazy for the same reason as the views: only the
   custom-page branch mounts it outside the admin shell / till, and it must not
   be pulled into the entry bundle. */
const DockHost = lazy(() => import("./components/DockHost.jsx"));

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [offlineSession, setOfflineSession] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");
  const [entitlements, setEntitlements] = useState({});

  const rememberSession = async (verifiedUser) => {
    try {
      const result = await apiRequest("/api/auth/me/permissions", { signal: timeoutSignal(10000) });
      if (result.success) {
        let enabledModules = new Set();
        try {
          const runtime = await apiRequest("/api/platform/runtime/app-catalog", { signal: timeoutSignal(10000) });
          enabledModules = new Set((runtime.data || []).map((entry) => entry.module_key || entry.key));
        } catch { /* The server-side route remains authoritative; keep cached startup safe. */ }
        let runtimeSettings = {};
        try {
          const runtime = await apiRequest("/api/settings/runtime", { signal: timeoutSignal(10000) });
          runtimeSettings = runtime.data || {};
        } catch { /* Older servers and offline startup use the safe profile default. */ }
        const deviceProfile = runtimeSettings.deviceProfile || localStorage.getItem("onepos_device_profile") || "admin";
        const permissionState = {
          ...result.data,
          enabledModules: [...enabledModules],
          landingPath: resolveLandingFlow({
            flow: runtimeSettings.landingFlow,
            user: verifiedUser,
            deviceProfile,
            fallback: resolveLandingPage({
              enabledModules,
              permissions: result.data.permissions || [],
              isAdmin: result.data.isAdmin === true,
              isSuperadmin: result.data.isSuperadmin === true,
              deviceProfile,
              userOverride: runtimeSettings.userOverride,
              roleDefault: runtimeSettings.roleDefault,
              companyDefault: runtimeSettings.companyDefault,
            }),
          }),
        };
        setEntitlements(permissionState.entitlements || {});
        await saveOfflineSession(verifiedUser, permissionState);
        return permissionState;
      }
    } catch { /* Offline access requires previously verified permissions. */ }
    return null;
  };

  const [checkingSession, setCheckingSession] =
    useState(true);

  const [view, setView] =
    useState("pos");

  useEffect(() => {
    if (!loggedIn) return undefined;

    let cancelled = false;
    let failures = 0;
    let timer = null;
    const refreshJarvesAccess = async () => {
      try {
        const result = await apiRequest("/api/auth/me/permissions", {
          signal: timeoutSignal(10000),
        });
        if (!cancelled && result.success) {
          failures = 0;
          setEntitlements(result.data.entitlements || {});
        }
      } catch (error) {
        /* Back off on repeated failure instead of hammering auth every 5s;
           a 401 storm must never log the user out from a poll — logout stays
           an explicit user/server-rejection action. */
        if (!cancelled) {
          failures += 1;
          if (timer) {
            window.clearInterval(timer);
            timer = window.setInterval(
              refreshJarvesAccess,
              Math.min(5000 * 2 ** failures, 60000)
            );
          }
        }
        /* Keep the last verified state during a temporary network outage. */
      }
    };

    refreshJarvesAccess();
    timer = window.setInterval(refreshJarvesAccess, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loggedIn]);

  /* An offline session is the degraded mode. Re-verify its token and current
     permissions with the server when connectivity returns before unlocking
     admin navigation. A browser online event alone grants no access. */
  useEffect(() => {
    if (!loggedIn || !offlineSession) return undefined;
    let cancelled = false;
    let verifying = false;
    const recover = async (snapshot) => {
      if (!(snapshot.server === "connected") || verifying) return;
      verifying = true;
      try {
        const result = await apiRequest("/api/auth/me", { signal: timeoutSignal(10000) });
        if (!cancelled && result.success && result.user) {
          setUser(result.user);
          setEntitlements(result.user.entitlements || {});
          await rememberSession(result.user);
          if (!cancelled) setOfflineSession(false);
        }
      } catch (error) {
        if (!cancelled && error.status === 401) logout();
      } finally {
        verifying = false;
      }
    };
    const unsubscribe = subscribeConnectivity(recover);
    void recover(getConnectivity());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loggedIn, offlineSession]);

  /*
   * T10D: Self-Checkout mode. Entered ONLY explicitly from the staff POS
   * (authorised against the existing permission system by the backend);
   * while the mode token is held the app renders ONLY the Self-Checkout
   * screen — no admin/POS navigation exists to reach — and the server-side
   * mode gate blocks privileged operations for that token.
   */
  const [scoToken, setScoToken] = useState(null);
  const [scoStoreName, setScoStoreName] = useState("");
  const [scoError, setScoError] = useState("");
  const [scoStarting, setScoStarting] = useState(false);

  const enterSelfCheckout = async (deviceKey) => {
    if (scoStarting) return;
    setScoStarting(true);
    setScoError("");
    try {
      /* Customer-device entry: the store's paired device key (Settings →
         Store & Till → Self-Checkout device pairing) mints the restricted
         session — no staff login on the SCO device. */
      const data = await apiRequest("/api/self-checkout/device-session", {
        signal: timeoutSignal(10000),
        method: "POST",
        body: JSON.stringify({ deviceKey }),
      });
      if (!data.success || !data.data?.modeToken) throw new Error(data.message || "Unable to start Self-Checkout");
      setScoToken(data.data.modeToken);
      setScoStoreName(data.data.store?.name || "");
    } catch (error) {
      setScoError(error.message || "Unable to start Self-Checkout");
    } finally {
      setScoStarting(false);
    }
  };

  const exitSelfCheckout = async () => {
    try {
      await apiRequest("/api/self-checkout/session", {
        signal: timeoutSignal(10000),
        method: "DELETE",
        headers: scoToken ? { Authorization: `Bearer ${scoToken}` } : {},
      });
    } catch { /* the mode token is discarded regardless. */ }
    setScoToken(null);
    setScoStoreName("");
    setScoError("");
  };

  /*
   * T10V: the URL is the source of truth for the starting view. A deep link
   * like /app/sales opens straight into the admin Sales page; /app (or any
   * unknown path) lands on the till. Permissions are still enforced by the
   * renderer — a deep link resolves through the same gates as clicking the
   * page's nav entry.
   */
  const routeFromPath = () => {
    const parsed = parseAppPath(window.location.pathname);
    if (parsed?.view === "custom_page") {
      setCustomPageKey(parsed.pageKey);
      setView("custom_page");
      return;
    }
    if (parsed?.view === "admin") {
      setView("admin");
      setAdminInitialPage(parsed.page);
      return;
    }
    /* Unknown /app/<slug> deep links normalise to the till URL instead of
       silently rendering the till under a broken address. */
    if (parsed?.view === "unknown" && window.location.pathname !== "/app") {
      window.history.replaceState({}, "", "/app");
    }
    setView("pos");
  };

  const [adminInitialPage, setAdminInitialPage] = useState("Dashboard");
  const [customPageKey, setCustomPageKey] = useState(null);

  const applyResolvedLanding = (permissionState) => {
    const path = permissionState?.landingPath;
    if (!path || window.location.pathname !== "/app") return;
    const parsed = parseAppPath(path);
    if (parsed?.view === "custom_page") {
      setCustomPageKey(parsed.pageKey);
      setView("custom_page");
    } else if (parsed?.view === "admin") {
      setAdminInitialPage(parsed.page);
      setView("admin");
    }
    window.history.replaceState({}, "", path);
  };

  /*
   * ONE destination resolver for every shell. The canonical dock hands back a
   * page — and, for a configured Object page, its own generic runtime route —
   * and App performs the same view switch + history push the individual exits
   * used to do. Offline sessions keep their existing guard, so a dock shortcut
   * can never bypass it.
   */
  const openAppPage = (page, options = {}) => {
    if (offlineSession) return;
    const target = page === "Settings" && options.settingsTab
      ? buildAppPath("Settings", { settingsTab: options.settingsTab })
      : options.route || buildAppPath(page);
    setAdminInitialPage(page);
    setView("admin");
    window.history.pushState({}, "", target);
  };

  useEffect(() => {
    routeFromPath();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  useEffect(() => {
    const verifySession = async () => {
      const token = localStorage.getItem("onepos_token");

      if (!token) {
        if (window.location.pathname === "/app" || window.location.pathname.startsWith("/app/")) {
          /* T10V: remember the deep link so the user lands on the same page
             after signing in instead of always returning to the till. */
          try { sessionStorage.setItem("onepos_return_path", window.location.pathname); } catch { /* private mode */ }
          window.history.replaceState({}, "", "/login");
        }
        setCheckingSession(false);
        return;
      }

      try {
        const data = await apiRequest("/api/auth/me", { signal: timeoutSignal(10000) });

        if (!data.success || !data.user) {
          throw new Error("Session is invalid");
        }

        setLoggedIn(true);
        setUser(data.user);
        setEntitlements(data.user.entitlements || {});
        rememberSession(data.user).then((permissionState) => {
          if (permissionState)
          if (window.location.pathname === "/app") applyResolvedLanding(permissionState);
        });
        if (window.location.pathname === "/login") {
          window.history.replaceState({}, "", "/app");
        }
      } catch (error) {
        /* A client-side timeout means "server too slow", not "device offline":
           never enter degraded offline mode and never clear the token for it —
           just fall back to the login screen and let the cashier retry. */
        if (isTimeoutError(error)) {
          setCheckingSession(false);
          setLoggedIn(false);
          setSessionMessage("Server is taking too long — please try again.");
          return;
        }
        const unavailable = isNetworkError(error) || (typeof error.status === "number" && error.status >= 500);
        /* loadOfflineSession touches IndexedDB/crypto and must never leave the
           "Checking session..." gate hanging in private mode. */
        let cached = null;
        try {
          cached = unavailable ? await withTimeout(loadOfflineSession(), 3000, "Offline session check") : null;
        } catch { cached = null; }
        if (cached && (cached.permissions.isAdmin || cached.permissions.permissions.includes("sale.create"))) {
          setUser(cached.user);
          setOfflineSession(true);
          setLoggedIn(true);
        } else {
          if (!unavailable) {
            localStorage.removeItem("onepos_token");
            localStorage.removeItem("onepos_acting_company_id");
            clearOfflineSession();
            /* The server rejected the token (401 invalid/expired): tell the
             * user why they are back on the login screen instead of failing
             * silently. Network/5xx outages keep the offline fallback above. */
            if (error.status === 401) {
              setSessionMessage("Session expired — please log in again.");
            }
          }
          setLoggedIn(false);
        }
      } finally {
        setCheckingSession(false);
      }
    };

    verifySession();
  }, []);

  const logout = () => {
    setLoggedIn(false);
    setUser(null);
    setView("pos");
    clearOfflineSession();
    setOfflineSession(false);

    localStorage.removeItem(
      "onepos_token"
    );
    localStorage.removeItem("onepos_acting_company_id");
    window.location.assign("/login");
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-[#f4f6f8] flex items-center justify-center text-sm text-slate-400">
        Checking session...
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <Login
        sessionMessage={sessionMessage}
        onLogin={(loggedInUser) => {
          /* Read the deep link FIRST: rememberSession's .then below runs after
             this handler returns, so it must see an initialised value. */
          let returnPath = null;
          try {
            returnPath = sessionStorage.getItem("onepos_return_path");
            sessionStorage.removeItem("onepos_return_path");
          } catch { /* private mode */ }
          setUser(loggedInUser);
          setOfflineSession(false);
          setSessionMessage("");
          rememberSession(loggedInUser).then((permissionState) => {
            if (!returnPath) applyResolvedLanding(permissionState);
          });
          setLoggedIn(true);
          /* T10V: return to the deep-linked page after sign-in when there
             was one; otherwise the till. Login must not create a history
             entry pointing back at /login, so replace — never push. */
          const parsedReturn = returnPath ? parseAppPath(returnPath) : null;
          const safePath = parsedReturn ? returnPath : "/app";
          window.history.replaceState({}, "", safePath);
          if (parsedReturn?.view === "custom_page") {
            setCustomPageKey(parsedReturn.pageKey);
            setView("custom_page");
          } else if (parsedReturn?.view === "admin") {
            setAdminInitialPage(parsedReturn.page);
            setView("admin");
          }
        }}
      />
    );
  }

  /* T10D: while in Self-Checkout mode ONLY that screen is reachable. */
  if (scoToken) {
    return (
      <Suspense fallback={<div className="onepos-route-loading" role="status" aria-live="polite">Loading…</div>}>
      <div className="onepos-motion-surface onepos-form-enter">
        <SelfCheckout
          modeToken={scoToken}
          storeName={scoStoreName}
          onExit={exitSelfCheckout}
        />
      </div>
      </Suspense>
    );
  }

  if (view === "custom_page" && customPageKey) {
    return (
      <>
        <Suspense fallback={<div className="onepos-route-loading" role="status">Loading…</div>}>
          {/* A customer-created page inherits the SAME application shell: the
              canonical dock stays mounted above it and only its own content
              surface animates (the dock is never animated). */}
          <div className="pb-[calc(var(--dock-height)+32px+env(safe-area-inset-bottom))]">
            <div className="onepos-motion-surface onepos-record-enter">
              <CustomPageRuntime pageKey={customPageKey} onClose={() => openAppPage("Dashboard")} />
            </div>
          </div>
        </Suspense>
        <DockHost page="" onNavigate={openAppPage} />
      </>
    );
  }

  if (view === "admin") {
    return (
      <Suspense fallback={<div className="onepos-route-loading" role="status" aria-live="polite">Loading…</div>}>
        <div className="onepos-motion-surface onepos-page-enter">
          <AdminLayout
            user={user}
            entitlements={entitlements}
            onPOS={() => {
              setView("pos");
              window.history.pushState({}, "", "/app");
            }}
            onLogout={logout}
            initialPage={adminInitialPage}
          />
        </div>
      </Suspense>
    );
  }

  return (
    <>
      <Suspense fallback={<div className="onepos-route-loading" role="status" aria-live="polite">Loading…</div>}>
      <div className="onepos-motion-surface onepos-page-enter">
        <POS
          onAdmin={() => {
            if (offlineSession) return;
            setAdminInitialPage("Dashboard");
            setView("admin");
            window.history.pushState({}, "", "/app/dashboard");
          }}
          onSettings={() => {
            if (offlineSession) return;
            setAdminInitialPage("Settings");
            setView("admin");
            window.history.pushState({}, "", "/app/settings");
          }}
          onOpenOnlineOrders={() => {
            if (offlineSession) return;
            setAdminInitialPage("Online Orders");
            setView("admin");
            window.history.pushState({}, "", "/app/online-orders");
          }}
          /* The till renders the SAME canonical dock as the admin pages; every
             shortcut it offers resolves through the ONE destination resolver
             above (offline sessions keep the guard). */
          onOpenApp={openAppPage}
          onStartSelfCheckout={enterSelfCheckout}
          scoStarting={scoStarting}
          scoError={scoError}
          onLogout={logout}
        />
      </div>
      </Suspense>
    </>
  );
}
