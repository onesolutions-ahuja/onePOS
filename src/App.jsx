import { useEffect, useState } from "react";
import { apiRequest } from "./services/api.js";
import Login from "./pages/auth/Login.jsx";
import POS from "./pages/pos/POS.jsx";
import AdminLayout from "./pages/admin/AdminLayout.jsx";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);

  const [checkingSession, setCheckingSession] =
    useState(true);

  const [view, setView] =
    useState("pos");

  const [adminInitialPage, setAdminInitialPage] = useState("Dashboard");

  useEffect(() => {
    const verifySession = async () => {
      const token = localStorage.getItem("onepos_token");

      if (!token) {
        setCheckingSession(false);
        return;
      }

      try {
        const data = await apiRequest("/api/auth/me");

        if (!data.success || !data.user) {
          throw new Error("Session is invalid");
        }

        setLoggedIn(true);
      } catch {
        localStorage.removeItem("onepos_token");
        setLoggedIn(false);
      } finally {
        setCheckingSession(false);
      }
    };

    verifySession();
  }, []);

  const logout = () => {
    setLoggedIn(false);
    setView("pos");

    localStorage.removeItem(
      "onepos_token"
    );
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
        onLogin={() =>
          setLoggedIn(true)
        }
      />
    );
  }

  if (view === "admin") {
    return (
      <AdminLayout
        onPOS={() =>
          setView("pos")
        }
        onLogout={logout}
        initialPage={adminInitialPage}
      />
    );
  }

  return (
    <POS
      onAdmin={() => {
        setAdminInitialPage("Dashboard");
        setView("admin");
      }}
      onOpenOnlineOrders={() => {
        setAdminInitialPage("Online Orders");
        setView("admin");
      }}
      onLogout={logout}
    />
  );
}
