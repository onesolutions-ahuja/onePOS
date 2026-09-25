import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import JarvisOrb, { ORB_STATES } from "./JarvisOrb.jsx";
import JarvisPanel from "./JarvisPanel.jsx";

/**
 * The application-level JARVES surface. The pocket is deliberately separate
 * from the orb so the orb remains the only interactive control in the corner.
 *
 * `embedded` places the orb inline in the shared AdminNavDock's reserved centre
 * zone — the SAME treatment on the admin (/app) pages and the Till/POS screen,
 * because both mount the one dock component. The orb keeps floating above the
 * bar: there is no pedestal behind it.
 */
export default function JarvisCorner({ embedded = false }) {
  const [open, setOpen] = useState(false);
  const [activity, setActivity] = useState(null);
  const launcherRef = useRef(null);
  const state = activity || ORB_STATES.IDLE;
  const close = () => {
    setOpen(false);
    setActivity(null);
    launcherRef.current?.focus();
  };

  return (
    <>
      <div className={`jarvis-corner${embedded ? " jarvis-dock-anchor" : ""}`} data-testid="jarvis-corner">
        <JarvisOrb
          state={state}
          open={open}
          onClick={() => setOpen(true)}
          buttonRef={launcherRef}
        />
      </div>
      {open &&
        /* Portal to document.body: the dock's <nav> uses backdrop-filter, which
           turns every fixed-position descendant into nav-relative positioning —
           the overlay would be trapped "inside" the navbar. Portalled out, the
           overlay is viewport-anchored again and sits above the dock (z-960). */
        createPortal(
          <JarvisPanel
            embedded={embedded}
            onClose={close}
            onActivityChange={setActivity}
          />,
          document.body
        )}
    </>
  );
}
