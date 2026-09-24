import { useRef, useState } from "react";
import JarvisOrb, { ORB_STATES } from "./JarvisOrb.jsx";
import JarvisPanel from "./JarvisPanel.jsx";

/**
 * The application-level JARVES surface. The pocket is deliberately separate
 * from the orb so the orb remains the only interactive control in the corner.
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
      {open && (
        <JarvisPanel
          embedded={embedded}
          onClose={close}
          onActivityChange={setActivity}
        />
      )}
    </>
  );
}
