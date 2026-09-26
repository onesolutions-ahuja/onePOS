import { Mic, MicOff } from "lucide-react";
import useMicPermission, { MIC_STATES } from "./useMicPermission.js";

/*
 * Microphone access indicator for JARVES — a STATUS light, not a control.
 *
 * Mirrors the Windows convention: a small mic glyph that reads as normal when
 * the system/browser grants microphone access, and as crossed-out when access
 * is denied or the context cannot capture audio at all (insecure origin,
 * missing API). It stays optically quiet inside the dock's glass language:
 * a soft glass chip whose glyph carries the state colour, plus a tiny status
 * dot, so an operator can read mic health from across the counter.
 */
export default function JarvisMicStatus({ className = "" }) {
  const micState = useMicPermission();
  const blocked = micState !== MIC_STATES.AVAILABLE;

  const label = blocked
    ? "Microphone access is blocked or unavailable"
    : "Microphone access is available";

  return (
    <span
      className={`jarvis-mic-status ${blocked ? "jarvis-mic-status--blocked" : ""} ${className}`}
      data-testid="jarvis-mic-status"
      data-mic-state={blocked ? "blocked" : "available"}
      role="img"
      aria-label={label}
      title={label}
    >
      {blocked ? <MicOff size={11} aria-hidden="true" /> : <Mic size={11} aria-hidden="true" />}
      <span className="jarvis-mic-status-dot" aria-hidden="true" />
    </span>
  );
}
