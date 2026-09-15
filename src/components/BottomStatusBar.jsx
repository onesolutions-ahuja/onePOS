import { useEffect, useState } from "react";

export default function BottomStatusBar({ storeName, till, children }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const day = now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });

  const isTillOpen = till?.status === "open";

  return (
    <div className="fixed bottom-0 left-0 right-0 h-10 bg-slate-800 border-t border-slate-700 text-xs text-slate-300 flex items-center px-3 gap-4 z-40">
      <span className="text-slate-400">{day}</span>
      <span className="text-slate-400">{time}</span>

      {storeName && (
        <span className="flex items-center gap-1">
          <span className="text-slate-400">Store:</span>
          <span className="font-medium text-slate-200">{storeName}</span>
        </span>
      )}

      {till && (
        <span className="flex items-center gap-1">
          <span className="text-slate-400">Till:</span>
          <span className="font-medium text-slate-200">{till.terminal_name || till.name || "Till"}</span>
          <span className={`text-xs font-medium ${isTillOpen ? "text-emerald-400" : "text-amber-400"}`}>
            {isTillOpen ? "Open" : "Closed"}
          </span>
        </span>
      )}

      {children}
    </div>
  );
}
