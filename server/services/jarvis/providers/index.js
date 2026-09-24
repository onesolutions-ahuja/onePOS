/*
 * JARVIS AI assistant - provider registry (V1).
 *
 * The JARVIS service, routes and API contract talk ONLY to this interface:
 *
 *   provider = { name, model, isConfigured(), describe(), generateAnswer({ systemInstruction, message }) }
 *   generateAnswer -> { text, provider, model, finishReason, usage }
 *
 * Adding a provider later (OpenAI, a local Ollama model, ...) means writing
 * one factory with that shape and adding it to JARVIS_PROVIDER_FACTORIES -
 * no change to routes/jarvis.js, the JARVIS service or the HTTP contract.
 */
import { createGeminiProvider, GEMINI_PROVIDER_NAME } from "./geminiProvider.js";
import { JarvisError, JARVIS_ERROR_CODES } from "../errors.js";

/** Providers that are actually implemented today. */
export const SUPPORTED_AI_PROVIDERS = Object.freeze([GEMINI_PROVIDER_NAME]);

/** provider name -> factory. Future: openai, ollama, ... */
export const JARVIS_PROVIDER_FACTORIES = Object.freeze({
  [GEMINI_PROVIDER_NAME]: createGeminiProvider,
});

export const DEFAULT_AI_PROVIDER = GEMINI_PROVIDER_NAME;

/** Which provider to use: JARVIS_AI_PROVIDER (default: gemini). */
export function resolveProviderName(env = process.env) {
  const configured = String(env?.JARVIS_AI_PROVIDER ?? "").trim().toLowerCase();
  return configured || DEFAULT_AI_PROVIDER;
}

function buildProviderOptions(providerName, env, fetchImpl) {
  const shared = { fetchImpl };
  if (providerName === GEMINI_PROVIDER_NAME) {
    return {
      ...shared,
      apiKey: env?.GEMINI_API_KEY,
      model: env?.JARVIS_GEMINI_MODEL,
      timeoutMs: Number(env?.JARVIS_AI_TIMEOUT_MS) || undefined,
    };
  }
  /* Future providers receive the whole environment; they own their own keys. */
  return { ...shared, env };
}

/**
 * Create the configured AI provider. Throws a JarvisError (code
 * `provider_unsupported`) for an unknown provider name - the server surfaces
 * that as 503 instead of silently answering without AI.
 */
export function createJarvisProvider({ name = resolveProviderName(), env = process.env, fetchImpl } = {}) {
  const providerName = String(name || DEFAULT_AI_PROVIDER).trim().toLowerCase();
  const factory = JARVIS_PROVIDER_FACTORIES[providerName];

  if (typeof factory !== "function") {
    throw new JarvisError(JARVIS_ERROR_CODES.PROVIDER_UNSUPPORTED, {
      detail: `unknown JARVIS provider "${providerName}" (supported: ${SUPPORTED_AI_PROVIDERS.join(", ")})`,
      provider: providerName,
    });
  }

  return factory(buildProviderOptions(providerName, env, fetchImpl));
}

export { createGeminiProvider, GEMINI_PROVIDER_NAME };
