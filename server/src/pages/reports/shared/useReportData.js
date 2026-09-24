import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared data-loading hook for report components.
 *
 * Encapsulates the common loading / error / retry pattern used by the
 * Reports pages. The fetcher is kept in a ref so manual reloads (e.g. the
 * "Run" button) always execute with the latest closure values, while the
 * automatic load only re-runs when `deps` change.
 *
 * @param {() => Promise<any>} fetcher  Async function that resolves to the report data.
 * @param {Array} deps              Dependency list controlling automatic reloads (default: mount only).
 * @param {string} fallbackError    Error message used when the thrown error has no message.
 * @returns {{ data: any, loading: boolean, error: string, reload: () => Promise<void> }}
 */
export default function useReportData(fetcher, deps = [], fallbackError = "Unable to load report") {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await fetcherRef.current();
      setData(result);
    } catch (err) {
      setError(err?.message || fallbackError);
    } finally {
      setLoading(false);
    }
  }, [fallbackError]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: load };
}