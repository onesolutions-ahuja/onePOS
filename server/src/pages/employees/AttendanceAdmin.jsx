import { useCallback, useEffect, useState } from "react";
import { Clock, LogIn, LogOut, RefreshCw } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Tabs } from "../../components/ui.jsx";

/*
 * Employees — Staff attendance (clock in/out).
 *
 * One page, two sections behind the existing Tabs pattern:
 *   - "My Attendance": every authenticated user clocks themselves in/out,
 *     sees their current status and their own history
 *     (GET /api/attendance/me, POST /api/attendance/clock-in,
 *      POST /api/attendance/clock-out, GET /api/attendance/me/records).
 *   - "Attendance Management": only for Administrator/Admin/Owner or roles
 *     holding attendance.view — the SAME permission model /api/auth/me/
 *     permissions reports everywhere else in the app. The backend stays the
 *     final authority: a 403 on the management endpoints renders the
 *     existing access-denied pattern even if this tab were somehow shown.
 *
 * Time rules (the backend is authoritative):
 *   - clock-in / clock-out send NO timestamps and NO durations; the server
 *     stamps both with the database clock and computes worked_minutes.
 *   - The live elapsed display is a LOCAL interpolation between backend
 *     refreshes: server elapsedMinutes + minutes since the fetch. Reloads
 *     and re-clocks always re-sync from /api/attendance/me. There is no
 *     polling loop — one 30s local tick while clocked in only.
 *   - The official worked duration shown after clock-out comes from the
 *     server response (workedMinutes), never from React arithmetic.
 *
 * Offline behaviour: attendance is an employment record and stays
 * server-authoritative. A failed request shows a clear error that the
 * action could NOT be completed — no local attendance record is ever
 * created, and the POS offline sales queue is untouched.
 */

const MY_ATTENDANCE = "My Attendance";
const MANAGEMENT = "Attendance Management";

/* "7h 49m" / "37m" / "0m" — display only; the persisted value stays minutes. */
export function formatWorked(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours <= 0) return `${mins}m`;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

/* Existing onePOS conventions: en-GB formatting via Intl (no new library). */
export function formatClockTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatAttendanceDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* Network-level failure (device offline / server unreachable). apiRequest
 * throws plain Errors for these and Error(message) with a payload for API
 * rejections, so the distinction drives the offline warning copy. */
function isNetworkError(error) {
  const message = String(error?.message || "");
  return /failed to fetch|networkerror|load failed|fetch failed/i.test(message);
}

export default function AttendanceAdmin() {
  const [tab, setTab] = useState(MY_ATTENDANCE);
  const [perm, setPerm] = useState({ isAdmin: false, canManage: false, loaded: false });

  useEffect(() => {
    let active = true;
    apiRequest("/api/auth/me/permissions")
      .then((data) => {
        if (!active || !data.success) return;
        const isAdmin = data.data?.isAdmin === true;
        const codes = Array.isArray(data.data?.permissions) ? data.data.permissions : [];
        setPerm({ isAdmin, canManage: isAdmin || codes.includes("attendance.view"), loaded: true });
      })
      .catch(() => {
        /* Controls stay hidden; the API still enforces access server-side. */
        if (active) setPerm({ isAdmin: false, canManage: false, loaded: true });
      });
    return () => {
      active = false;
    };
  }, []);

  const tabs = [
    { key: MY_ATTENDANCE, label: MY_ATTENDANCE },
    ...(perm.canManage ? [{ key: MANAGEMENT, label: MANAGEMENT }] : []),
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Employees"
        subtitle="Clock in/out and attendance records"
      />
      <Tabs items={tabs} active={tab} onChange={setTab} />
      {tab === MY_ATTENDANCE && <MyAttendance />}
      {tab === MANAGEMENT && perm.canManage && <AttendanceManagement />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* My Attendance — self-service clock in/out + own history             */
/* ------------------------------------------------------------------ */

function MyAttendance() {
  const [status, setStatus] = useState(null); // /api/attendance/me data (null = never clocked in)
  const [statusFetchedAt, setStatusFetchedAt] = useState(null); // Date — anchor for the local elapsed interpolation
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); // clock-in/out request in flight
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nowTick, setNowTick] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const [me, history] = await Promise.all([
        apiRequest("/api/attendance/me"),
        apiRequest("/api/attendance/me/records"),
      ]);
      setStatus(me.success ? me.data : null);
      setStatusFetchedAt(Date.now());
      setRecords(history.success ? history.data || [] : []);
    } catch (err) {
      setError(err.message || "Unable to load attendance");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /* Local 30s tick ONLY while an open session is displayed — the elapsed
   * time updates in the browser without touching the backend. */
  useEffect(() => {
    if (status?.status !== "open") return undefined;
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [status?.status]);

  const isClockedIn = status?.status === "open";

  /* Server elapsed minutes (authoritative at fetch time) + minutes elapsed
   * locally since that fetch. Falls back to the server clockIn timestamp if
   * an older backend response lacks elapsedMinutes. */
  const elapsedMinutes = isClockedIn
    ? (status.elapsedMinutes ?? Math.max(0, Math.floor((Date.now() - new Date(status.clockIn).getTime()) / 60000))) +
      Math.floor((nowTick - (statusFetchedAt || nowTick)) / 60000)
    : null;

  const clockIn = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiRequest("/api/attendance/clock-in", { method: "POST", body: JSON.stringify({}) });
      if (!data.success) throw new Error(data.message || "Unable to record clock-in");
      setNotice("Clocked in.");
      await load();
    } catch (err) {
      if (isNetworkError(err)) {
        setError("You appear to be offline — the clock-in could NOT be recorded. Nothing was saved locally; reconnect and try again.");
      } else {
        setError(err.message || "Unable to record clock-in");
      }
      /* A duplicate clock-in (409) means the server knows an open session
       * this view did not — re-sync from the authority. */
      if (err?.status === 409) await load();
    } finally {
      setBusy(false);
    }
  };

  const clockOut = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await apiRequest("/api/attendance/clock-out", { method: "POST", body: JSON.stringify({}) });
      if (!data.success) throw new Error(data.message || "Unable to record clock-out");
      const worked = data.data?.workedMinutes;
      setNotice(worked != null ? `Clocked out — worked ${formatWorked(worked)}.` : "Clocked out.");
      await load();
    } catch (err) {
      if (isNetworkError(err)) {
        setError("You appear to be offline — the clock-out could NOT be recorded. Nothing was saved locally; reconnect and try again.");
      } else {
        setError(err.message || "Unable to record clock-out");
      }
      if (err?.status === 409) await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading attendance...</div>;
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && !error && <Alert tone="success">{notice}</Alert>}

      <Card>
        <CardHeader
          title="Attendance"
          actions={
            <Button variant="secondary" size="sm" onClick={load} title="Refresh from server">
              <RefreshCw size={14} className="inline mr-1" /> Refresh
            </Button>
          }
        />
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-slate-400" />
            <span className="text-sm text-slate-500">Status:</span>
            {isClockedIn ? (
              <Badge tone="success">Clocked in</Badge>
            ) : (
              <Badge tone="neutral">Not clocked in</Badge>
            )}
          </div>

          {isClockedIn ? (
            <>
              <div className="text-sm text-slate-600">
                Clocked in: <span className="font-semibold text-slate-800">{formatClockTime(status.clockIn)}</span>
                <span className="text-slate-400 text-xs ml-2">{formatAttendanceDate(status.clockIn)}</span>
              </div>
              <div className="text-sm text-slate-600">
                Worked: <span className="font-semibold text-slate-800 text-lg">{formatWorked(elapsedMinutes)}</span>
              </div>
              <Button onClick={clockOut} disabled={busy} title="Clock out">
                <LogOut size={15} className="inline mr-1" /> {busy ? "Clocking out..." : "Clock Out"}
              </Button>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-400">
                Attendance is recorded by the server clock. {status ? "Your most recent session is below." : "You have no attendance sessions yet."}
              </p>
              <Button onClick={clockIn} disabled={busy} title="Clock in">
                <LogIn size={15} className="inline mr-1" /> {busy ? "Clocking in..." : "Clock In"}
              </Button>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Attendance History" />
        {records.length === 0 ? (
          <EmptyState title="No attendance records" hint="Your clock in/out sessions will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  {["Date", "Clock In", "Clock Out", "Worked", "Status"].map((heading) => (
                    <th key={heading} className="text-left px-3 py-2 text-xs uppercase text-slate-500">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id} className="border-t">
                    <td className="px-3 py-2 text-xs text-slate-500">{formatAttendanceDate(record.clockIn)}</td>
                    <td className="px-3 py-2">{formatClockTime(record.clockIn)}</td>
                    <td className="px-3 py-2">{formatClockTime(record.clockOut)}</td>
                    <td className="px-3 py-2 font-semibold">{record.workedMinutes != null ? formatWorked(record.workedMinutes) : "—"}</td>
                    <td className="px-3 py-2">
                      {record.status === "open" ? <Badge tone="success">Clocked in</Badge> : <Badge tone="neutral">Completed</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attendance Management — attendance.view / admin-bypass only         */
/* ------------------------------------------------------------------ */

function AttendanceManagement() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest("/api/attendance");
      if (!data.success) throw new Error(data.message || "Unable to load attendance records");
      setRecords(data.data || []);
    } catch (err) {
      if (err?.status === 403) {
        setError("You do not have permission to view attendance records.");
      } else if (isNetworkError(err)) {
        setError("You appear to be offline — attendance records could not be loaded.");
      } else {
        setError(err.message || "Unable to load attendance records");
      }
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading attendance records...</div>;
  }

  if (error) {
    return (
      <div className="onepos-card onepos-card-body text-center">
        <h2 className="text-xl font-bold">Access denied</h2>
        <p className="text-sm text-slate-400 mt-2">{error}</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Attendance Management"
        actions={
          <Button variant="secondary" size="sm" onClick={load} title="Refresh from server">
            <RefreshCw size={14} className="inline mr-1" /> Refresh
          </Button>
        }
      />
      {records.length === 0 ? (
        <EmptyState title="No attendance records" hint="Staff clock in/out sessions will appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                {["Employee", "Store", "Date", "Clock In", "Clock Out", "Worked", "Status"].map((heading) => (
                  <th key={heading} className="text-left px-3 py-2 text-xs uppercase text-slate-500">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className="border-t">
                  <td className="px-3 py-2">{record.fullName || record.username || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{record.storeName || "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{formatAttendanceDate(record.clockIn)}</td>
                  <td className="px-3 py-2">{formatClockTime(record.clockIn)}</td>
                  <td className="px-3 py-2">{formatClockTime(record.clockOut)}</td>
                  <td className="px-3 py-2 font-semibold">{record.workedMinutes != null ? formatWorked(record.workedMinutes) : "—"}</td>
                  <td className="px-3 py-2">
                    {record.status === "open" ? <Badge tone="success">Clocked in</Badge> : <Badge tone="neutral">Completed</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
