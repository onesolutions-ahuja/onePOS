import useReportData from "./shared/useReportData.js";
import { getTill } from "../../services/reports.js";
import ReportTable from "./ReportTable.jsx";

const money = (value) => `£${Number(value || 0).toFixed(2)}`;
const dateTime = (value) => (value ? new Date(value).toLocaleString() : "—");

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

  if (loading) return <ReportTable title="Till & Cash" headers={[]} rows={[]} />;
  if (error) return <div className="p-6 text-sm text-slate-500 bg-white border rounded-xl">Unable to load till report: {error}</div>;

  const sessions = data?.sessions || [];
  const summary = data?.summary;

  const rows = sessions.map((s) => [
    s.terminal || "—",
    s.status === "closed" ? "Closed" : "Open",
    dateTime(s.openedAt),
    dateTime(s.closedAt),
    money(s.openingCash),
    money(s.cashIn),
    money(s.cashOut),
    money(s.cashSales),
    money(s.expectedClosing),
    s.actualClosing === null ? "—" : money(s.actualClosing),
    s.difference === null ? "—" : money(s.difference),
  ]);

  if (summary && sessions.length) {
    rows.push([
      "Totals",
      `${summary.sessions} session${summary.sessions === 1 ? "" : "s"}`,
      "",
      "",
      money(summary.openingCash),
      money(summary.cashIn),
      money(summary.cashOut),
      money(summary.cashSales),
      money(summary.expectedClosing),
      money(summary.actualClosing),
      money(summary.difference),
    ]);
  }

  return (
    <ReportTable
      title="Till & Cash"
      exportName="till"
      headers={["Terminal", "Status", "Opened", "Closed", "Opening", "Cash In", "Cash Out", "Cash Sales", "Expected", "Actual", "Diff"]}
      rows={rows}
    />
  );
}