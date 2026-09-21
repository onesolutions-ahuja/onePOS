/*
 * JARVIS AI assistant - Google Gemini provider (V1).
 *
 * One of possibly many providers behind the JARVIS provider interface
 * (services/jarvis/providers/index.js). This module is the ONLY place that
 * knows the Gemini REST API shape; routes and the JARVIS service never see
 * provider-specific details.
 *
 * Security:
 *  - the API key is read from GEMINI_API_KEY by the caller and passed in,
 *    it is held in this closure only;
 *  - it is sent in the `x-goog-api-key` HEADER, never in the URL/query string
 *    (URLs end up in logs, proxies and error messages);
 *  - it is never logged, never returned to the client and never included in
 *    an error message.
 *
 * Reliability: a hard timeout aborts the request (AbortController), exactly
 * like services/integrationDispatcher.js does for outbound integrations, so a
 * slow provider can never hang the request.
 */
import { JarvisError, JARVIS_ERROR_CODES } from "../errors.js";

export const GEMINI_PROVIDER_NAME = "gemini";

export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";

/*
 * `gemini-flash-latest` is an alias that always points at the current Flash
 * text model, so the assistant keeps working when a specific version is
 * retired. Pin a version with JARVIS_GEMINI_MODEL (e.g. gemini-3.6-flash or a
 * Flash-Lite model) when a fixed model is required.
 *
 * Latency note: Google documents that Gemini 3 and 2.5 series models "think"
 * before answering, and thinking is on by default across those series. The
 * `-latest` alias is hot-swapped to each new Flash release, so the model
 * behind it (and therefore its latency) can change without any change here.
 */
export const GEMINI_DEFAULT_MODEL = "gemini-flash-latest";

/*
 * Default request budget in milliseconds.
 *
 * A thinking-enabled Flash model can legitimately take longer than the 20s
 * this originally allowed for a short question, and a request that is aborted
 * while the model is still thinking surfaces to the user as
 * `provider_timeout` (504) even though nothing is broken. 45s is a safety
 * margin, not a target: pin a faster model with JARVIS_GEMINI_MODEL if
 * answers feel slow, or raise/lower this with JARVIS_AI_TIMEOUT_MS.
 */
export const GEMINI_DEFAULT_TIMEOUT_MS = 45000;

/* V1 answers questions; it does not brainstorm. Low temperature + a bounded
 * output keeps answers concise, fast and cheap. */
const GEMINI_TEMPERATURE = 0.2;
const GEMINI_MAX_OUTPUT_TOKENS = 1024;

/** Build the request body. Exported for tests/verification. */
export function buildGeminiRequestBody({ systemInstruction, message } = {}) {
  return {
    systemInstruction: { parts: [{ text: String(systemInstruction || "") }] },
    contents: [{ role: "user", parts: [{ text: String(message || "") }] }],
    generationConfig: {
      temperature: GEMINI_TEMPERATURE,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
    },
  };
}

/** Concatenate the text parts of the first candidate ("" when absent). */
export function extractGeminiAnswerText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

/** Short, log-only description of a failed Gemini response. */
function describeGeminiFailure(payload, httpStatus) {
  const providerMessage = payload?.error?.message;
  const blockReason = payload?.promptFeedback?.blockReason;
  if (providerMessage) return String(providerMessage).slice(0, 300);
  if (blockReason) return `blocked by prompt feedback (${blockReason})`;
  return `HTTP ${httpStatus}`;
}

/**
 * Whatever the provider says travels into the server log as `detail`. The key
 * travels in a header, so it should never appear in a provider message - but
 * this is the last line of defence: if it does, redact it.
 */
export function redactApiKey(text, apiKey) {
  const value = text === null || text === undefined ? "" : String(text);
  if (!apiKey) return value;
  return value.split(apiKey).join("[REDACTED]");
}

/**
 * Gemini provider.
 *
 * @returns {{
 *   name: string,
 *   model: string,
 *   isConfigured: () => boolean,
 *   describe: () => { provider: string, model: string, configured: boolean },
 *   generateAnswer: (input: { systemInstruction: string, message: string })
 *     => Promise<{ text: string, provider: string, model: string, finishReason: string|null, usage: object|null }>
 * }}
 */
export function createGeminiProvider({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.JARVIS_GEMINI_MODEL,
  baseUrl = GEMINI_API_BASE,
  timeoutMs = Number(process.env.JARVIS_AI_TIMEOUT_MS) || GEMINI_DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const resolvedModel = String(model || "").trim() || GEMINI_DEFAULT_MODEL;
  const resolvedBaseUrl = String(baseUrl || GEMINI_API_BASE).replace(/\/+$/, "");
  const resolvedTimeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : GEMINI_DEFAULT_TIMEOUT_MS;

  const isConfigured = () => Boolean(key);

  async function generateAnswer({ systemInstruction, message } = {}) {
    if (!isConfigured()) {
      throw new JarvisError(JARVIS_ERROR_CODES.PROVIDER_NOT_CONFIGURED, {
        detail: "GEMINI_API_KEY is not set",
        provider: GEMINI_PROVIDER_NAME,
      });
    }

    if (typeof fetchImpl !== "function") {
      throw new JarvisError(JARVIS_ERROR_CODES.PROVIDER_UNREACHABLE, {
        detail: "no fetch implementation available",
        provider: GEMINI_PROVIDER_NAME,
      });
    }

    const url = `${resolvedBaseUrl}/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), resolvedTimeoutMs);

    let response;
    let payload = null;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          /* Header, never a query parameter: the key must never appear in a URL. */
          "x-goog-api-key": key,
        },
        body: JSON.stringify(buildGeminiRequestBody({ systemInstruction, message })),
        signal: controller.signal,
      });
      payload = await response.json().catch(() => null);
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new JarvisError(JARVIS_ERROR_CODES.PROVIDER_TIMEOUT, {
          detail: `Gemini request exceeded ${resolvedTimeoutMs}ms`,
          provider: GEMINI_PROVIDER_NAME,
          cause: error,
        });
      }
      throw new JarvisError(JARVIS_ERROR_CODES.PROVIDER_UNREACHABLE, {
        detail: redactApiKey(`Gemini request failed: ${(error && error.message) || "network error"}`, key),
        provider: GEMINI_PROVIDER_NAME,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response || response.ok !== true) {
      throw new JarvisError(JARVIS_ERROR_CODES.PROVIDER_ERROR, {
        detail: redactApiKey(
          `Gemini error: ${describeGeminiFailure(payload, response?.status)}`,
          key
        ),
        provider: GEMINI_PROVIDER_NAME,
      });
    }

    const text = extractGeminiAnswerText(payload);
    const finishReason = payload?.candidates?.[0]?.finishReason || null;

    if (!text) {
      const blockReason = payload?.promptFeedback?.blockReason;
      const blocked =
        Boolean(blockReason) || finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT";
      throw new JarvisError(
        blocked ? JARVIS_ERROR_CODES.PROVIDER_BLOCKED : JARVIS_ERROR_CODES.EMPTY_RESPONSE,
        {
          detail: blocked
            ? `Gemini blocked the request (${blockReason || finishReason})`
            : `Gemini returned no text (finishReason=${finishReason || "unknown"})`,
          provider: GEMINI_PROVIDER_NAME,
        }
      );
    }

    const usage = payload?.usageMetadata || null;

    return {
      text,
      provider: GEMINI_PROVIDER_NAME,
      model: resolvedModel,
      finishReason,
      usage: usage
        ? {
            promptTokens: usage.promptTokenCount ?? null,
            answerTokens: usage.candidatesTokenCount ?? null,
            totalTokens: usage.totalTokenCount ?? null,
          }
        : null,
    };
  }

  return {
    name: GEMINI_PROVIDER_NAME,
    model: resolvedModel,
    timeoutMs: resolvedTimeoutMs,
    isConfigured,
    describe: () => ({
      provider: GEMINI_PROVIDER_NAME,
      model: resolvedModel,
      configured: isConfigured(),
      timeoutMs: resolvedTimeoutMs,
    }),
    generateAnswer,
  };
}
