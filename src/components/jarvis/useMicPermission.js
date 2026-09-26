import { useEffect, useState } from "react";

/*
 * ONE source of mic access truth for the JARVES surface.
 *
 * The Permissions API is the authoritative browser state:
 *   granted → available      denied → blocked
 *   prompt  → available (grantable on request)
 * When the Permissions API itself is missing (older Safari) the indicator
 * stays optimistic — only a confirmed denial or a missing getUserMedia
 * (insecure context) ever shows the blocked state, mirroring how Windows
 * only flags a microphone that is actually unusable.
 */

export const MIC_STATES = Object.freeze({
  AVAILABLE: "available",
  BLOCKED: "blocked",
});

function permissionsQuerySupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.permissions?.query);
}

function micAvailableOnThisContext() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

async function queryMicPermissionState() {
  if (!permissionsQuerySupported()) return null;
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return status.state || null;
  } catch {
    return null;
  }
}

function stateFromPermission(permissionState) {
  if (permissionState === "denied") return MIC_STATES.BLOCKED;
  return MIC_STATES.AVAILABLE;
}

export function useMicPermission({ active = true } = {}) {
  const [micState, setMicState] = useState(() =>
    micAvailableOnThisContext() ? MIC_STATES.AVAILABLE : MIC_STATES.BLOCKED
  );

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    let status = null;

    const resolve = async () => {
      if (cancelled) return;
      if (!micAvailableOnThisContext()) {
        setMicState(MIC_STATES.BLOCKED);
        return;
      }
      const permissionState = await queryMicPermissionState();
      if (cancelled || permissionState === null) return;
      setMicState(stateFromPermission(permissionState));
    };

    resolve();

    if (permissionsQuerySupported()) {
      navigator.permissions
        .query({ name: "microphone" })
        .then((result) => {
          if (cancelled || !result) return;
          status = result;
          status.onchange = () => {
            if (cancelled) return;
            setMicState(stateFromPermission(result.state));
          };
        })
        .catch(() => { /* the indicator keeps its last known state */ });
    }

    /* Re-check when the tab regains focus so a settings change made in another
       window (or the OS) is reflected without a reload. */
    const onVisible = () => {
      if (document.visibilityState === "visible") resolve();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", resolve);

    return () => {
      cancelled = true;
      if (status) status.onchange = null;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", resolve);
    };
  }, [active]);

  return micState;
}

export default useMicPermission;
