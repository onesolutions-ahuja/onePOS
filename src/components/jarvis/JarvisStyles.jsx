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
.jarvis-orb {
  position: relative;
  width: 58px;
  height: 58px;
  border-radius: 9999px;
  background: radial-gradient(circle at 50% 45%, #125a56 0%, #0d3b39 70%);
  box-shadow: 0 6px 18px rgba(16, 71, 68, 0.28), inset 0 0 0 1px rgba(215, 236, 234, 0.18);
  transition: transform 180ms ease, box-shadow 180ms ease;
}
.jarvis-orb:hover { transform: translateY(-1px) scale(1.03); box-shadow: 0 10px 24px rgba(16, 71, 68, 0.36); }
.jarvis-orb:active { transform: scale(0.97); }

.jarvis-orb-core {
  position: absolute;
  inset: 3px;
  border-radius: 9999px;
  background: radial-gradient(circle at 34% 28%, #eef7f6 0%, #b0d9d5 18%, #4fa69e 42%, #176F6A 68%, #104744 100%);
  box-shadow: inset 0 0 14px rgba(238, 247, 246, 0.28);
}
.jarvis-orb-sheen {
  position: absolute;
  inset: 1px;
  border-radius: 9999px;
  background: conic-gradient(
    from 0deg,
    rgba(238, 247, 246, 0) 0deg,
    rgba(130, 193, 187, 0.55) 70deg,
    rgba(238, 247, 246, 0) 150deg,
    rgba(47, 138, 130, 0.45) 250deg,
    rgba(238, 247, 246, 0) 360deg
  );
  opacity: 0.45;
  animation: jarvis-orb-sheen 7s linear infinite;
}
.jarvis-orb-halo {
  position: absolute;
  inset: -5px;
  border-radius: 9999px;
  border: 1px solid rgba(23, 111, 106, 0.4);
  opacity: 0.5;
  animation: jarvis-orb-halo 6.5s ease-in-out infinite;
}
.jarvis-orb-spark {
  position: absolute;
  top: 8px;
  right: 11px;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: #eef7f6;
  opacity: 0.85;
  animation: jarvis-orb-spark 3.2s ease-in-out infinite;
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

/* Assistant message entrance + typing indicator. */
.jarvis-message { animation: jarvis-message-in 220ms ease-out both; }
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
