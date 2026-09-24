import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { apiRequest } from "../services/api.js";

const DEBOUNCE_MS = 250;

export default function PlatformSearch({ mobile = false }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ loading: false, results: [], error: "" });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);

  const grouped = useMemo(() => state.results.reduce((groups, result) => {
    const key = result.objectLabel || "Records";
    (groups[key] ||= []).push(result);
    return groups;
  }, {}), [state.results]);
  const flatResults = useMemo(() => Object.values(grouped).flat(), [grouped]);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      setState({ loading: false, results: [], error: "" });
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setState((current) => ({ ...current, loading: true, error: "" }));
      try {
        const response = await apiRequest(`/api/platform/search?q=${encodeURIComponent(value)}`);
        if (!cancelled) {
          setState({ loading: false, results: response.data?.results || [], error: "" });
          setOpen(true);
          setActiveIndex(-1);
        }
      } catch (error) {
        if (!cancelled) setState({ loading: false, results: [], error: error.status === 401 ? "" : "Search is unavailable" });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function select(index) {
    const result = flatResults[index];
    if (!result?.destination) return;
    window.location.assign(result.destination);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
      return;
    }
    if (!flatResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % flatResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? flatResults.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      select(activeIndex);
    }
  }

  const searchControl = (
    <>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2" style={{ color: "var(--onepos-text-muted)" }} />
      <input
        type="search"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search records"
        aria-expanded={open}
        aria-controls="platform-search-results"
        placeholder="Search records…"
        data-testid="platform-search-input"
        className="w-full rounded-md border pl-9 pr-9 text-[13px] outline-none focus:ring-2 focus:ring-blue-500/40"
        style={{ backgroundColor: "var(--onepos-surface-muted)", borderColor: "var(--onepos-border)", color: "var(--onepos-text-primary)", height: "var(--onepos-control-height, 36px)" }}
      />
      {query && (
        <button type="button" onClick={() => { setQuery(""); setOpen(false); }} aria-label="Clear record search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1" style={{ color: "var(--onepos-text-muted)" }}>
          <X size={14} />
        </button>
      )}
      {open && query.trim().length >= 2 && (
        <div id="platform-search-results" role="listbox" className="absolute left-0 right-0 top-full z-[90] mt-2 max-h-96 overflow-auto rounded-xl border p-1 shadow-xl" style={{ backgroundColor: "var(--onepos-surface-raised)", borderColor: "var(--onepos-border)", color: "var(--onepos-text-primary)" }}>
          {state.loading && <div className="px-3 py-3 text-xs" style={{ color: "var(--onepos-text-muted)" }}>Searching…</div>}
          {!state.loading && state.error && <div className="px-3 py-3 text-xs text-red-600">{state.error}</div>}
          {!state.loading && !state.error && !state.results.length && <div className="px-3 py-3 text-xs" style={{ color: "var(--onepos-text-muted)" }}>No results</div>}
          {!state.loading && Object.entries(grouped).map(([label, results]) => (
            <div key={label}>
              <div className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--onepos-text-muted)" }}>{label}</div>
              {results.map((result) => {
                const index = flatResults.indexOf(result);
                return (
                  <button key={`${result.objectId}:${result.recordId}`} type="button" role="option" aria-selected={index === activeIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => select(index)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-black/5" style={{ backgroundColor: index === activeIndex ? "var(--onepos-surface-muted)" : "transparent" }}>
                    <span className="block truncate text-[13px] font-medium">{result.primaryLabel}</span>
                    {result.secondaryLabel && <span className="block truncate text-[11px]" style={{ color: "var(--onepos-text-muted)" }}>{result.secondaryLabel}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (mobile && !open) {
    return <button type="button" onClick={() => setOpen(true)} aria-label="Search records" data-testid="platform-search-mobile" className="rounded p-2 hover:bg-black/5" style={{ color: "var(--onepos-text-body)" }}><Search size={18} /></button>;
  }
  return (
    <div ref={rootRef} className={mobile ? "fixed inset-x-3 top-16 z-[100] w-auto md:hidden" : "relative w-full max-w-md"} data-testid="platform-search">
      {searchControl}
    </div>
  );
}
