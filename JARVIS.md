# JARVIS — onePOS AI assistant

JARVIS is the AI assistant built into onePOS. This document covers the **V1
backend foundation**: an authenticated text-question endpoint that forwards a
user's question to an AI provider and returns the answer.

Flow (V1):

```
User -> JARVIS (client, later) -> onePOS backend -> AI provider (Gemini) -> JARVIS answer
```

## 1. Endpoints

| Method | Path                 | Auth                    | Purpose                                    |
| ------ | -------------------- | ----------------------- | ------------------------------------------ |
| POST   | `/api/jarvis`        | existing onePOS session | ask a text question                        |
| GET    | `/api/jarvis/status` | existing onePOS session | is JARVIS available? (no secrets returned) |

Request:

```json
{ "message": "What is onePOS?" }
```

Success (200):

```json
{
  "success": true,
  "data": {
    "answer": "onePOS is a point-of-sale and retail management platform …",
    "provider": "gemini",
    "model": "gemini-flash-latest",
    "latencyMs": 812
  }
}
```

Errors always use the standard onePOS `{ success: false, message }` shape plus a
stable `code`:

| Status | `code`                    | Meaning                                          |
| ------ | ------------------------- | ------------------------------------------------ |
| 400    | –                         | `message` missing / not a string / blank / >2000 |
| 401    | –                         | no or invalid/expired session token              |
| 403    | –                         | Self-Checkout mode token (existing mode gate)    |
| 502    | `provider_error`          | provider returned an error (incl. 429/5xx)       |
| 502    | `provider_blocked`        | provider safety-blocked the request              |
| 502    | `empty_response`          | provider returned no usable text                 |
| 502    | `provider_unreachable`    | network/DNS failure reaching the provider        |
| 503    | `provider_not_configured` | `GEMINI_API_KEY` is not set on the server        |
| 503    | `provider_unsupported`    | `JARVIS_AI_PROVIDER` names an unknown provider   |
| 504    | `provider_timeout`        | provider exceeded `JARVIS_AI_TIMEOUT_MS`         |

Provider response bodies are never echoed to the client — only generic, safe
messages. Internal detail goes to the server log.

## 2. Architecture

```
server.js                      wiring only: createJarvis() + createJarvisRouter({ authenticate, jarvis, getRolePermissionCodes })
├── routes/jarvis.js           HTTP contract: validate -> session context -> jarvis.ask() -> error mapping
└── services/jarvis/
    ├── index.js               createJarvis(): builds provider + service from the environment
    ├── service.js             createJarvisService(): validation, prompt assembly, error normalisation
    ├── prompt.js              system instruction + session-context block
    ├── permissions.js         who is asking (existing session + role_permissions, read-only)
    ├── errors.js              JarvisError / codes / safe HTTP mapping
    └── providers/
        ├── index.js           provider registry + resolver (JARVIS_AI_PROVIDER)
        └── geminiProvider.js  the ONLY Gemini-specific code (REST, header auth)
```

### Provider abstraction

Every provider implements:

```js
{
  name,                                  // "gemini"
  model,                                 // resolved model id
  isConfigured(),                        // credentials present?
  describe(),                            // { provider, model, configured }
  generateAnswer({ systemInstruction, message })
    // -> { text, provider, model, finishReason, usage }
}
```

Adding OpenAI, a local Ollama model or any other provider means writing one
factory with that shape and registering it in
`services/jarvis/providers/index.js`. Nothing in `routes/jarvis.js`, the API
contract or the JARVIS service changes. An unknown provider name fails loudly
(`provider_unsupported` → 503) rather than silently answering without AI.

### Planned module growth (NOT implemented in V1)

| Module                | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `jarvis tools/`       | read-only onePOS data tools (sales, stock, customers, reports)  |
| `jarvis permissions/` | per-tool permission gating + confirmation before actions        |
| `jarvis routes.js`    | conversation history, streaming, voice endpoints                |

## 3. Authentication & permissions

* Uses the **existing** onePOS session middleware (`services/session.js`
  `createAuthenticate`) — no second auth system. Missing/invalid/expired tokens
  are rejected with the normal 401 contract.
* A Self-Checkout mode token is refused by the **existing** mode gate before it
  reaches JARVIS (403) — JARVIS stays a staff feature.
* JARVIS is told **who is asking** from the verified JWT claims only: user id,
  username, company, store, role, plus the permission codes resolved from the
  existing `role_permissions` table (read-only, best-effort). The client cannot
  spoof any of these (extra body fields are ignored).
* V1 adds no new permission code: every authenticated user may ask JARVIS
  questions. V2 should introduce `jarvis.use` (and per-tool codes) and gate the
  route with the existing `authorize(...)` middleware.

## 4. Data access (V1)

JARVIS V1 has **no access to business data**: no queries, no tools, no reports.
The only database call in the request path is the read-only permission lookup.
`services/jarvis/service.js` forwards an explicit allow-list of session fields
(`JARVIS_CONTEXT_FIELDS`) so no rows, records or secrets can reach a prompt,
and the system instruction tells the model it cannot read onePOS data.

## 5. Environment variables

| Variable               | Required         | Default               | Purpose                                   |
| ---------------------- | ---------------- | --------------------- | ----------------------------------------- |
| `GEMINI_API_KEY`       | yes (for Gemini) | –                     | Server-side provider credential           |
| `JARVIS_AI_PROVIDER`   | no               | `gemini`              | Provider selection                        |
| `JARVIS_GEMINI_MODEL`  | no               | `gemini-flash-latest` | Model override (pin a version if desired) |
| `JARVIS_AI_TIMEOUT_MS` | no               | `45000`               | Provider request timeout (ms)             |

`GET /api/jarvis/status` reports the effective `provider`, `model` and
`timeoutMs` (never the key), so the active configuration can be checked from
the till without reading server logs.

### If questions time out (`504 provider_timeout`)

`gemini-flash-latest` is an alias Google **hot-swaps to each new Flash
release**, and thinking is on by default across the Gemini 3 and 2.5 series.
A valid short question can therefore take longer than expected, and if the
provider budget elapses first the till sees `provider_timeout` even though
nothing is broken (the server log records the effective budget, e.g.
`Gemini request exceeded 45000ms`).

Fix, in order of preference — all configuration only, no code change:

1. `JARVIS_GEMINI_MODEL=gemini-3.6-flash` (or a Flash-Lite model) — pin a
   specific, faster model instead of the floating alias.
2. `JARVIS_AI_TIMEOUT_MS=90000` — more headroom when answers must wait for a
   thinking model.
3. Check `JARVIS_AI_TIMEOUT_MS` is not set to a tiny or bogus value: it is
   **milliseconds**, so `20` aborts after 20ms.

The key is read server-side only (never in frontend code, never with a `VITE_`
prefix), sent to Gemini in the `x-goog-api-key` **header** (never in a URL) and
never returned in a response. `.env.example` holds empty placeholders; `.env`
is git-ignored.

Set it in production (Render) as an environment variable on the service:

```
GEMINI_API_KEY=<your key>
```

## 6. Tests

```
node --test tests/jarvis.test.mjs
```

The Gemini API is mocked with an injected fetch implementation — the tests never
call Google and never need a real key. They run against a recording,
write-refusing database stand-in that fails the suite if JARVIS ever attempts a
write, and they statically assert that no client-side file references the API
key.

## 7. Known limitations / next steps (V2)

1. No permission gate (`jarvis.use`) and no per-user rate limiting/throttling.
2. No conversation history: each question is a single, context-free turn.
3. No tools, no database access, no reports, no actions — by design in V1.
4. No streaming and no client UI in this step (backend foundation only).
5. No usage/cost accounting beyond the per-request `latencyMs`.
6. The system instruction is intentionally short; V2 should add onePOS domain
   knowledge (help/troubleshooting content) and tool definitions.
