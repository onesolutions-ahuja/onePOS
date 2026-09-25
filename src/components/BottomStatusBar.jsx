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
    <div
      className="fixed z-40 flex items-center gap-4 px-4 py-2 text-xs"
      style={{
        left: 0,
        right: 0,
        bottom: "1px",
        width: "100vw",
        minHeight: "42px",
        borderRadius: 0,
        borderTop: "1px solid rgba(255,255,255,0.12)",
        borderBottom: "0",
        borderLeft: "0",
        borderRight: "0",
        background: "linear-gradient(180deg, rgba(22,31,37,0.85) 0%, rgba(8,15,20,0.98) 100%)",
        boxShadow: "0 -1px 0 rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.10)",
        backdropFilter: "blur(18px) saturate(170%)",
        WebkitBackdropFilter: "blur(18px) saturate(170%)",
        color: "rgba(220, 252, 231, 0.92)",
      }}
    >
      <span
        className="font-medium tracking-[0.14em] uppercase"
        style={{
          background: "linear-gradient(90deg, #ecfdf5 0%, #a7f3d0 34%, #d1fae5 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          textShadow: "0 1px 0 rgba(5, 18, 22, 0.35)",
        }}
      >
        {day}
      </span>
      <span
        className="font-medium tracking-[0.14em] uppercase"
        style={{
          background: "linear-gradient(90deg, #ecfdf5 0%, #a7f3d0 34%, #d1fae5 100%)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          textShadow: "0 1px 0 rgba(5, 18, 22, 0.35)",
        }}
      >
        {time}
      </span>

      {storeName && (
        <span className="flex items-center gap-1.5">
          <span className="text-emerald-100/70">Store:</span>
          <span className="font-semibold text-emerald-50 drop-shadow-[0_1px_0_rgba(4,26,24,0.65)]">{storeName}</span>
        </span>
      )}

      {till && (
        <span className="flex items-center gap-1.5">
          <span className="text-emerald-100/70">Till:</span>
          <span className="font-semibold text-emerald-50 drop-shadow-[0_1px_0_rgba(4,26,24,0.65)]">{till.terminal_name || till.name || "Till"}</span>
          <span className={`text-xs font-semibold ${isTillOpen ? "text-emerald-300" : "text-amber-300"}`}>
            {isTillOpen ? "Open" : "Closed"}
          </span>
        </span>
      )}

      {children}
    </div>
  );
}
