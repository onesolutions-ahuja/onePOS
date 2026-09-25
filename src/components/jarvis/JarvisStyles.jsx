/*

 * JARVES assistant - self-contained visual styles.

 *

 * Rendered once by the assistant (an inline <style>), so the feature adds NO

 * changes to index.css, tailwind.config.js or the marketing stylesheet, and

 * every class is namespaced \`jarvis-\` to avoid touching existing markup.

 *

 * Orb design language: a MULTI-COLOUR living energy core - teal, cyan, blue,

 * emerald, violet and soft pink plasma layers orbit, drift and bleed through

 * each other while a slow hue drift continuously reshuffles the whole

 * spectrum. Nothing reads as a static circular gradient: at idle the light

 * visibly circles, glints glide and the aura breathes, so JARVES reads as

 * alive and thinking. Performance: every continuous animation is

 * transform/opacity only (compositor-friendly; the single hue-rotate runs on

 * the small core), so an all-day POS terminal runs it at negligible cost.

 *

 * onePOS teal ramp (tailwind.config.js) remains the base:

 *   #0d3b39 900 | #104744 800 | #125a56 700 | #176F6A 600

 *   #2f8a82 500 | #4fa69e 400 | #82c1bb 300 | #d7ecea 100 | #eef7f6 50

 * Accent spectrum: cyan #22d3ee, emerald #34d399, violet #a855f7,

 * pink/magenta #ec4899.

 */



export const JARVIS_STYLES = `

:root {

  --dock-height: 60px;

  --dock-center-zone: 120px;

  --jarvis-orb-size: 65px;

}



.admin-nav-dock {

  height: var(--dock-height);

}



/* ------------------------------------------------------------ dock metrics */



/* Single source of truth for the dock bar's dimensions: the dock JSX and the

   panel overlay below both consume these variables, so the CSS and the JSX

   can never quote different numbers. The orb is intentionally taller than the

   bar (65px in 60px): it rises \~2.5px above the top edge of the bar. */





/* -------------------------------------------------------- corner pocket */



.jarvis-corner {

  position: fixed;

  z-index: 40;

  left: 50%;

  bottom: clamp(4px, 1vw, 10px);

  transform: translateX(-50%);

  width: max-content;

  height: auto;

  pointer-events: none;

}

.jarvis-corner > [data-testid="jarvis-orb-host"] {

  position: fixed;

  left: 50%;

  bottom: max(40px, calc(env(safe-area-inset-bottom) + 40px));

  transform: translateX(-50%);

  pointer-events: none;

}

.jarvis-corner.jarvis-dock-anchor {

  /* In-flow member of the dock's flex row: the dock reserves the centre zone

     (w-[var(--dock-center-zone)] in AdminNavDock.jsx — same number as the

     variable above) and this anchor fills exactly that box, so the orb can

     never overlap the quick-access icons on either side. */

  width: 100%;

  position: relative;

  left: auto;

  bottom: auto;

  transform: none;

  display: grid;

  /* The orb (65px) is taller than the bar (60px): bottom-align it so the

     overflow rises above the bar's top edge instead of past its flush bottom. */

  place-items: end center;

  z-index: 2;

}

.jarvis-corner.jarvis-dock-anchor > [data-testid="jarvis-orb-host"] {

  position: relative;

  left: auto;

  bottom: auto;

  transform: none;

}

/* Orb state copy ("Listening…") must not add height inside the dock bar. */

.jarvis-corner.jarvis-dock-anchor [data-testid="jarvis-orb-state"] {

  display: none;

}

/* Dock-embedded orb (admin AND till): the glass cradle rises above the bar

   while the orb remains optically centred in the reserved middle zone. */

.jarvis-corner.jarvis-dock-anchor {

  --jarvis-circle-size: calc(var(--jarvis-orb-size) * 1.2);

}

.jarvis-corner.jarvis-dock-anchor .jarvis-orb-halo { inset: -5px; }

.jarvis-corner [data-testid="jarvis-orb"],

.jarvis-corner [data-testid="jarvis-orb-label"],

.jarvis-corner [data-testid="jarvis-orb-state"] {

  pointer-events: auto;

}



/* The dock owns the embedded launcher. Its panel is a sibling overlay rather

   than a child of the dock, so it can rise above the dock without being clipped

   by the dock's scroll/overflow context. */

.jarvis-panel-overlay {

  z-index: 960;

  pointer-events: none;

}

.jarvis-panel-overlay--dock {

  align-items: flex-end;

  justify-content: center;

  /* Reserve the real dock height (--dock-height, same variable the dock bar

     uses) plus breathing room, so the prompt/input row is never occluded. */

  padding: 0.75rem 0.75rem calc(var(--dock-height) + 16px + env(safe-area-inset-bottom));

}

.jarvis-panel-overlay--dock > .jarvis-panel-backdrop {

  bottom: calc(var(--dock-height) + 16px + env(safe-area-inset-bottom));

  pointer-events: auto;

}

.jarvis-panel-overlay--dock > [data-testid="jarvis-panel"] {

  width: min(400px, calc(100vw - 1.5rem));

  max-height: min(78dvh, calc(100dvh - var(--dock-height) - 5.5rem - env(safe-area-inset-bottom)));

  pointer-events: auto;

}



/* ---------------------------------------------------- dock bar geometry */



/* The bar is a floating pill: its height is fixed to --dock-height (the 65px

   orb rises above it), while the gap under the bar and the full 32px rounding

   live in AdminNavDock.jsx / index.css. */





/* ------------------------------------------------------------- orb base */



.jarvis-orb {

  position: relative;

  z-index: 1;

  width: var(--jarvis-orb-size);

  height: var(--jarvis-orb-size);

  border-radius: 50%;

  background: radial-gradient(circle at 35% 24%, #effdff 0%, #83efff 12%, #29c9f3 28%, #3478e8 48%, #9253e9 72%, #182765 100%);

  box-shadow:

    0 4px 14px rgba(12, 36, 83, 0.35),

    0 0 24px rgba(77, 218, 255, 0.4),

    inset 0 0 0 1px rgba(235, 253, 255, 0.6);

  transition: transform 180ms ease, box-shadow 180ms ease;

}

.jarvis-orb-container {

  --jarvis-orb-size: 65px; /* taller than the 60px bar: rises above its top edge */

  --jarvis-circle-size: calc(var(--jarvis-orb-size) * 1.2);

  width: var(--jarvis-circle-size);

  height: var(--jarvis-circle-size);

  display: grid;

  place-items: center;

  flex: 0 0 var(--jarvis-circle-size);

  border-radius: 50%;

  position: relative;

  background: transparent;

  border: 0;

  box-shadow: none;

}

.jarvis-orb-container::before {
  content: "";
  position: absolute;
  inset: -7px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, rgba(17,22,28,0.98) 0%, rgba(10,16,21,0.98) 42%, rgba(6,11,16,0.98) 70%, rgba(3,8,12,0.98) 100%);
  border: 1px solid rgba(8,15,22,0.88);
  box-shadow: 0 8px 18px rgba(4,26,24,0.32), 0 0 0 1px rgba(8,15,22,0.72);
  z-index: 0;
  pointer-events: none;
}

.jarvis-orb:hover {

  transform: translateY(-1px) scale(1.05);

  box-shadow:

    0 10px 26px rgba(13, 59, 57, 0.45),

    0 0 30px rgba(34, 211, 238, 0.3),

    inset 0 0 0 1px rgba(215, 236, 234, 0.28);

}

.jarvis-orb:active { transform: scale(0.97); }



/* Hover/touch: the whole aurora brightens (opacity transitions are cheap). */

.jarvis-orb-flow, .jarvis-orb-flow2, .jarvis-orb-flow3, .jarvis-orb-flow4,

.jarvis-orb-sheen, .jarvis-orb-glint, .jarvis-orb-glint2 {

  transition: opacity 200ms ease;

}

.jarvis-orb:hover .jarvis-orb-flow { opacity: 1; }

.jarvis-orb:hover .jarvis-orb-flow2 { opacity: 0.95; }

.jarvis-orb:hover .jarvis-orb-flow3 { opacity: 0.95; }

.jarvis-orb:hover .jarvis-orb-flow4 { opacity: 0.9; }

.jarvis-orb:hover .jarvis-orb-sheen { opacity: 0.6; }



/* Outer breathing halo (aura) - always alive, subtly scaling. */

.jarvis-orb-halo {

  position: absolute;

  inset: -5px;

  border-radius: 9999px;

  border: 1px solid rgba(34, 211, 238, 0.5);

  opacity: 0.5;

  animation: jarvis-orb-halo 6.5s ease-in-out infinite;

}



/* Secondary ring: near-invisible at idle, becomes the listening ripple. */

.jarvis-orb-ring {

  position: absolute;

  inset: -6px;

  border-radius: 9999px;

  border: 1.5px solid rgba(52, 211, 153, 0.75);

  opacity: 0;

}



/* Core: clipped viewport for the internal energy layers. The slow hue drift

   continuously reshuffles every colour through the spectrum even at idle -

   this is the "JARVES is alive" heartbeat, never a static gradient. */

.jarvis-orb-core {

  position: absolute;

  inset: 3px;

  border-radius: 9999px;

  overflow: hidden;

  background:

    radial-gradient(circle at 34% 22%, rgba(255, 255, 255, 0.95) 0 4%, rgba(142, 245, 255, 0.75) 15%, transparent 35%),

    radial-gradient(circle at 70% 76%, rgba(255, 74, 221, 0.78), transparent 48%),

    radial-gradient(circle at 30% 72%, rgba(29, 178, 255, 0.84), transparent 54%),

    #243b9b;

  box-shadow: inset 0 0 14px rgba(238, 247, 246, 0.45);

  animation: jarvis-orb-crystal 12s ease-in-out infinite alternate;

}



/* Flow layer 1 - the big teal plasma blob, orbiting an off-centre pivot so

   the light visibly circles inside the core rather than pulsing in place. */

.jarvis-orb-flow {

  position: absolute;

  width: 150%;

  height: 150%;

  left: -25%;

  top: -25%;

  border-radius: 50%;

  background: linear-gradient(168deg, transparent 28%, rgba(232, 255, 255, 0.96) 39%, rgba(36, 224, 255, 0.95) 46%, rgba(255, 92, 227, 0.92) 53%, rgba(131, 75, 255, 0.78) 61%, transparent 72%);

  filter: blur(2px);

  opacity: 0.92;

  transform-origin: 62% 58%;

  animation: jarvis-orb-orbit 16s linear infinite;

}



/* Flow layer 2 - emerald lobe, counter-drifting; different periods mean the

   combined motion never visibly repeats. */

.jarvis-orb-flow2 {

  position: absolute;

  width: 120%;

  height: 120%;

  left: -10%;

  top: -10%;

  border-radius: 50%;

  background: linear-gradient(12deg, transparent 28%, rgba(34, 203, 255, 0.82) 41%, rgba(255, 67, 212, 0.88) 49%, rgba(255, 239, 255, 0.82) 55%, transparent 69%);

  filter: blur(3px);

  opacity: 0.84;

  animation: jarvis-orb-drift 11s ease-in-out infinite alternate;

}



/* Flow layer 3 - violet/purple energy, counter-orbiting the teal blob so

   distinct hues visibly pass through each other. */

.jarvis-orb-flow3 {

  position: absolute;

  width: 115%;

  height: 115%;

  left: -8%;

  top: -14%;

  border-radius: 50%;

  background: radial-gradient(circle at 60% 32%, rgba(168, 85, 247, 0.6) 0%, rgba(124, 58, 237, 0.35) 42%, rgba(124, 58, 237, 0) 70%);

  filter: blur(8px);

  opacity: 0.7;

  transform-origin: 38% 62%;

  animation: jarvis-orb-orbit-slow 19s linear infinite;

}



/* Flow layer 4 - cyan/blue current, drifting against layer 2. */

.jarvis-orb-flow4 {

  position: absolute;

  width: 130%;

  height: 130%;

  left: -15%;

  top: -15%;

  border-radius: 50%;

  background: radial-gradient(circle at 30% 70%, rgba(34, 211, 238, 0.55) 0%, rgba(14, 116, 144, 0.3) 46%, rgba(14, 116, 144, 0) 74%);

  filter: blur(9px);

  opacity: 0.65;

  animation: jarvis-orb-drift-alt 14s ease-in-out infinite alternate;

}



.jarvis-orb-core::before,

.jarvis-orb-core::after {

  content: "";

  position: absolute;

  inset: -35%;

  border-radius: 50%;

  pointer-events: none;

}

.jarvis-orb-core::before {

  background: conic-gradient(

    from 20deg,

    transparent 0 28%,

    rgba(63, 229, 255, 0.75) 34%,

    rgba(255, 78, 221, 0.88) 40%,

    transparent 48% 68%,

    rgba(155, 93, 255, 0.7) 75%,

    transparent 82%

  );

  filter: blur(4px);

  animation: jarvis-orb-ribbon 7s linear infinite;

}

.jarvis-orb-core::after {

  inset: 5%;

  border: 1px solid rgba(232, 255, 255, 0.4);

  box-shadow: inset 0 0 9px rgba(214, 250, 255, 0.35);

}



/* Rotating conic light sweep over the plasma. */

.jarvis-orb-sheen {

  position: absolute;

  inset: 0;

  border-radius: 9999px;

  background: conic-gradient(

    from 0deg,

    rgba(238, 247, 246, 0) 0deg,

    rgba(34, 211, 238, 0.45) 70deg,

    rgba(238, 247, 246, 0) 150deg,

    rgba(168, 85, 247, 0.4) 250deg,

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



/* Second glint in soft pink/magenta, offset path and period, so warm and cool

   highlights cross the surface at different times. */

.jarvis-orb-glint2 {

  position: absolute;

  bottom: 10%;

  right: 6%;

  width: 30%;

  height: 24%;

  border-radius: 50%;

  background: radial-gradient(ellipse at center, rgba(236, 72, 153, 0.5) 0%, rgba(236, 72, 153, 0) 70%);

  filter: blur(2.5px);

  animation: jarvis-orb-glint-alt 9.5s ease-in-out infinite alternate;

}



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

  box-shadow: 0 0 6px rgba(34, 211, 238, 0.9);

  animation: jarvis-orb-spark 5s ease-in-out infinite;

}



/* ------------------------------------------------------------- states */



/* Listening: brighter multi-colour flow, faster orbiting and an outward

   emerald ripple - visually obvious that JARVES is listening. */

.jarvis-orb--listening { animation: jarvis-orb-listen 1.7s ease-out infinite; }

.jarvis-orb--listening .jarvis-orb-ring { animation: jarvis-orb-ring 1.8s ease-out infinite; }

.jarvis-orb--listening .jarvis-orb-flow { animation-duration: 6s; opacity: 1; }

.jarvis-orb--listening .jarvis-orb-flow2 { animation-duration: 5s; opacity: 0.95; }

.jarvis-orb--listening .jarvis-orb-flow3 { animation-duration: 7s; opacity: 0.9; }

.jarvis-orb--listening .jarvis-orb-flow4 { animation-duration: 5.5s; opacity: 0.9; }

.jarvis-orb--listening .jarvis-orb-core {

  background: radial-gradient(circle at 38% 32%, #0f766e 0%, #0d5c58 45%, #0d3b39 100%);

  animation: jarvis-orb-hue 12s linear infinite;

}

.jarvis-orb--listening .jarvis-orb-halo { border-color: rgba(52, 211, 153, 0.75); }



/* Thinking: faster, more complex motion - the sweep, the counter-orbits and

   the hue drift all accelerate while an answer is in flight. No flashing. */

.jarvis-orb--thinking .jarvis-orb-sheen { opacity: 0.8; animation-duration: 2.4s; }

.jarvis-orb--thinking .jarvis-orb-flow { animation-duration: 5.5s; }

.jarvis-orb--thinking .jarvis-orb-flow2 { animation-duration: 4.5s; }

.jarvis-orb--thinking .jarvis-orb-flow3 { animation-duration: 6s; }

.jarvis-orb--thinking .jarvis-orb-flow4 { animation-duration: 4.8s; }

.jarvis-orb--thinking .jarvis-orb-core { animation: jarvis-orb-hue 10s linear infinite; }

.jarvis-orb--thinking .jarvis-orb-spark { animation-duration: 2.2s; }

.jarvis-orb--thinking .jarvis-orb-halo { border-color: rgba(168, 85, 247, 0.7); animation-duration: 2.6s; }



/* Response: one short energetic flare when an answer lands, then the orb

   settles smoothly back to idle (this is a moment, not a resting state). */

.jarvis-orb--response { animation: jarvis-orb-response 1.6s ease-out 1 both; }

.jarvis-orb--response .jarvis-orb-core { animation: jarvis-orb-hue 4s linear infinite; }

.jarvis-orb--response .jarvis-orb-sheen { opacity: 0.9; animation-duration: 1.4s; }

.jarvis-orb--response .jarvis-orb-flow { animation-duration: 3.5s; }

.jarvis-orb--response .jarvis-orb-flow2 { animation-duration: 3s; }

.jarvis-orb--response .jarvis-orb-flow3 { animation-duration: 3.8s; }

.jarvis-orb--response .jarvis-orb-flow4 { animation-duration: 3.2s; }

.jarvis-orb--response .jarvis-orb-spark { animation: jarvis-orb-spark 1.2s ease-in-out infinite; }



/* ------------------------------------------------------ WebGL orb surface */



/* The button remains the interaction surface; the transparent canvas carries

   the dimensional knot so it can sit over any POS background. */

.jarvis-orb {

  background: transparent;

  border: 0;

  box-shadow: none;

  overflow: visible;

}

.jarvis-orb-video {

  position: absolute;

  inset: 0;

  width: var(--jarvis-orb-size);

  height: var(--jarvis-orb-size);

  display: block;

  pointer-events: none;

  transform: none;

  border-radius: 50%;

  object-fit: cover;

  clip-path: circle(50% at 50% 50%);

  background: transparent;

  mix-blend-mode: screen;

  filter:

    drop-shadow(0 0 3px rgba(114, 221, 255, 0.55))

    drop-shadow(0 3px 8px rgba(52, 24, 117, 0.28));

}

.jarvis-orb:hover {

  box-shadow: none;

}



/* --------------------------------------------------------- keyframes */



@keyframes jarvis-orb-sheen { to { transform: rotate(360deg); } }

@keyframes jarvis-orb-orbit { to { transform: rotate(360deg); } }

@keyframes jarvis-orb-orbit-slow { to { transform: rotate(-360deg); } }

@keyframes jarvis-orb-drift {

  0% { transform: translate3d(-12%, -8%, 0) scale(1); }

  50% { transform: translate3d(10%, 6%, 0) scale(1.12); }

  100% { transform: translate3d(6%, 12%, 0) scale(0.94); }

}

@keyframes jarvis-orb-drift-alt {

  0% { transform: translate3d(10%, 8%, 0) scale(1.08); }

  50% { transform: translate3d(-8%, -6%, 0) scale(0.95); }

  100% { transform: translate3d(-4%, 10%, 0) scale(1.1); }

}

@keyframes jarvis-orb-glint {

  0% { transform: translate3d(0, 0, 0); opacity: 0.35; }

  100% { transform: translate3d(110%, 60%, 0); opacity: 0.8; }

}

@keyframes jarvis-orb-glint-alt {

  0% { transform: translate3d(0, 0, 0); opacity: 0.3; }

  100% { transform: translate3d(-105%, -55%, 0); opacity: 0.75; }

}

/* The continuous colour drift of the whole aurora (idle -> full spectrum). */

@keyframes jarvis-orb-hue { to { filter: hue-rotate(360deg); } }

@keyframes jarvis-orb-crystal {

  0% { transform: scale(0.98); filter: saturate(0.95) brightness(0.95); }

  50% { transform: scale(1.03); filter: saturate(1.3) brightness(1.12); }

  100% { transform: scale(1); filter: saturate(1.08) brightness(1); }

}

@keyframes jarvis-orb-ribbon {

  from { transform: rotate(0deg) scale(0.9); }

  to { transform: rotate(360deg) scale(1.08); }

}

@keyframes jarvis-orb-halo { 0%, 100% { opacity: 0.28; transform: scale(0.99); } 50% { opacity: 0.6; transform: scale(1.04); } }

@keyframes jarvis-orb-ring { 0% { opacity: 0.7; transform: scale(1); } 70% { opacity: 0; transform: scale(1.4); } 100% { opacity: 0; } }

@keyframes jarvis-orb-listen { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45), 0 8px 22px rgba(13, 59, 57, 0.35); } 100% { box-shadow: 0 0 0 18px rgba(16, 185, 129, 0), 0 8px 22px rgba(13, 59, 57, 0.35); } }

@keyframes jarvis-orb-spark { 0%, 62%, 100% { opacity: 0.18; transform: scale(0.8); } 72% { opacity: 1; transform: scale(1.25); } 82% { opacity: 0.35; transform: scale(0.9); } }

/* Response flare: one cyan/violet pulse + brief lift, then back to rest. */

@keyframes jarvis-orb-response {

  0% { box-shadow: 0 6px 18px rgba(13, 59, 57, 0.35), 0 0 0 0 rgba(34, 211, 238, 0.55); transform: scale(1); }

  35% { box-shadow: 0 10px 30px rgba(13, 59, 57, 0.4), 0 0 26px rgba(34, 211, 238, 0.5); transform: scale(1.08); }

  70% { box-shadow: 0 6px 18px rgba(13, 59, 57, 0.35), 0 0 14px rgba(168, 85, 247, 0.35); transform: scale(1.02); }

  100% { box-shadow: 0 6px 18px rgba(13, 59, 57, 0.35), 0 0 0 0 rgba(34, 211, 238, 0); transform: scale(1); }

}



/* ------------------------------------------------- panel messages + mic */



/* A new answer enters with a brief emerald settle glow that fades back to the

   normal message style - a short "active" moment, then calm. */

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

  .jarvis-orb-container {

    --jarvis-orb-size: 46px; /* 40px + 15% (unchanged) */

  }

  .jarvis-corner:not(.jarvis-dock-anchor) { bottom: max(4px, env(safe-area-inset-bottom)); }

}

`;



/*\* Renders the shared JARVES stylesheet once per mounted surface. */

export default function JarvisStyles() {

  return <style data-jarvis-styles="true">{JARVIS_STYLES}</style>;

}
