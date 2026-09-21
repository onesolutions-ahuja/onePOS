/*
 * JARVIS AI assistant - shared error model (V1 foundation).
 *
 * Every failure inside JARVIS is normalised to a JarvisError carrying:
 *   - `code`          : a stable, client-safe machine code (fixed enum)
 *   - `detail`        : internal developer detail (server log only)
 *   - `httpStatus`    : the status the API should return
 *   - `publicMessage` : a generic, client-safe sentence
 *
 * The public message NEVER contains provider response bodies, URLs, request
 * payloads or credentials - a provider error can echo back request state, and
 * the request carries the API key in a header. Only `detail` (server-side log)
 * may contain provider text, and it is truncated.
 */

export const JARVIS_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  PROVIDER_NOT_CONFIGURED: "provider_not_configured",
  PROVIDER_UNSUPPORTED: "provider_unsupported",
  PROVIDER_TIMEOUT: "provider_timeout",
  PROVIDER_UNREACHABLE: "provider_unreachable",
  PROVIDER_ERROR: "provider_error",
  PROVIDER_BLOCKED: "provider_blocked",
  EMPTY_RESPONSE: "empty_response",
  UNKNOWN: "unknown",
});

const HTTP_STATUS_BY_CODE = Object.freeze({
  [JARVIS_ERROR_CODES.INVALID_REQUEST]: 400,
  [JARVIS_ERROR_CODES.PROVIDER_NOT_CONFIGURED]: 503,
  [JARVIS_ERROR_CODES.PROVIDER_UNSUPPORTED]: 503,
  [JARVIS_ERROR_CODES.PROVIDER_TIMEOUT]: 504,
  [JARVIS_ERROR_CODES.PROVIDER_UNREACHABLE]: 502,
  [JARVIS_ERROR_CODES.PROVIDER_ERROR]: 502,
  [JARVIS_ERROR_CODES.PROVIDER_BLOCKED]: 502,
  [JARVIS_ERROR_CODES.EMPTY_RESPONSE]: 502,
  [JARVIS_ERROR_CODES.UNKNOWN]: 500,
});

const PUBLIC_MESSAGE_BY_CODE = Object.freeze({
  [JARVIS_ERROR_CODES.INVALID_REQUEST]: "Invalid JARVIS request",
  [JARVIS_ERROR_CODES.PROVIDER_NOT_CONFIGURED]:
    "JARVIS is not available: no AI provider credentials are configured on this server",
  [JARVIS_ERROR_CODES.PROVIDER_UNSUPPORTED]: "JARVIS is not available: the configured AI provider is not supported",
  [JARVIS_ERROR_CODES.PROVIDER_TIMEOUT]: "JARVIS could not reach the AI service in time. Please try again.",
  [JARVIS_ERROR_CODES.PROVIDER_UNREACHABLE]: "JARVIS could not reach the AI service. Please try again.",
  [JARVIS_ERROR_CODES.PROVIDER_ERROR]: "The AI service returned an error. Please try again.",
  [JARVIS_ERROR_CODES.PROVIDER_BLOCKED]: "The AI service declined to answer that request.",
  [JARVIS_ERROR_CODES.EMPTY_RESPONSE]: "The AI service returned an empty answer. Please try again.",
  [JARVIS_ERROR_CODES.UNKNOWN]: "JARVIS could not answer that question. Please try again.",
});

/** Internal detail is logged, never returned - keep it short. */
const MAX_DETAIL_LENGTH = 500;

export class JarvisError extends Error {
  constructor(code, { message = null, detail = null, provider = null, cause = null } = {}) {
    const resolvedCode = code || JARVIS_ERROR_CODES.UNKNOWN;
    super(message || detail || resolvedCode);
    this.name = "JarvisError";
    this.code = resolvedCode;
    this.provider = provider;
    this.detail = detail ? String(detail).slice(0, MAX_DETAIL_LENGTH) : null;
    if (cause) this.cause = cause;
  }

  get httpStatus() {
    return jarvisHttpStatus(this.code);
  }

  get publicMessage() {
    return jarvisPublicMessage(this.code);
  }
}

export function jarvisHttpStatus(code) {
  return HTTP_STATUS_BY_CODE[code] || HTTP_STATUS_BY_CODE[JARVIS_ERROR_CODES.UNKNOWN];
}

export function jarvisPublicMessage(code) {
  return PUBLIC_MESSAGE_BY_CODE[code] || PUBLIC_MESSAGE_BY_CODE[JARVIS_ERROR_CODES.UNKNOWN];
}

export function isJarvisError(value) {
  return value instanceof JarvisError;
}

/**
 * Wrap anything thrown by a provider/service into a JarvisError. Already
 * normalised JARVIS errors pass through unchanged so the original code
 * (timeout vs. upstream error vs. not configured) is preserved.
 */
export function toJarvisError(error, fallbackCode = JARVIS_ERROR_CODES.UNKNOWN) {
  if (isJarvisError(error)) return error;
  return new JarvisError(fallbackCode, {
    detail: (error && error.message) || String(error) || "unknown JARVIS failure",
    cause: error || null,
  });
}
