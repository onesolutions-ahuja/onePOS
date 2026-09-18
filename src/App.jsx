import { useEffect, useState } from "react";
import { apiRequest } from "./services/api.js";
import { loadOfflineSession, saveOfflineSession, clearOfflineSession } from "./services/offlineStore.js";
import { isNetworkError } from "./services/networkStatus.js";
import { parseAppPath } from "./utils/adminRoutes.js";
import Login from "./pages/auth/Login.jsx";
import POS from "./pages/pos/POS.jsx";
import AdminLayout from "./pages/admin/AdminLayout.jsx";
import SelfCheckout from "./pages/selfCheckout/SelfCheckout.jsx";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [offlineSession, setOfflineSession] = useState(false);
  const [sessionMessage, setSessionMessage] = useState("");

  const rememberSession = async (verifiedUser) => {
    try {
      const result = await apiRequest("/api/auth/me/permissions", { signal: AbortSignal.timeout(10000) });
      if (result.success) await saveOfflineSession(verifiedUser, result.data);
    } catch { /* Offline access requires previously verified permissions. */ }
  };

  const [checkingSession, setCheckingSession] =
    useState(true);

  const [view, setView] =
    useState("pos");

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

  const enterSelfCheckout = async () => {
    if (scoStarting) return;
    setScoStarting(true);
    setScoError("");
    try {
      const data = await apiRequest("/api/self-checkout/session", {
        signal: AbortSignal.timeout(10000),
        method: "POST",
        body: JSON.stringify({}),
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
        signal: AbortSignal.timeout(10000),
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
    if (parsed?.view === "admin") {
      setView("admin");
      setAdminInitialPage(parsed.page);
      return;
    }
    setView("pos");
  };

  const [adminInitialPage, setAdminInitialPage] = useState("Dashboard");

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
        const data = await apiRequest("/api/auth/me", { signal: AbortSignal.timeout(10000) });

        if (!data.success || !data.user) {
          throw new Error("Session is invalid");
        }

        setLoggedIn(true);
        setUser(data.user);
        rememberSession(data.user);
        if (window.location.pathname === "/login") {
          window.history.replaceState({}, "", "/app");
        }
      } catch (error) {
        const unavailable = isNetworkError(error) || error.status >= 500;
        const cached = unavailable ? await loadOfflineSession() : null;
        if (cached && (cached.permissions.isAdmin || cached.permissions.permissions.includes("sale.create"))) {
          setUser(cached.user);
          setOfflineSession(true);
          setLoggedIn(true);
        } else {
          if (!unavailable) {
            localStorage.removeItem("onepos_token");
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
          setUser(loggedInUser);
          setOfflineSession(false);
          setSessionMessage("");
          rememberSession(loggedInUser);
          setLoggedIn(true);
          /* T10V: return to the deep-linked page after sign-in when there
             was one; otherwise the till. Login must not create a history
             entry pointing back at /login, so replace — never push. */
          let returnPath = null;
          try {
            returnPath = sessionStorage.getItem("onepos_return_path");
            sessionStorage.removeItem("onepos_return_path");
          } catch { /* private mode */ }
          const parsedReturn = returnPath ? parseAppPath(returnPath) : null;
          const safePath = parsedReturn ? returnPath : "/app";
          window.history.replaceState({}, "", safePath);
          if (parsedReturn?.view === "admin") {
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
      <SelfCheckout
        modeToken={scoToken}
        storeName={scoStoreName}
        onExit={exitSelfCheckout}
      />
    );
  }

  if (view === "admin") {
    return (
      <AdminLayout
        user={user}
        onPOS={() => {
          setView("pos");
          window.history.pushState({}, "", "/app");
        }}
        onLogout={logout}
        initialPage={adminInitialPage}
      />
    );
  }

  return (
    <POS
      onAdmin={() => {
        if (offlineSession) return;
        setAdminInitialPage("Dashboard");
        setView("admin");
        window.history.pushState({}, "", "/app/dashboard");
      }}
      onOpenOnlineOrders={() => {
        if (offlineSession) return;
        setAdminInitialPage("Online Orders");
        setView("admin");
        window.history.pushState({}, "", "/app/online-orders");
      }}
      onStartSelfCheckout={enterSelfCheckout}
      scoStarting={scoStarting}
      scoError={scoError}
      onLogout={logout}
    />
  );
}
