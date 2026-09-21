/*
 * JARVIS Orb - the assistant's presence in the till UI.
 *
 * Deliberately NOT a microphone button: it is a living "energy core" — teal
 * plasma layers orbit and drift inside the core, a light sweep rotates, a
 * glint slides across the surface, the aura breathes and a spark occasionally
 * flares on its own orbit. It is always moving, even at idle, but every
 * animation is transform/opacity only so it is cheap enough for an all-day
 * POS terminal. Microphone control lives INSIDE the panel; this orb only
 * opens/closes JARVIS.
 *
 * Placement: fixed above the bottom status bar (z-40 - below the z-50 modals
 * and the mobile cart sheet), so it never sits on top of till controls.
 * Idle is deliberately subtle; motion only increases while active.
 */
import JarvisStyles from "./JarvisStyles.jsx";

export const ORB_STATES = Object.freeze({
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
});

function describeOrbState(state, open) {
  if (open) return "JARVIS panel is open";
  if (state === ORB_STATES.LISTENING) return "JARVIS is listening - open the panel";
  if (state === ORB_STATES.THINKING) return "JARVIS is thinking - open the panel";
  return "Ask JARVIS";
}

export default function JarvisOrb({ state = ORB_STATES.IDLE, open = false, onClick, className = "" }) {
  const label = describeOrbState(state, open);

  return (
    <div
      className={`fixed z-40 right-3 sm:right-5 bottom-14 flex flex-col items-center gap-1 ${className}`}
      data-testid="jarvis-orb-host"
    >
      <JarvisStyles />
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="jarvis-orb"
        data-state={state}
        className={`jarvis-orb jarvis-orb--${state} rounded-full outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600`}
      >
        <span className="jarvis-orb-halo" aria-hidden="true" />
        <span className="jarvis-orb-ring" aria-hidden="true" />
        <span className="jarvis-orb-core" aria-hidden="true">
          <span className="jarvis-orb-flow" aria-hidden="true" />
          <span className="jarvis-orb-flow2" aria-hidden="true" />
          <span className="jarvis-orb-sheen" aria-hidden="true" />
          <span className="jarvis-orb-glint" aria-hidden="true" />
        </span>
        <span className="jarvis-orb-spark-orbit" aria-hidden="true">
          <span className="jarvis-orb-spark" aria-hidden="true" />
        </span>
      </button>
      <span
        className="text-[10px] font-semibold tracking-[0.18em] text-blue-800 bg-white/85 px-1.5 py-0.5 rounded-full shadow-sm select-none"
        data-testid="jarvis-orb-label"
        aria-hidden="true"
      >
        JARVIS
      </span>
      {state !== ORB_STATES.IDLE && (
        <span className="text-[10px] font-medium text-blue-800 select-none" data-testid="jarvis-orb-state" role="status">
          {state === ORB_STATES.LISTENING ? "Listening…" : "Thinking…"}
        </span>
      )}
    </div>
  );
}
