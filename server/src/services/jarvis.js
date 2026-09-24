/*
 * JARVIS assistant - frontend client for the EXISTING authenticated backend.
 *
 * The UI never talks to an AI provider: it goes through the same
 * services/api.js wrapper every other onePOS screen uses (which attaches the
 * existing `onepos_token` JWT as a Bearer header). The only endpoints touched
 * are the ones the backend already exposes:
 *
 *   POST /api/jarvis          ask a question
 *   GET  /api/jarvis/status   is JARVIS configured? (provider/model/timeout)
 *
 * No keys, no provider SDKs, no direct fetch calls, no database access.
 * Kept free of React so the request/error contract is unit-testable.
 */
import { apiRequest } from "./api.js";

/** Mirrors JARVIS_MAX_MESSAGE_LENGTH in services/jarvis/service.js. */
export const JARVIS_MAX_MESSAGE_LENGTH = 2000;

/** Validate a question before spending a request on it. */
export function validateJarvisQuestion(value) {
  const question = typeof value === "string" ? value.trim() : "";
  if (!question) {
    return { ok: false, reason: "empty", message: "Type a question for JARVIS first." };
  }
  if (question.length > JARVIS_MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      reason: "too-long",
      message: `Questions are limited to ${JARVIS_MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  return { ok: true, question };
}

/** Ask JARVIS a question. Resolves to { answer, provider, model, latencyMs }. */
export async function askJarvis(message) {
  const validation = validateJarvisQuestion(message);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.message), { code: "INVALID_QUESTION" });
  }

  const payload = await apiRequest("/api/jarvis", {
    method: "POST",
    body: JSON.stringify({ message: validation.question }),
  });

  const answer = typeof payload?.data?.answer === "string" ? payload.data.answer.trim() : "";
  if (payload?.success !== true || !answer) {
    throw Object.assign(new Error("JARVIS returned an empty answer. Please try again."), {
      code: "EMPTY_ANSWER",
    });
  }

  return {
    answer,
    provider: payload.data.provider ?? null,
    model: payload.data.model ?? null,
    latencyMs: payload.data.latencyMs ?? null,
  };
}

/** Whether JARVIS is configured on the server. Best-effort - never throws. */
export async function fetchJarvisStatus() {
  try {
    const payload = await apiRequest("/api/jarvis/status");
    return {
      available: payload?.data?.available === true,
      provider: payload?.data?.provider ?? null,
      model: payload?.data?.model ?? null,
      timeoutMs: payload?.data?.timeoutMs ?? null,
      error: null,
    };
  } catch (error) {
    return { available: false, provider: null, model: null, timeoutMs: null, error };
  }
}

const ERROR_MESSAGES = {
  provider_not_configured: "JARVES isn't switched on for this server yet. Ask an administrator to add the AI key.",
  provider_unsupported: "JARVES is misconfigured on this server. Ask an administrator to check the AI provider.",
  provider_timeout: "JARVES took too long to answer. Try again, or ask a shorter question.",
  provider_unreachable: "JARVES can't reach the AI service right now. Try again in a moment.",
  provider_error: "The AI service returned an error. Try again in a moment.",
  provider_blocked: "JARVES can't answer that one. Try rephrasing your question.",
  empty_response: "JARVES returned an empty answer. Try asking again.",
  INVALID_QUESTION: "Type a question for JARVES first.",
  EMPTY_ANSWER: "JARVES returned an empty answer. Try asking again.",
  jarves_not_enabled: "JARVES is not enabled for your user account. Ask an administrator to enable it in Settings → Users.",
  tool_permission_denied: "You don't have permission to view that data, so JARVES can't answer it for you.",
  tool_unavailable: "That JARVES capability isn't available right now. Try again later.",
};

const RETRYABLE_CODES = new Set([
  "provider_timeout",
  "provider_unreachable",
  "provider_error",
  "provider_blocked",
  "empty_response",
  "EMPTY_ANSWER",
]);

/** A safe, human message for anything the JARVIS request can throw. */
export function describeJarvisError(error) {
  const code = error?.code;

  if (code === "AUTH_REQUIRED" || error?.status === 401) {
    return "Your onePOS session has expired. Sign in again to use JARVIS.";
  }
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  /* apiRequest lets a failed fetch reject with a TypeError (offline, DNS). */
  if (error instanceof TypeError) {
    return "JARVIS can't reach the onePOS server right now. Check the connection and try again.";
  }
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  return "JARVIS couldn't answer that. Please try again.";
}

/** Whether asking the same question again could reasonably succeed. */
export function isRetryableJarvisError(error) {
  return RETRYABLE_CODES.has(error?.code);
}

/** Short provider/model badge text for the panel header, or "". */
export function describeJarvisProvider(status) {
  if (!status?.provider) return "";
  return status.model ? `${status.provider} · ${status.model}` : String(status.provider);
}
