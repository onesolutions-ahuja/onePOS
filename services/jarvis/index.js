/*
 * JARVIS AI assistant - public entry point (V1 foundation).
 *
 *   server.js  ->  services/jarvis/index.js  ->  service.js + providers/*
 *
 * `createJarvis()` builds the whole stack from the environment once at boot:
 *
 *   JARVIS_AI_PROVIDER   provider to use          (default: gemini)
 *   GEMINI_API_KEY       server-side provider key (required for gemini)
 *   JARVIS_GEMINI_MODEL  model override           (default: gemini-flash-latest)
 *   JARVIS_AI_TIMEOUT_MS provider timeout         (default: 20000)
 *
 * The key is read here (server-side only) and stays inside the provider
 * closure. It is never sent to the browser and never appears in a response.
 *
 * Planned growth - each in its own module, keeping this entry point stable:
 *   jarvis service.js    (this)  question -> answer orchestration
 *   jarvis tools/        (V2+)   read-only onePOS data tools (sales, stock, ...)
 *   jarvis permissions/  (V2+)   permission-gated tools/actions
 *   jarvis routes.js     (routes/jarvis.js) HTTP contract
 */
import { createJarvisProvider, resolveProviderName, SUPPORTED_AI_PROVIDERS } from "./providers/index.js";
import { createJarvisService, normalizeJarvisMessage, sanitizeJarvisContext, JARVIS_MAX_MESSAGE_LENGTH } from "./service.js";
import { JARVIS_SYSTEM_INSTRUCTION, buildJarvisSystemInstruction, buildJarvisContextBlock, JARVIS_NAME } from "./prompt.js";
import { JarvisError, JARVIS_ERROR_CODES, toJarvisError, isJarvisError, jarvisHttpStatus } from "./errors.js";

/**
 * Create the JARVIS service from the environment (or an injected provider,
 * which is how tests supply the mocked Gemini provider).
 */
export function createJarvis({ env = process.env, fetchImpl, provider, providerName, baseInstruction } = {}) {
  const resolvedProvider =
    provider || createJarvisProvider({ name: providerName || resolveProviderName(env), env, fetchImpl });
  return createJarvisService({ provider: resolvedProvider, baseInstruction });
}

export {
  createJarvisService,
  createJarvisProvider,
  resolveProviderName,
  SUPPORTED_AI_PROVIDERS,
  normalizeJarvisMessage,
  sanitizeJarvisContext,
  JARVIS_MAX_MESSAGE_LENGTH,
  JARVIS_NAME,
  JARVIS_SYSTEM_INSTRUCTION,
  buildJarvisSystemInstruction,
  buildJarvisContextBlock,
  JarvisError,
  JARVIS_ERROR_CODES,
  toJarvisError,
  isJarvisError,
  jarvisHttpStatus,
};
