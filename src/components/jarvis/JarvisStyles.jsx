/*
 * JARVIS assistant - self-contained visual styles.
 *
 * Rendered once by the assistant (an inline <style>), so the feature adds NO
 * changes to index.css, tailwind.config.js or the marketing stylesheet, and
 * every class is namespaced `jarvis-` to avoid touching existing markup.
 *
 * Theme: onePOS teal ramp from tailwind.config.js
 *   #0d3b39 900 · #104744 800 · #125a56 700 · #176F6A 600
 *   #2f8a82 500 · #4fa69e 400 · #82c1bb 300 · #d7ecea 100 · #eef7f6 50
 */

export const JARVIS_STYLES = `
/*
 * The Orb is a "living energy core": multiple gradient layers drift, orbit and
 * breathe continuously, even at idle. Every animation uses ONLY transform and
 * opacity (compositor-friendly) so a POS terminal can run it all day at
 * negligible CPU/GPU cost; filter is transitioned on hover only.
 */

.jarvis-orb {
  position: relative;
  width: 58px;
  height: 58px;
  border-radius: 9999px;
  background: radial-gradient(circle at 50% 45%, #125a56 0%, #0d3b39 70%);
  box-shadow: 0 6px 18px rgba(16, 71, 68, 0.28), inset 0 0 0 1px rgba(215, 236, 234, 0.18);
  transition: transform 180ms ease, box-shadow 180ms ease;
}
.jarvis-orb:hover { transform: translateY(-1px) scale(1.04); box-shadow: 0 10px 26px rgba(16, 71, 68, 0.4), 0 0 18px rgba(79, 166, 158, 0.35); }
.jarvis-orb:active { transform: scale(0.97); }

/* Outer breathing halo (aura) — always alive, subtly scaling. */
.jarvis-orb-halo {
  position: absolute;
  inset: -5px;
  border-radius: 9999px;
  border: 1px solid rgba(23, 111, 106, 0.4);
  opacity: 0.5;
  animation: jarvis-orb-halo 6.5s ease-in-out infinite;
}

/* Secondary ring: near-invisible at idle, becomes the listening ripple. */
.jarvis-orb-ring {
  position: absolute;
  inset: -6px;
  border-radius: 9999px;
  border: 1.5px solid rgba(16, 185, 129, 0.75);
  opacity: 0;
}

/* Core: clipped viewport for the internal energy layers. */
.jarvis-orb-core {
  position: absolute;
  inset: 3px;
  border-radius: 9999px;
  overflow: hidden;
  background: radial-gradient(circle at 40% 35%, #176F6A 0%, #104744 55%, #0d3b39 100%);
  box-shadow: inset 0 0 14px rgba(238, 247, 246, 0.22);
  transition: filter 200ms ease;
}
.jarvis-orb:hover .jarvis-orb-core { filter: brightness(1.14) saturate(1.1); }

/* Flow layer 1 — the big teal plasma blob, orbiting an off-centre pivot so
   the light visibly circles inside the core rather than pulsing in place. */
.jarvis-orb-flow {
  position: absolute;
  width: 150%;
  height: 150%;
  left: -25%;
  top: -25%;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 30%, rgba(130, 193, 187, 0.95) 0%, rgba(79, 166, 158, 0.55) 38%, rgba(79, 166, 158, 0) 70%);
  filter: blur(5px);
  opacity: 0.9;
  transform-origin: 62% 58%;
  animation: jarvis-orb-orbit 16s linear infinite;
}

/* Flow layer 2 — counter-drifting emerald lobe; the two layers use different
   periods so the combined motion never visibly repeats. */
.jarvis-orb-flow2 {
  position: absolute;
  width: 120%;
  height: 120%;
  left: -10%;
  top: -10%;
  border-radius: 50%;
  background: radial-gradient(circle at 68% 66%, rgba(52, 211, 153, 0.55) 0%, rgba(47, 138, 130, 0.35) 45%, rgba(47, 138, 130, 0) 72%);
  filter: blur(7px);
  opacity: 0.75;
  animation: jarvis-orb-drift 11s ease-in-out infinite alternate;
}

/* Rotating conic light sweep over the plasma. */
.jarvis-orb-sheen {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  background: conic-gradient(
    from 0deg,
    rgba(238, 247, 246, 0) 0deg,
    rgba(130, 193, 187, 0.5) 70deg,
    rgba(238, 247, 246, 0) 150deg,
    rgba(47, 138, 130, 0.4) 250deg,
    rgba(238, 247, 246, 0) 360deg
  );
  opacity: 0.4;
  animation: jarvis-orb-sheen 9s linear infinite;
}

/* Small highlight gliding across the surface, like light on liquid. */
.jarvis-orb-glint {
  position: absolute;
  top: 12%;
  left: 8%;
  width: 34%;
  height: 26%;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(238, 247, 246, 0.55) 0%, rgba(238, 247, 246, 0) 70%);
  filter: blur(2px);
  animation: jarvis-orb-glint 7.5s ease-in-out infinite alternate;
}

/* Active: listening - the presence leans forward and breathes teal/emerald. */
.jarvis-orb--listening { animation: jarvis-orb-listen 1.6s ease-out infinite; }
.jarvis-orb--listening .jarvis-orb-halo { border-color: rgba(16, 185, 129, 0.75); animation: jarvis-orb-ring 1.8s ease-out infinite; }
.jarvis-orb--listening .jarvis-orb-core {
  background: radial-gradient(circle at 34% 28%, #eef7f6 0%, #b0d9d5 16%, #4fa69e 38%, #0f766e 66%, #0d3b39 100%);
}

/* Active: thinking - the core stirs while an answer is in flight. */
.jarvis-orb--thinking .jarvis-orb-sheen { opacity: 0.85; animation-duration: 1.5s; }
.jarvis-orb--thinking .jarvis-orb-core { animation: jarvis-orb-think 1.6s ease-in-out infinite; }
.jarvis-orb--thinking .jarvis-orb-halo { border-color: rgba(130, 193, 187, 0.8); animation-duration: 2.2s; }

@keyframes jarvis-orb-sheen { to { transform: rotate(360deg); } }
@keyframes jarvis-orb-halo { 0%, 100% { opacity: 0.28; transform: scale(0.99); } 50% { opacity: 0.6; transform: scale(1.03); } }
@keyframes jarvis-orb-ring { 0% { opacity: 0.7; transform: scale(1); } 70% { opacity: 0; transform: scale(1.35); } 100% { opacity: 0; } }
@keyframes jarvis-orb-listen { 0% { box-shadow: 0 0 0 0 rgba(23, 111, 106, 0.5), 0 8px 22px rgba(16, 71, 68, 0.3); } 100% { box-shadow: 0 0 0 18px rgba(23, 111, 106, 0), 0 8px 22px rgba(16, 71, 68, 0.3); } }
@keyframes jarvis-orb-spark { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.95; } }
@keyframes jarvis-orb-think { 0%, 100% { transform: scale(1); } 50% { transform: scale(0.94); } }

/* The spark rides a slowly orbiting carrier; the spark itself only
   occasionally flares, so idle life stays subtle and never strobe-like. */
.jarvis-orb-spark-orbit {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  animation: jarvis-orb-orbit-slow 13s linear infinite;
}
.jarvis-orb-spark {
  position: absolute;
  top: 5px;
  left: 50%;
  margin-left: -3px;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: #eef7f6;
  box-shadow: 0 0 6px rgba(238, 247, 246, 0.9);
  animation: jarvis-orb-spark 5s ease-in-out infinite;
}

/* Listening: ripples radiate outward and the internal energy speeds up. */
.jarvis-orb--listening { animation: jarvis-orb-listen 1.7s ease-out infinite; }
.jarvis-orb--listening .jarvis-orb-ring { animation: jarvis-orb-ring 1.8s ease-out infinite; }
.jarvis-orb--listening .jarvis-orb-flow { animation-duration: 6s; }
.jarvis-orb--listening .jarvis-orb-flow2 { animation-duration: 5s; }
.jarvis-orb--listening .jarvis-orb-core {
  background: radial-gradient(circle at 38% 32%, #0f766e 0%, #0d3b39 60%, #0d3b39 100%);
}

/* Thinking: faster, busier rotation — continuous flow, no flashing. */
.jarvis-orb--thinking .jarvis-orb-sheen { opacity: 0.75; animation-duration: 2.6s; }
.jarvis-orb--thinking .jarvis-orb-flow { animation-duration: 5.5s; }
.jarvis-orb--thinking .jarvis-orb-flow2 { animation-duration: 4.5s; }
.jarvis-orb--thinking .jarvis-orb-core { animation: jarvis-orb-think 2.4s ease-in-out infinite; }
.jarvis-orb--thinking .jarvis-orb-halo { border-color: rgba(130, 193, 187, 0.8); animation-duration: 2.6s; }

@keyframes jarvis-orb-sheen { to { transform: rotate(360deg); } }
@keyframes jarvis-orb-orbit { to { transform: rotate(360deg); } }
@keyframes jarvis-orb-orbit-slow { to { transform: rotate(-360deg); } }
@keyframes jarvis-orb-drift {
  0% { transform: translate3d(-12%, -8%, 0) scale(1); }
  50% { transform: translate3d(10%, 6%, 0) scale(1.12); }
  100% { transform: translate3d(6%, 12%, 0) scale(0.94); }
}
@keyframes jarvis-orb-glint {
  0% { transform: translate3d(0, 0, 0); opacity: 0.35; }
  100% { transform: translate3d(110%, 60%, 0); opacity: 0.8; }
}
@keyframes jarvis-orb-halo { 0%, 100% { opacity: 0.28; transform: scale(0.99); } 50% { opacity: 0.6; transform: scale(1.04); } }
@keyframes jarvis-orb-ring { 0% { opacity: 0.75; transform: scale(1); } 70% { opacity: 0; transform: scale(1.4); } 100% { opacity: 0; transform: scale(1.4); } }
@keyframes jarvis-orb-listen { 0% { box-shadow: 0 0 0 0 rgba(23, 111, 106, 0.5), 0 8px 22px rgba(16, 71, 68, 0.3); } 100% { box-shadow: 0 0 0 18px rgba(23, 111, 106, 0), 0 8px 22px rgba(16, 71, 68, 0.3); } }
@keyframes jarvis-orb-spark { 0%, 62%, 100% { opacity: 0.18; transform: scale(0.8); } 72% { opacity: 1; transform: scale(1.25); } 82% { opacity: 0.35; transform: scale(0.9); } }
@keyframes jarvis-orb-think { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.035); } }

/* Response: a new answer enters with a brief emerald settle glow that fades
   back to the normal message style — a short "active" moment, then calm. */
.jarvis-message { animation: jarvis-message-in 220ms ease-out both; }
.jarvis-message:last-child { animation: jarvis-message-in 220ms ease-out both, jarvis-message-settle 900ms ease-out 120ms both; }
@keyframes jarvis-message-settle {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
  30% { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.35); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}
@keyframes jarvis-message-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
.jarvis-dot { animation: jarvis-dot 1.1s ease-in-out infinite; }
.jarvis-dot:nth-child(2) { animation-delay: 160ms; }
.jarvis-dot:nth-child(3) { animation-delay: 320ms; }
@keyframes jarvis-dot { 0%, 100% { opacity: 0.3; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-2px); } }

/* Microphone control: teal idle, clear listening state. */
.jarvis-mic { transition: background-color 150ms ease, color 150ms ease, box-shadow 150ms ease; }
.jarvis-mic--listening { animation: jarvis-mic-pulse 1.4s ease-out infinite; }
@keyframes jarvis-mic-pulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.55); } 100% { box-shadow: 0 0 0 14px rgba(16, 185, 129, 0); } }

/* Respect the operator's motion preference: presence stays, motion stops. */
@media (prefers-reduced-motion: reduce) {
  .jarvis-orb,
  .jarvis-orb *,
  .jarvis-message,
  .jarvis-dot,
  .jarvis-mic {
    animation: none !important;
    transition: none !important;
  }
}

@media (max-width: 640px) {
  .jarvis-orb { width: 52px; height: 52px; }
}
`;

/** Renders the shared JARVIS stylesheet once per mounted surface. */
export default function JarvisStyles() {
  return <style data-jarvis-styles="true">{JARVIS_STYLES}</style>;
}
