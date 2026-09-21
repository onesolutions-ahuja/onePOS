import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import useReportData from "./shared/useReportData.js";
import { getTill, getTillSession } from "../../services/reports.js";
import ReportTable from "./ReportTable.jsx";

/*
 * Daily Till Close report.
 *
 * Every cash figure comes from the backend: closed sessions carry the
 * authoritative expected_cash / closing_cash / cash_difference persisted at
 * close time (never recomputed here); open sessions show the server's live
 * position without an actual/variance (nothing has been counted yet).
 */

const money = (value) => `£${Number(value || 0).toFixed(2)}`;
const signedMoney = (value) => `${Number(value || 0) < 0 ? "−" : ""}£${Math.abs(Number(value || 0)).toFixed(2)}`;
const dateTime = (value) => (value ? new Date(value).toLocaleString() : "—");
const dateOnly = (value) => (value ? new Date(value).toLocaleDateString() : "—");

const VARIANCE_LABEL = { short: "Short", over: "Over", exact: "Exact" };
const VARIANCE_CLASS = {
  short: "bg-red-100 text-red-800",
  over: "bg-emerald-100 text-emerald-800",
  exact: "bg-slate-100 text-slate-700",
};

function VarianceBadge({ status, closed }) {
  if (!closed) return <span className="text-xs text-slate-400">Not counted</span>;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded ${VARIANCE_CLASS[status] || VARIANCE_CLASS.exact}`}>
      {VARIANCE_LABEL[status] || "Exact"}
    </span>
  );
}

/* Session detail: authoritative reconciliation + the cash-movement audit trail. */
function SessionDetail({ sessionId }) {
  const { data, loading, error } = useReportData(
    async () => {
      const response = await getTillSession(sessionId);
      if (!response.success) throw new Error(response.message);
      return response.data;
    },
    [sessionId],
    "Unable to load session detail"
  );

  if (loading) return <div className="p-3 text-xs text-slate-500">Loading session detail…</div>;
  if (error) return <div className="p-3 text-xs text-red-600">Unable to load session detail: {error}</div>;

  const { session, movements } = data;
  const cashIns = movements.filter((m) => m.type === "cash_in");
  const cashOuts = movements.filter((m) => m.type === "cash_out");
  const movementRow = (m) => (
    <tr key={m.id} className="border-t">
      <td className="px-3 py-1 text-xs">{dateTime(m.createdAt)}</td>
      <td className="px-3 py-1 text-xs">{m.username || "—"}</td>
      <td className="px-3 py-1 text-xs">{m.reason || "—"}</td>
      <td className={`px-3 py-1 text-xs text-right ${m.type === "cash_out" ? "text-red-700" : "text-emerald-700"}`}>
        {m.type === "cash_out" ? "−" : "+"}
        {money(m.amount)}
      </td>
    </tr>
  );

  return (
    <div className="bg-slate-50 border-t px-4 py-3 space-y-3">
      {/* Reconciliation — every value server-authoritative */}
      <div className="bg-white border rounded-lg p-3">
        <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Cash reconciliation</div>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Opening cash</dt><dd>{money(session.openingCash)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Cash sales</dt><dd>{money(session.cashSales)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Cash refunds</dt><dd>−{money(session.cashRefunds)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Cash in</dt><dd>{money(session.cashIn)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Cash out</dt><dd>−{money(session.cashOut)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Expected cash</dt><dd className="font-semibold">{money(session.expectedClosing)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Actual cash</dt><dd className="font-semibold">{session.actualClosing === null ? "—" : money(session.actualClosing)}</dd></div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Variance</dt>
            <dd>
              {session.difference === null ? "—" : signedMoney(session.difference)}{" "}
              <VarianceBadge closed={session.status === "closed"} status={session.varianceStatus} />
            </dd>
          </div>
        </dl>
      </div>

      {/* Cash movements */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="p-2 border-b text-xs font-semibold text-slate-500 uppercase">Cash in movements</div>
        {cashIns.length ? (
          <table className="w-full">
            <tbody>{cashIns.map(movementRow)}</tbody>
          </table>
        ) : (
          <div className="p-2 text-xs text-slate-500">No cash-in movements.</div>
        )}
      </div>
      <div className="bg-white border rounded-lg overflow-hidden">
        <div className="p-2 border-b text-xs font-semibold text-slate-500 uppercase">Cash out movements</div>
        {cashOuts.length ? (
          <table className="w-full">
            <tbody>{cashOuts.map(movementRow)}</tbody>
          </table>
        ) : (
          <div className="p-2 text-xs text-slate-500">No cash-out movements.</div>
        )}
      </div>
    </div>
  );
}

/* One session row (closed or still-open); expands into the session detail. */
function SessionRow({ session }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr className="border-t cursor-pointer hover:bg-slate-50" onClick={() => setExpanded((v) => !v)}>
        <td className="px-3 py-2 text-sm">
          <button aria-label={expanded ? "Collapse session detail" : "Expand session detail"} className="inline-flex items-center gap-1 text-slate-500">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span className="font-mono text-xs">{session.id?.slice(0, 8)}</span>
          </button>
        </td>
        <td className="px-3 py-2 text-sm">{dateOnly(session.businessDate || session.openedAt)}</td>
        <td className="px-3 py-2 text-sm">{session.terminal || "—"}</td>
        <td className="px-3 py-2 text-sm">{session.openedBy || "—"}</td>
        <td className="px-3 py-2 text-sm">{dateTime(session.openedAt)}</td>
        <td className="px-3 py-2 text-sm">{session.closedBy || "—"}</td>
        <td className="px-3 py-2 text-sm">{dateTime(session.closedAt)}</td>
        <td className="px-3 py-2 text-sm text-right">{money(session.openingCash)}</td>
        <td className="px-3 py-2 text-sm text-right">{money(session.cashSales)}</td>
        <td className="px-3 py-2 text-sm text-right">{money(session.cashIn)}</td>
        <td className="px-3 py-2 text-sm text-right">{money(session.cashOut)}</td>
        <td className="px-3 py-2 text-sm text-right">{money(session.cashRefunds)}</td>
        <td className="px-3 py-2 text-sm text-right font-semibold">{money(session.expectedClosing)}</td>
        <td className="px-3 py-2 text-sm text-right">{session.actualClosing === null ? "—" : money(session.actualClosing)}</td>
        <td className="px-3 py-2 text-sm text-right">
          {session.difference === null ? "—" : signedMoney(session.difference)}{" "}
          <VarianceBadge closed={session.status === "closed"} status={session.varianceStatus} />
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={15}>
            <SessionDetail sessionId={session.id} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function TillReport({ from, to }) {
  const { data, loading, error } = useReportData(
    async () => {
      const response = await getTill(from, to);
      if (!response.success) throw new Error(response.message);
      return response.data || { summary: null, sessions: [] };
    },
    [from, to],
    "Unable to load till report"
  );

  if (loading) return <ReportTable title="Daily Till Close" headers={[]} rows={[]} />;
  if (error) return <div className="p-6 text-sm text-slate-500 bg-white border rounded-xl">Unable to load till report: {error}</div>;

  const sessions = data?.sessions || [];
  const summary = data?.summary;

  const headers = [
    "Session", "Business date", "Till", "Opened by", "Opened", "Closed by", "Closed",
    "Opening", "Cash sales", "Cash in", "Cash out", "Refunds", "Expected", "Actual", "Variance",
  ];

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="p-4 border-b font-semibold flex items-center justify-between">
        <span>Daily Till Close</span>
        {sessions.length > 0 && (
          <span className="text-xs font-normal text-slate-500">
            {summary.sessions} session{summary.sessions === 1 ? "" : "s"} · Variance total{" "}
            <span className={summary.difference < 0 ? "text-red-700" : summary.difference > 0 ? "text-emerald-700" : ""}>
              {signedMoney(summary.difference)}
            </span>
          </span>
        )}
      </div>
      {sessions.length ? (
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50">
              {headers.map((h, i) => (
                <th key={h} className={`${i < 7 ? "text-left" : "text-right"} px-3 py-2 text-xs uppercase text-slate-500`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => <SessionRow key={s.id} session={s} />)}
          </tbody>
        </table>
      ) : (
        <div className="p-6 text-sm text-slate-500">No closed sessions for this date.</div>
      )}
    </div>
  );
}
