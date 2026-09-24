/*
 * JARVIS AI assistant - HTTP routes (V1).
 *
 *   POST /api/jarvis         ask a text question
 *   GET  /api/jarvis/status  is JARVIS available? (no secrets returned)
 *
 * Mounted in server.js as `app.use("/api", createJarvisRouter({...}))` with
 * the EXISTING onePOS `authenticate` middleware, so unauthenticated requests
 * are rejected with the same 401 contract as every other endpoint.
 *
 * The route deliberately stays thin: validate -> build session context ->
 * ask the JARVIS service -> map errors. It never talks to a provider
 * directly and never touches business data (V1 gives the AI no database
 * access - no tools, no queries, no reports).
 *
 * V2+ extension points (do not implement now): a permission gate for
 * `jarvis.use`, conversation history, streaming and tool calling all plug in
 * here without changing the response contract.
 */
import express from "express";
import { buildJarvisRequestContext } from "../services/jarvis/permissions.js";
import { normalizeJarvisMessage, JARVIS_MAX_MESSAGE_LENGTH } from "../services/jarvis/service.js";
import { JarvisError, JARVIS_ERROR_CODES, toJarvisError } from "../services/jarvis/errors.js";
import { hasEntitlement } from "../services/licensing.js";

export default function createJarvisRouter({ authenticate, jarvis, getRolePermissionCodes = null, jarvesAccess = null, entitlementAccess = null } = {}) {
  if (typeof authenticate !== "function") {
    throw new Error("createJarvisRouter requires the existing authenticate middleware");
  }
  if (!jarvis || typeof jarvis.ask !== "function") {
    throw new Error("createJarvisRouter requires a JARVIS service (see services/jarvis/index.js)");
  }

  const router = express.Router();

  /*
   * JARVES licence gate (V2): an authenticated user may only use JARVES when
   * an administrator has explicitly enabled JARVES for their account within
   * the company licence allowance (see services/jarvis/licensing.js). The
   * decision is made server-side from the VERIFIED JWT identity only.
   */
  async function requireJarvesEnabled(user) {
    if (typeof jarvesAccess !== "function") return; // not wired (e.g. tests) - auth still applies
    if (!(await jarvesAccess(user))) {
      throw new JarvisError(JARVIS_ERROR_CODES.JARVES_NOT_ENABLED, {
        detail: `user ${user?.id ?? "unknown"} is not JARVES-enabled for company ${user?.companyId ?? "unknown"}`,
      });
    }
  }

  /*
   * POST /api/jarvis
   * Body: { "message": "What is onePOS?" }
   * 200:  { success: true, data: { answer, provider, model, latencyMs } }
   */
  router.post("/jarvis", authenticate, async (req, res) => {
    const message = normalizeJarvisMessage(req.body?.message);

    if (!message) {
      return res.status(400).json({
        success: false,
        message: `A non-empty "message" of at most ${JARVIS_MAX_MESSAGE_LENGTH} characters is required`,
      });
    }

    try {
      await requireJarvesEnabled(req.user);
      if (typeof entitlementAccess === "function" && !hasEntitlement(await entitlementAccess(req.user.companyId), "jarvis")) {
        throw new JarvisError(JARVIS_ERROR_CODES.JARVES_NOT_ENABLED);
      }
      const context = await buildJarvisRequestContext(req.user, { getRolePermissionCodes });
      const result = await jarvis.ask({ message, context });

      return res.json({
        success: true,
        data: {
          answer: result.answer,
          provider: result.provider,
          model: result.model,
          latencyMs: result.latencyMs,
        },
      });
    } catch (error) {
      const safeError = toJarvisError(error);
      /* Internal detail goes to the server log only. */
      console.error(`JARVIS request failed (code=${safeError.code}):`, safeError.detail || safeError.message);

      return res.status(safeError.httpStatus).json({
        success: false,
        code: safeError.code,
        message: safeError.publicMessage,
      });
    }
  });

  /*
   * GET /api/jarvis/status
   * Lets the client know whether JARVIS is configured. Returns provider/model
   * names, the effective provider timeout and a boolean ONLY - never the API
   * key or any configuration value.
   */
  router.get("/jarvis/status", authenticate, (req, res) => {
    const description = typeof jarvis.describe === "function" ? jarvis.describe() : {};
    return res.json({
      success: true,
      data: {
        available: typeof jarvis.isConfigured === "function" ? jarvis.isConfigured() === true : false,
        provider: description.provider ?? jarvis.provider ?? null,
        model: description.model ?? jarvis.model ?? null,
        timeoutMs: description.timeoutMs ?? jarvis.timeoutMs ?? null,
      },
    });
  });

  return router;
}

export { createJarvisRouter };
