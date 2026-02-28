# Phase 2: Configuration and Hardening - Research

**Researched:** 2026-02-28
**Domain:** Runtime configuration API, input validation, secret protection, health checks, CORS, rate limiting
**Confidence:** HIGH

## Summary

Phase 2 transforms the gateway from a developer-configured (env-only) system into a production-hardened, runtime-configurable service. The existing codebase already contains significant scaffolding for this phase: the `GatewayConfig` and `SafeGatewayConfig` types are defined, the `handleGetSettings` handler already masks secrets, the `handlePostSettings` handler is a 501 stub awaiting implementation, the `/readyz` endpoint already checks STT and OpenClaw health, the validation package has guards for URLs, positive integers, and content types, the logger already masks secret fields, the rate limiter is implemented inline in `server.ts`, and CORS handling exists but needs hardening. The primary work is: (1) implementing the POST /api/settings endpoint with full validation and runtime config mutation, (2) adding startup pre-checks that gate traffic acceptance, (3) tightening CORS to reject non-allowlisted origins (current implementation only adds headers but does not reject), and (4) expanding input validation to cover the settings payload.

This phase requires no new external dependencies. The entire stack (Node.js `http`, Vitest, TypeScript strict mode, the existing validation and logging packages) already supports everything needed. The work is primarily wiring, validation logic, and hardening of existing endpoints.

**Primary recommendation:** Build the settings store as a mutable wrapper around the existing `GatewayConfig`, validate all settings input with the existing validation package guards, harden CORS to actively reject non-allowlisted origins, and add a startup gate that runs readiness checks before the server accepts traffic.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | `POST /api/settings` validates and stores runtime configuration | Settings store with runtime mutation + validation guards from `@voice-gateway/validation` |
| CONF-02 | `GET /api/settings` returns safe subset with secrets masked | Already implemented in `server.ts handleGetSettings` using `SafeGatewayConfig` -- needs update to read from mutable store |
| CONF-03 | Configurable: OpenClaw gateway URL, auth token, target session key | `GatewayConfig` type already defines these fields; POST handler must accept and validate them |
| CONF-04 | Configurable: STT provider selection and provider-specific credentials/URLs | `GatewayConfig` type already defines these; validation must use `createProviderId` for provider and URL/string guards for credentials |
| CONF-05 | Settings persisted securely -- secrets never appear in API responses or logs | `SafeGatewayConfig` type enforces masking in responses; `Logger.maskSecrets` handles logs; POST response must return safe config |
| OPS-02 | `GET /readyz` checks reachability of OpenClaw gateway and selected STT provider | Already implemented in `server.ts handleReadyz` -- runs parallel health checks. Need to verify it uses the active provider from mutable config |
| OPS-03 | Startup pre-check validates provider and OpenClaw connectivity before accepting traffic | New: add readiness gate in `index.ts` main() that runs health checks before `server.listen()` and refuses requests until checks pass |
| SAFE-03 | Runtime input validation at all external boundaries (HTTP payloads, provider responses, settings) | Validation package has guards; need to add settings payload validation schema; HTTP payload validation already exists for voice turns |
| SAFE-05 | Secret masking in all structured log output -- auth headers, API keys, tokens never logged | Already implemented in `Logger.maskSecrets` with `SECRET_FIELDS` set; verify coverage of all fields added by settings API |
| SAFE-06 | Request body size limits (max audio payload) and rate limiting per IP | Rate limiter and body size limits already implemented in `server.ts`; verify limits also apply to settings endpoint body |
| SAFE-07 | CORS allowlist in strict mode -- only configured origins accepted | CORS handler exists but only adds headers for matching origins without rejecting non-matching ones; needs active rejection |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `http` | Built-in (Node 20+) | HTTP server | Already used; no framework needed for this scope |
| TypeScript | ^5.7.0 | Type safety | Already configured with strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Vitest | ^3.0.0 | Testing | Already configured in `vitest.config.ts` with workspace-wide test patterns |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@voice-gateway/validation` | workspace | Input validation guards | For all settings payload validation (URL, positive int, non-empty string) |
| `@voice-gateway/logging` | workspace | Structured logging with secret masking | Already wired; secret masking covers SAFE-05 |
| `@voice-gateway/shared-types` | workspace | `GatewayConfig`, `SafeGatewayConfig`, error taxonomy | Type definitions for config store and API contracts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled validation | Zod / AJV | Zod is excellent but the existing `@voice-gateway/validation` guards cover every needed validation (URL, positive int, non-empty, audio content type). Adding Zod for one settings schema is over-engineering for this scope. |
| In-memory config store | File persistence (JSON) | File persistence would survive restarts but adds complexity. The env-var config already covers restart defaults. In-memory mutation is the right call for Phase 2 -- settings override env defaults at runtime. |
| Express/Fastify | Node.js `http` | Already using raw `http`; the route count (5 endpoints) doesn't justify a framework switch. |

**Installation:**
```bash
# No new packages needed -- everything is already in the workspace
```

## Architecture Patterns

### Recommended Project Structure
```
services/gateway-api/src/
  index.ts              # Entry point (add startup pre-checks)
  server.ts             # HTTP server (update settings handlers, harden CORS)
  config-loader.ts      # Env-based config (unchanged)
  config-store.ts       # NEW: Mutable runtime config wrapper
  orchestrator.ts       # Voice turn pipeline (read from config store)

packages/validation/src/
  guards.ts             # Add settings payload validation
```

### Pattern 1: Mutable Config Store with Immutable Snapshots
**What:** A class that wraps `GatewayConfig`, accepts partial updates via `update(patch)`, validates all fields, and returns immutable snapshots via `get(): Readonly<GatewayConfig>` and `getSafe(): SafeGatewayConfig`.
**When to use:** When runtime configuration needs to be changed without restart but must remain type-safe.
**Why this pattern:** The existing `GatewayConfig` is `readonly` at every level. The store acts as the single source of truth, accepting validated partial updates and producing fresh immutable snapshots. All readers (server handlers, orchestrator, readyz) read from the store.
**Example:**
```typescript
// services/gateway-api/src/config-store.ts

export class ConfigStore {
  private config: GatewayConfig;

  constructor(initial: GatewayConfig) {
    this.config = initial;
  }

  /** Return current config (frozen snapshot). */
  get(): Readonly<GatewayConfig> {
    return this.config;
  }

  /** Return safe config with secrets masked. */
  getSafe(): SafeGatewayConfig {
    return {
      openclawGatewayUrl: this.config.openclawGatewayUrl,
      openclawGatewayToken: "********",
      openclawSessionKey: this.config.openclawSessionKey,
      sttProvider: this.config.sttProvider,
      whisperx: { baseUrl: this.config.whisperx.baseUrl, model: this.config.whisperx.model },
      openai: { apiKey: "********", model: this.config.openai.model },
      customHttp: { url: this.config.customHttp.url, authHeader: "********" },
      server: this.config.server,
    };
  }

  /** Apply a validated partial update. */
  update(patch: ValidatedSettingsPatch): void {
    this.config = { ...this.config, ...patch };
  }
}
```

### Pattern 2: Startup Readiness Gate
**What:** Before calling `server.listen()`, run the same health checks that `/readyz` uses. If they fail, log the failure and exit (or retry with a bounded attempt count). Set a `ready` flag that the request handler checks -- reject all requests with 503 until the flag is true.
**When to use:** OPS-03 requires the gateway refuse traffic until startup pre-checks pass.
**Example:**
```typescript
// In index.ts main()

const configStore = new ConfigStore(loadConfig());

// ... initialize providers and client ...

// Startup pre-check (OPS-03)
log.info("Running startup pre-checks");
const sttOk = await activeProvider.healthCheck();
const clawOk = await openclawClient.healthCheck();
if (!sttOk.healthy || !clawOk.healthy) {
  log.error("Startup pre-check failed", { stt: sttOk, openclaw: clawOk });
  process.exit(1);
}
log.info("Startup pre-checks passed");

// Now start accepting traffic
const server = createGatewayServer({ configStore, sttProviders, openclawClient, logger: rootLogger });
server.listen(config.server.port, config.server.host);
```

### Pattern 3: Strict CORS Rejection
**What:** If CORS origins are configured and the request has an `Origin` header that does not match the allowlist, actively reject the request with 403 Forbidden. If no origins are configured, allow all (development mode).
**When to use:** SAFE-07 requires strict CORS -- current implementation adds headers for matches but silently allows non-matches.
**Example:**
```typescript
function handleCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: readonly string[],
): boolean {
  const origin = req.headers["origin"];

  // Preflight always gets handled
  if (req.method === "OPTIONS") {
    if (origin && allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Language-Hint");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
    res.writeHead(204);
    res.end();
    return true;
  }

  // Non-preflight: reject if origin present and not in allowlist
  if (origin && allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
    sendJson(res, 403, { error: "Origin not allowed", code: "CORS_REJECTED" });
    return true; // handled -- do not continue to route
  }

  // Add CORS headers for matching origins
  if (origin && allowedOrigins.length > 0 && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Language-Hint");
  }

  return false;
}
```

### Pattern 4: Settings Payload Validation
**What:** Validate the JSON body of `POST /api/settings` field-by-field, using existing guards from `@voice-gateway/validation` and branded constructors from `@voice-gateway/shared-types`. Accept partial updates (only validate present fields).
**When to use:** CONF-01 and SAFE-03 -- all external input must be validated before reaching business logic.
**Example:**
```typescript
// In validation package or config-store
interface SettingsPatch {
  openclawGatewayUrl?: string;
  openclawGatewayToken?: string;
  openclawSessionKey?: string;
  sttProvider?: string;
  whisperx?: Partial<WhisperXConfig>;
  openai?: Partial<OpenAIConfig>;
  customHttp?: Partial<CustomHttpConfig>;
}

function validateSettingsPatch(body: unknown): SettingsPatch {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new UserError(ErrorCodes.INVALID_CONFIG, "Settings must be a JSON object");
  }
  const obj = body as Record<string, unknown>;
  const patch: SettingsPatch = {};

  if ("openclawGatewayUrl" in obj) {
    patch.openclawGatewayUrl = validateUrl(String(obj["openclawGatewayUrl"]), "openclawGatewayUrl");
  }
  if ("sttProvider" in obj) {
    createProviderId(String(obj["sttProvider"])); // throws if invalid
    patch.sttProvider = String(obj["sttProvider"]);
  }
  // ... validate other fields similarly
  return patch;
}
```

### Anti-Patterns to Avoid
- **Mutable global singleton config:** Do NOT make `GatewayConfig` a module-level mutable object. Wrap it in `ConfigStore` and pass the store via dependency injection (same pattern as existing `ServerDeps`). This keeps testability intact.
- **Returning secrets in POST response:** The POST /api/settings handler must return the safe config (masked), never the raw config. The existing `SafeGatewayConfig` type enforces `"********"` literals at the type level.
- **Silently ignoring unknown fields:** The settings validator should ignore unknown fields (not throw), but log a warning. This prevents breaking the chat app when new fields are added to one side but not the other.
- **Blocking the event loop in health checks:** Health checks already use `Promise.all` with timeouts. Maintain this pattern. Do not add synchronous checks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Input validation | Custom type-checking functions | Existing `@voice-gateway/validation` guards (`validateUrl`, `requireNonEmpty`, `validatePositiveInt`) | Already tested (21 tests), consistent error codes, returns clean values |
| Secret masking in logs | Manual field filtering | Existing `Logger.maskSecrets` with `SECRET_FIELDS` set | Already covers nested objects, arrays, and all known secret field names |
| Secret masking in API | Manual per-field masking | Existing `SafeGatewayConfig` type with `"********"` literal types | TypeScript compiler enforces correct masking at the type level |
| Branded type validation | Raw string checks | `createProviderId`, `createSessionKey` from `@voice-gateway/shared-types` | Already validate and brand in one step |
| Rate limiting | New middleware | Existing `RateLimiter` class in `server.ts` | Already implemented with sliding window per IP |
| Body size limiting | New middleware | Existing `readBody` function with `maxBytes` parameter | Already streams and rejects oversized payloads |

**Key insight:** Phase 1 built almost all the infrastructure this phase needs. The primary gap is the settings store and POST handler -- everything else is wiring, hardening, and testing.

## Common Pitfalls

### Pitfall 1: Config Store Race Conditions
**What goes wrong:** Two simultaneous `POST /api/settings` requests produce an inconsistent final state (last-write-wins with partial overlap).
**Why it happens:** Node.js is single-threaded but async operations interleave. If the settings handler reads config, validates, and then writes, another request could write between read and write.
**How to avoid:** Since the settings endpoint is expected to be called rarely (operator configuring the gateway) and Node.js is single-threaded with non-preemptive concurrency, the simplest approach is to make the update synchronous: parse JSON body (async), then validate + apply in a single synchronous step (no `await` between read and write). This eliminates interleaving.
**Warning signs:** Tests that POST settings concurrently and get unexpected merged results.

### Pitfall 2: Provider Re-initialization on Config Change
**What goes wrong:** Changing the STT provider via settings does not re-initialize provider instances. The WhisperX provider still points to the old URL because it was constructed with the old config.
**Why it happens:** Provider instances are constructed once at startup with config values captured at construction time.
**How to avoid:** For Phase 2, changing provider selection (which provider is active) works immediately because the orchestrator reads `config.sttProvider` per-request. However, changing provider-specific config (e.g., WhisperX URL) requires either (a) lazy provider construction on first use with current config, or (b) reconstructing the provider on settings change. Option (b) is simpler and adequate for this use case. When settings change, reconstruct the affected provider.
**Warning signs:** Settings update succeeds but the provider still uses old URLs.

### Pitfall 3: CORS Header Duplication
**What goes wrong:** If the CORS handler adds headers and then the route handler also adds CORS headers, the browser sees duplicate headers and may reject the response.
**Why it happens:** Copy-paste from examples that mix CORS middleware with per-route headers.
**How to avoid:** All CORS header logic stays in `handleCors`. Route handlers never touch CORS headers.
**Warning signs:** Browser console shows CORS errors despite origin being in allowlist.

### Pitfall 4: Settings Endpoint Body Size
**What goes wrong:** The settings endpoint has no body size limit, allowing a malicious client to send a multi-GB JSON payload that exhausts memory.
**Why it happens:** The `readBody` function is used for voice turn payloads (which have `maxAudioBytes`) but the settings endpoint may not apply a limit.
**How to avoid:** Reuse `readBody` with a reasonable limit (e.g., 64KB) for the settings endpoint. Settings payloads are small JSON objects, never audio.
**Warning signs:** OOM kills under adversarial settings POST requests.

### Pitfall 5: Startup Pre-Check Blocks Forever
**What goes wrong:** If OpenClaw or the STT provider is not available at startup, the gateway hangs forever waiting for health checks.
**Why it happens:** Health checks use `Promise.all` but may not have timeouts applied consistently.
**How to avoid:** The existing health check implementations in both `WhisperXProvider` and `OpenClawClient` already have timeouts (5s and 10s respectively). Add an overall startup timeout (e.g., 30s) that force-exits if pre-checks don't complete.
**Warning signs:** Gateway process hangs at startup when dependencies are down.

## Code Examples

Verified patterns from the existing codebase:

### Reading JSON Body for Settings
```typescript
// Reuse readBody with a small limit for settings
async function handlePostSettings(
  req: IncomingMessage,
  res: ServerResponse,
  configStore: ConfigStore,
  log: Logger,
): Promise<void> {
  // SAFE-06: Body size limit for settings endpoint
  const body = await readBody(req, 64 * 1024); // 64KB max for settings JSON

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf-8"));
  } catch {
    throw new UserError(ErrorCodes.INVALID_CONFIG, "Request body is not valid JSON");
  }

  const patch = validateSettingsPatch(parsed);
  configStore.update(patch);

  // CONF-05: Return safe config, never raw
  sendJson(res, 200, configStore.getSafe());
}
```

### Adding CORS_REJECTED to Error Codes
```typescript
// In shared-types/src/errors.ts ErrorCodes
export const ErrorCodes = {
  // ... existing codes
  CORS_REJECTED: "CORS_REJECTED",
} as const;
```

### ServerDeps Update for Config Store
```typescript
// Replace static config with config store in ServerDeps
export interface ServerDeps {
  readonly configStore: ConfigStore;  // was: readonly config: GatewayConfig;
  readonly sttProviders: Map<string, SttProvider>;
  readonly openclawClient: OpenClawClient;
  readonly logger: Logger;
}
```

### Readiness Gate Flag
```typescript
// Simple boolean flag for startup readiness
let ready = false;

const server = createServer(async (req, res) => {
  if (!ready && req.url !== "/healthz") {
    sendJson(res, 503, { error: "Gateway is starting up", code: "NOT_READY" });
    return;
  }
  // ... normal routing
});

// After startup checks pass:
ready = true;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Static env-only config | Runtime settings API with env defaults | Phase 2 (this work) | Chat app can configure gateway without restart |
| Permissive CORS (headers only) | Strict CORS with active rejection | Phase 2 (this work) | Non-allowlisted origins get 403 instead of silent pass-through |
| No startup gate | Readiness pre-check before accepting traffic | Phase 2 (this work) | Prevents serving requests when dependencies are down |

**Deprecated/outdated:**
- None. This is a greenfield project with Phase 1 just completed.

## Open Questions

1. **Should settings changes trigger provider re-initialization?**
   - What we know: Provider instances capture config at construction time. Changing `whisperx.baseUrl` via settings won't affect the already-constructed `WhisperXProvider`.
   - What's unclear: Should Phase 2 handle provider re-initialization, or defer it to Phase 3 (Provider Extensibility)?
   - Recommendation: Phase 2 should handle it. When settings are updated and a provider-specific field changes, reconstruct the affected provider and replace it in the `sttProviders` map. This is straightforward and prevents confusing behavior where settings appear to save but don't take effect.

2. **Should the settings endpoint require authentication?**
   - What we know: This is a single-user/household gateway. The chat app is the only expected client.
   - What's unclear: Whether an open settings endpoint is acceptable or needs at least basic auth.
   - Recommendation: Out of scope for Phase 2. The CORS allowlist provides origin-level protection. The gateway runs on a private network alongside OpenClaw. Adding auth to the settings endpoint is a reasonable future enhancement but not in the v1 requirements.

3. **Should settings be persisted to disk?**
   - What we know: Requirements say "persisted securely" (CONF-05), but the env-var config already provides defaults on restart.
   - What's unclear: Whether "persisted" means surviving restarts or just surviving the current session.
   - Recommendation: In-memory only for Phase 2. The env vars provide restart defaults. "Persisted securely" in context means "secrets never leak" not "survives restarts." File persistence adds complexity (file permissions, atomic writes, encoding) that is not in the v1 requirements.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `services/gateway-api/src/server.ts` -- current endpoint implementations, CORS handler, rate limiter, body reader
- Existing codebase: `packages/shared-types/src/config.ts` -- `GatewayConfig` and `SafeGatewayConfig` type definitions with readonly fields and `"********"` literal types
- Existing codebase: `packages/validation/src/guards.ts` -- validation guards (URL, positive int, non-empty, audio content type)
- Existing codebase: `packages/logging/src/logger.ts` -- secret masking implementation with `SECRET_FIELDS` set
- Existing codebase: `services/gateway-api/src/config-loader.ts` -- env-var config loading with `safeParseInt` / `safeParsePositiveInt`
- Existing codebase: `services/gateway-api/src/index.ts` -- startup sequence, provider initialization, graceful shutdown

### Secondary (MEDIUM confidence)
- Node.js `http` module documentation -- CORS semantics, request handling (well-established, stable API)
- CORS specification: `Origin` header and preflight handling semantics

### Tertiary (LOW confidence)
- None. All findings are based on the existing codebase and well-established Node.js patterns.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new packages needed; everything exists in the workspace already
- Architecture: HIGH - Patterns follow directly from Phase 1 architecture; config store is a thin wrapper
- Pitfalls: HIGH - Identified from direct code analysis of existing handlers and common Node.js patterns

**Research date:** 2026-02-28
**Valid until:** 2026-03-30 (stable -- no external dependencies changing)
