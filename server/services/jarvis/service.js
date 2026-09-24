/*
 * JARVIS AI assistant - service layer (V1).
 *
 * The service is what routes/jarvis.js talks to. It owns:
 *   - request normalisation/validation (defence in depth: the route validates
 *     too, the service never trusts its caller);
 *   - the system instruction (prompt.js) plus the authenticated session
 *     context;
 *   - the context allow-list - ONLY the fields in JARVIS_CONTEXT_FIELDS are
 *     ever forwarded to an AI provider. V1 sends no database data at all:
 *     the caller cannot accidentally leak rows/records into a prompt.
 *   - error normalisation/logging via the shared JARVIS error model.
 *
 * It knows nothing about Gemini/OpenAI/Ollama - that lives behind `provider`.
 */
import { buildJarvisSystemInstruction, buildJarvisToolNotice, JARVIS_SYSTEM_INSTRUCTION, JARVIS_CONTEXT_FIELDS } from "./prompt.js";
import { JarvisError, JARVIS_ERROR_CODES, isJarvisError, toJarvisError } from "./errors.js";
import { formatToolResultBlock } from "./tools/index.js";

/** V1 bound: a question, not a document. */
export const JARVIS_MAX_MESSAGE_LENGTH = 2000;

/**
 * Accept a user question or return null. Only a non-empty string within the
 * length bound is valid - objects, arrays, numbers, blank strings and
 * oversized text are rejected (route -> 400).
 */
export function normalizeJarvisMessage(raw, { maxLength = JARVIS_MAX_MESSAGE_LENGTH } = {}) {
  if (typeof raw !== "string") return null;
  const message = raw.trim();
  if (!message) return null;
  if (message.length > maxLength) return null;
  return message;
}

/**
 * Keep only the allow-listed session fields. Anything else a caller passes
 * (rows, tokens, configuration, ...) is dropped before it can reach a prompt.
 */
export function sanitizeJarvisContext(context = {}) {
  const source = context && typeof context === "object" ? context : {};
  const safe = {};
  for (const field of JARVIS_CONTEXT_FIELDS) {
    if (source[field] !== undefined) safe[field] = source[field];
  }
  if (Array.isArray(safe.permissions)) {
    safe.permissions = safe.permissions.filter((code) => typeof code === "string" && code.trim());
  }
  return safe;
}

/**
 * Build the JARVIS service around an AI provider.
 *
 * @param {{ provider: object, baseInstruction?: string, logger?: Console, maxMessageLength?: number, tools?: object|null }} options
 *        `tools` is the optional read-only tool registry from
 *        services/jarvis/tools/index.js ({ matchTool, executeTool }). When
 *        provided, a matched question runs its tool server-side BEFORE the AI
 *        call and the (non-secret) result grounds the prompt. The AI itself
 *        never gains database access.
 */
export function createJarvisService({
  provider,
  baseInstruction = JARVIS_SYSTEM_INSTRUCTION,
  logger = console,
  maxMessageLength = JARVIS_MAX_MESSAGE_LENGTH,
  tools = null,
} = {}) {
  if (!provider || typeof provider.generateAnswer !== "function") {
    throw new Error("createJarvisService requires an AI provider exposing generateAnswer()");
  }

  const providerName = provider.name || "unknown";
  const model = provider.model || null;
  /* The provider's effective request budget when it exposes one. Surfaced by
     describe() so the status endpoint can answer "which timeout is active?"
     without ever exposing credentials. */
  const timeoutMs = Number(provider.timeoutMs) > 0 ? Number(provider.timeoutMs) : null;

  function isConfigured() {
    if (typeof provider.isConfigured === "function") return provider.isConfigured() === true;
    return true;
  }

  function describe() {
    return { provider: providerName, model, configured: isConfigured(), timeoutMs };
  }

  /**
   * Ask JARVIS a question.
   *
   * @param {{ message: string, context?: object }} input
   * @returns {Promise<{ answer: string, provider: string, model: string|null, latencyMs: number, usage: object|null }>}
   */
  async function ask({ message, context = {} } = {}) {
    const question = normalizeJarvisMessage(message, { maxLength: maxMessageLength });
    if (!question) {
      throw new JarvisError(JARVIS_ERROR_CODES.INVALID_REQUEST, {
        detail: `message must be a non-empty string of at most ${maxMessageLength} characters`,
        provider: providerName,
      });
    }

    if (!isConfigured()) {
      throw new JarvisError(JARVIS_ERROR_CODES.PROVIDER_NOT_CONFIGURED, {
        detail: `AI provider "${providerName}" has no credentials configured`,
        provider: providerName,
      });
    }

    const safeContext = sanitizeJarvisContext(context);
    const startedAt = Date.now();

    /*
     * Server-side tool pass (read-only). Gemini never chooses tools and never
     * runs them - the tool executes inside the existing permission model and
     * only a non-secret summary is handed to the prompt. Degradation ladder
     * (pinned by tests):
     *   - a PERMISSION failure is a real access decision and surfaces as-is
     *     (403 tool_permission_denied) - no data was read, nothing is leaked;
     *   - any other tool failure degrades SAFELY to the general assistant:
     *     an explicit "no tool data could be loaded" notice is attached to the
     *     system instruction so the model answers from general onePOS
     *     knowledge and is anchored against inventing figures.
     */
    let groundingBlock = null;
    let toolFailed = false;
    if (tools && typeof tools.matchTool === "function" && typeof tools.executeTool === "function") {
      try {
        const match = tools.matchTool(question);
        if (match?.name) {
          const toolResult = await tools.executeTool(match.name, safeContext);
          const grounding = formatToolResultBlock(toolResult);
          if (grounding) groundingBlock = grounding;
        }
      } catch (toolError) {
        if (isJarvisError(toolError) && toolError.code === JARVIS_ERROR_CODES.TOOL_PERMISSION_DENIED) {
          throw toolError;
        }
        toolFailed = true;
        logger?.warn?.(
          `JARVES tool pass failed, degrading to the general assistant: ${(toolError && toolError.message) || toolError}`
        );
      }
    }

    try {
      const result = await provider.generateAnswer({
        systemInstruction: buildJarvisSystemInstruction({
          baseInstruction,
          context: safeContext,
          toolNotice: buildJarvisToolNotice({ grounding: groundingBlock, failed: toolFailed }),
        }),
        message: question,
      });

      const answer = typeof result?.text === "string" ? result.text.trim() : "";
      if (!answer) {
        throw new JarvisError(JARVIS_ERROR_CODES.EMPTY_RESPONSE, {
          detail: `provider "${providerName}" returned an empty answer`,
          provider: providerName,
        });
      }

      return {
        answer,
        provider: result?.provider || providerName,
        model: result?.model || model,
        latencyMs: Date.now() - startedAt,
        usage: result?.usage ?? null,
      };
    } catch (error) {
      const jarvisError = toJarvisError(error);
      /* Only internal detail is logged - never the API key, never the answer. */
      logger?.error?.(
        `JARVIS ask failed (code=${jarvisError.code}, provider=${providerName}): ${jarvisError.detail || jarvisError.message}`
      );
      throw jarvisError;
    }
  }

  return { provider: providerName, model, isConfigured, describe, ask };
}
