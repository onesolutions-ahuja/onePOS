/*
 * JARVES Orb - the assistant's presence in the till UI.
 *
 * Deliberately NOT a microphone button: it is a living MULTI-COLOUR "energy
 * core" - teal, cyan, emerald, violet and pink plasma layers orbit, drift and
 * bleed through each other while a slow hue drift continuously reshuffles the
 * whole spectrum, so JARVES reads as alive and thinking even at idle (never a
 * plain teal ball, and never a static circular gradient). A light sweep
 * rotates, two glints glide across the surface, the aura breathes and a spark
 * occasionally flares on its own orbit. Every animation is transform/opacity
 * only (plus one cheap hue-rotate on the small core) so it stays negligible
 * for an all-day POS terminal. Microphone control lives INSIDE the panel;
 * this orb only opens/closes JARVES.
 *
 * Branding note: the user-facing identity was rebranded from JARVIS to
 * JARVES; the code keeps its original jarvis-* naming for stability.
 *
 * Placement is provided by the application-level JarvisCorner surface.
 * States: idle | listening | thinking | response (a short energetic flare
 * when an answer lands, then a smooth return to idle).
 */
import JarvisStyles from "./JarvisStyles.jsx";

export const ORB_STATES = Object.freeze({
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  RESPONSE: "response",
});

/* Copy shown under the orb while a state is active (hidden while open). */
const STATE_COPY = Object.freeze({
  [ORB_STATES.LISTENING]: "Listening…",
  [ORB_STATES.THINKING]: "Thinking…",
  [ORB_STATES.RESPONSE]: "Here you go",
});

function JarvisVideo({ src = "/jarves.mp4" }) {
  // The source asset already contains the complete JARVES animation. Rendering
  // it as native video avoids a permanent WebGL/Three.js runtime for a 50px
  // launcher and preserves the supplied video without synthetic deformation.
  return (
    <video
      src={src}
      className="jarvis-orb-video"
      data-legacy-layer="jarvis-orb-core"
      aria-hidden="true"
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
    />
  );
}

function describeOrbState(state, open) {
  if (open) return "JARVES panel is open";
  if (state === ORB_STATES.LISTENING) return "JARVES is listening - open the panel";
  if (state === ORB_STATES.THINKING) return "JARVES is thinking - open the panel";
  if (state === ORB_STATES.RESPONSE) return "JARVES has an answer - open the panel";
  return "Ask JARVES";
}

export default function JarvisOrb({ state = ORB_STATES.IDLE, open = false, onClick, buttonRef, className = "" }) {
  const label = describeOrbState(state, open);

  return (
    <div
      className={`relative z-40 flex flex-col items-center gap-1 ${className}`}
      data-testid="jarvis-orb-host"
    >
      <JarvisStyles />
      <div className="jarvis-orb-container" data-testid="jarvis-orb-container">
        <button
          type="button"
          ref={buttonRef}
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
          <JarvisVideo />
        </button>
      </div>
      {STATE_COPY[state] && !open && (
        <span className="text-[10px] font-medium text-blue-800 select-none" data-testid="jarvis-orb-state" role="status">
          {STATE_COPY[state]}
        </span>
      )}
    </div>
  );
}