# Release Handoff: OpenClaw Even G2 Voice Gateway v1

**Date:** 2026-02-28
**Commit range:** `3dde320..82b1ce6` (28 commits)
**Status:** v1 milestone complete -- 31/31 requirements delivered

---

## Shipped Scope (v1)

### Phase 1: Core Voice Pipeline (commits 3dde320..89e6b6e)

Monorepo scaffold with TypeScript strict mode, the complete voice turn pipeline, and one working STT provider.

- **Monorepo foundation** -- `packages/` (shared-types, stt-contract, logging, validation, response-policy, openclaw-client, stt-whisperx, stt-openai, stt-custom-http) + `services/gateway-api/`
- **Branded types** -- `TurnId`, `SessionKey`, `ProviderId` with compile-time safety (SAFE-02)
- **Error taxonomy** -- `UserError` (safe for clients) and `OperatorError` (detailed for logs) (SAFE-04)
- **STT provider abstraction** -- `SttProvider` interface with `transcribe()` + `healthCheck()` (PIPE-02, PIPE-03)
- **WhisperX adapter** -- async submit-then-poll with timeout and cancellation (PIPE-04)
- **OpenAI adapter** -- synchronous transcription via API (PIPE-05)
- **Custom HTTP adapter** -- configurable URL, auth, and response field mapping (PIPE-06)
- **OpenClaw WebSocket client** -- persistent connection, turnId correlation, exponential backoff retries (CLAW-01, CLAW-02, CLAW-03)
- **Response shaping** -- segmentation, truncation, normalization for transport safety (RESP-01 through RESP-04)
- **Gateway API** -- `POST /api/voice/turn` orchestrator, `GET /healthz` liveness (PIPE-01, OPS-01)
- **Structured logging** -- JSON output with per-turn correlation IDs and secret masking (OPS-04, SAFE-05)
- **Contract tests** -- all 3 STT providers pass identical test suite
- **Integration tests** -- end-to-end voice turn with mocked dependencies

### Phase 2: Configuration and Hardening (commits 1018b41..55e339c)

Runtime configuration API, input validation, and production safety.

- **ConfigStore** -- mutable config wrapper with immutable read snapshots (CONF-03)
- **POST /api/settings** -- validate and apply runtime config patches (CONF-01, CONF-04)
- **GET /api/settings** -- returns `SafeGatewayConfig` with all secrets masked (CONF-02, CONF-05)
- **Settings validation** -- field-by-field validation with branded constructors, unknown fields silently ignored (SAFE-03)
- **CORS strict mode** -- origin allowlist with 403 rejection for non-matching origins (SAFE-07)
- **Rate limiting** -- per-IP sliding window on voice turn and settings endpoints (SAFE-06)
- **Body size limits** -- streaming rejection for oversized audio payloads (SAFE-06)
- **Readiness gate** -- `/readyz` checks STT + OpenClaw health; server refuses traffic until startup pre-checks pass (OPS-02, OPS-03)
- **Graceful shutdown** -- SIGTERM/SIGINT handling with bounded timeout (10s force exit)

### Phase 3: Provider Extensibility (commits 3901d54, d5df520)

Runtime provider switching and config-driven re-initialization.

- **Runtime provider selection** -- switch active STT provider via settings API without restart
- **ConfigStore.onChange()** -- listener pattern for reactive config changes (PIPE-07)
- **provider-rebuilder.ts** -- rebuilds STT provider instances when their config section changes via settings API (PIPE-07)
- **6 unit tests** covering single, multi, and no-op rebuild scenarios

---

## Review: Last 3 Commits

### Commit 9f80650: Documentation suite

**What shipped:** README quickstart, `docs/architecture.md`, `docs/security.md`, `docs/runbook.md`. Completed the final unchecked section of OVERNIGHT_TODO.md.

**Code quality assessment:**
- Documentation-only commit, no runtime code changes
- Architecture doc accurately reflects the monorepo structure and pipeline flow
- Security doc covers all 7 SAFE requirements with specific enforcement details
- Runbook includes all endpoints, environment variables, troubleshooting table, and error codes
- One stale note identified in runbook (see Finding #1 below)

### Commit d5df520: PIPE-07 runtime provider re-initialization

**What shipped:** `ConfigStore.onChange()` listener pattern and `registerProviderRebuilder()` function. STT providers are rebuilt when their config section changes via `POST /api/settings`. The provider Map is mutated in-place so handlers see updated instances on the next request without restart.

**Code quality assessment:**
- 5 files changed, 269 insertions -- well-scoped feature commit
- 6 tests in `provider-rebuilder.test.ts` covering rebuild triggers for each provider, multi-provider rebuild, and no-op when unrelated config changes
- `ConfigStore.onChange()` is a clean addition (15 lines) with typed callback signature
- Provider rebuilder is 44 lines -- focused, single-responsibility
- Type safety maintained: `ValidatedSettingsPatch` and `Readonly<GatewayConfig>` in callback signature
- Limitation: only covers STT providers, not OpenClaw client (see Finding #2)

### Commit f6b8c38: v1 milestone closure

**What shipped:** Updated ROADMAP.md to mark Phase 3 and PIPE-07 complete. Updated STATE.md to reflect all 31/31 requirements delivered.

**Code quality assessment:**
- Documentation-only commit (2 files, 24 line changes)
- Accurately reflects delivered state
- STATE.md correctly records no remaining todos or pending items
- Note: REQUIREMENTS.md still shows PIPE-07 as "Partial" with the note "provider re-config requires restart" -- this is now stale since d5df520 delivered runtime re-initialization for STT providers

---

## Hidden Risks and Edge Cases Found

### 1. Stale runbook note (docs/runbook.md line 161)

**File:** `docs/runbook.md:161`
**Current text:** "Changing provider-specific config (URLs, API keys) currently requires a restart. Provider *selection* (which provider is active) works immediately."
**Problem:** This is now incorrect. Commit d5df520 (PIPE-07) added `ConfigStore.onChange()` and `registerProviderRebuilder()`, which rebuilds STT provider instances when their config section changes via `POST /api/settings`. Provider config changes (URLs, API keys, model names) take effect on the next request without restart.
**Fix:** Update the note to reflect that STT provider config changes are applied at runtime via the provider rebuilder.

### 2. OpenClaw client not re-initialized on config change

**File:** `services/gateway-api/src/index.ts:44-49`
**Problem:** The `OpenClawClient` is constructed once at startup with `config.openclawGatewayUrl` and `config.openclawGatewayToken` from the initial `loadConfig()`. When `openclawGatewayUrl` or `openclawGatewayToken` are changed via `POST /api/settings`, the ConfigStore updates its internal state, but the `OpenClawClient` instance retains its original WebSocket connection URL and auth token. The `provider-rebuilder.ts` only handles STT providers.

**Impact:** Changing OpenClaw connection settings via the settings API silently has no effect until the next process restart. A user who changes the OpenClaw URL through the settings API will continue hitting the old endpoint. No error is raised -- the old connection continues working (or failing) with its original config.

**Severity:** Medium. The primary use case (changing STT providers at runtime) works correctly. OpenClaw connection changes are less common, but the settings API accepts them without indicating they require a restart.

### 3. RateLimiter uses stale config

**File:** `services/gateway-api/src/server.ts:69`
**Problem:** The `RateLimiter` is constructed once in `createGatewayServer()` with `configStore.get().server.rateLimitPerMinute`. If `server.rateLimitPerMinute` is subsequently changed via `POST /api/settings`, the rate limiter continues enforcing the original value. There is no `ConfigStore.onChange()` listener for the rate limiter.

**Impact:** Low. Rate limit tuning at runtime is uncommon. The workaround is a process restart. If the rate limit is lowered via the API, the old (higher) limit remains enforced until restart; if raised, the old (lower) limit continues restricting traffic.

### 4. RateLimiter memory leak under diverse-IP load

**File:** `services/gateway-api/src/server.ts:39`
**Problem:** The `RateLimiter`'s `windows` Map stores `{ count, resetAt }` for each unique IP address. Entries are overwritten when a new window starts (`now >= window.resetAt`), but old entries from IPs that stop making requests are never removed. Under sustained load from many distinct IP addresses (e.g., behind a load balancer forwarding `X-Forwarded-For`, or a DDoS with spoofed source IPs), the Map grows without bound.

**Impact:** Memory grows linearly with unique client IPs over time. For typical single-household deployment alongside OpenClaw, this is negligible. For deployments behind a load balancer or CDN where `remoteAddress` varies widely, this could become a problem over days/weeks of uptime.

**Mitigation:** Add periodic cleanup of entries past their `resetAt` timestamp (e.g., `setInterval` with `.unref()`), or replace with a bounded LRU cache.

### 5. orchestrator.ts:114 TODO -- model field hardcoded to null

**File:** `services/gateway-api/src/orchestrator.ts:114`
**Code:** `model: null, // TODO(phase-2): thread SttResult.model when available`
**Problem:** The `GatewayReply.meta.model` field is always `null`. The `SttResult` type returned by providers does not currently carry model information, and even if it did, it would not be threaded through to the response envelope. The `TODO(phase-2)` comment indicates this was intentionally deferred.

**Impact:** Low. The field exists in the response schema for forward compatibility. Clients that display provider model info will see `null`. This is cosmetic -- no functional impact.

### 6. OpenClaw client uses constructor config, not ConfigStore

**File:** `packages/openclaw-client/src/openclaw-client.ts:71-74`, `services/gateway-api/src/index.ts:44-49`
**Problem:** The `OpenClawClient` class stores its config as a private readonly field set in the constructor. It uses `this.config.gatewayUrl` and `this.config.authToken` for every connection attempt. Unlike STT providers (which are rebuilt via `registerProviderRebuilder` when their config changes), the OpenClaw client has no mechanism to receive updated config.

This is architecturally different from how STT providers now work post-PIPE-07: STT providers are stateless constructors that are destroyed and recreated on config change. The OpenClaw client is stateful (persistent WebSocket connection with pending turn tracking), making hot-reload more complex -- it would need to drain pending turns, disconnect, and reconnect with new config.

**Impact:** Same as Finding #2. This entry documents the architectural pattern difference that makes the fix non-trivial compared to STT provider rebuilding.

---

## Tech Debt Summary

### Should fix before production

| # | Finding | Effort | Risk if ignored |
|---|---------|--------|-----------------|
| 1 | Stale runbook note (`docs/runbook.md:161`) | 5 minutes | Operators follow incorrect restart procedure |

### Should fix in v1.1

| # | Finding | Effort | Risk if ignored |
|---|---------|--------|-----------------|
| 2 | OpenClaw client re-init gap | 2-4 hours | Silent config drift when OpenClaw URL/token changed via API |
| 4 | RateLimiter memory leak | 1-2 hours | Memory growth under diverse-IP load over long uptime |

### Nice to have

| # | Finding | Effort | Risk if ignored |
|---|---------|--------|-----------------|
| 3 | RateLimiter stale config | 30 minutes | Rate limit changes via API have no effect until restart |
| 5 | Model field threading | 1 hour | `meta.model` always null in response -- cosmetic only |
| 6 | OpenClaw client pattern gap | Covered by #2 | Architectural asymmetry between STT and OpenClaw config handling |

---

## Known Limitations

- **In-memory rate limiter** -- single-instance only, no persistence across restarts, no shared state between processes
- **No authentication on settings/voice endpoints** -- relies on CORS allowlist + network trust model (suitable for local/trusted network deployment)
- **OpenClaw WebSocket protocol needs validation** -- current implementation based on expected protocol; needs verification against a running OpenClaw instance
- **Even Hub audio format needs confirmation** -- WebM/Opus vs CAF/AAC format from Even G2 glasses not yet tested with real hardware
- **No Docker/container support** -- by design; direct install alongside OpenClaw via npm
- **No TLS termination** -- expects a reverse proxy (nginx, Caddy) in front for HTTPS
- **Settings not persisted to disk** -- runtime config changes via API are lost on restart (must be re-applied or set via environment variables)
- **Single STT provider active at a time** -- no failover/fallback chain (deferred to v2 FAIL-01)

---

## Top 3 Post-v1 Priorities

### 1. OpenClaw client runtime re-initialization

**Why:** Commit d5df520 established the `ConfigStore.onChange()` pattern for STT providers, but the OpenClaw client was not included. This creates an asymmetry where STT provider config is runtime-mutable but OpenClaw connection config silently ignores API changes. Users who discover they can change STT settings at runtime will expect the same for OpenClaw settings.

**What:** Extend the `ConfigStore.onChange()` pattern to handle OpenClaw client rebuilding. This is more complex than STT provider rebuilding because the client is stateful (persistent WebSocket with pending turns). The implementation needs to: (a) drain or reject pending turns, (b) disconnect the old WebSocket, (c) create a new `OpenClawClient` with updated config, (d) connect and verify health. The `deps.openclawClient` reference in `ServerDeps` would need to become mutable or wrapped in an accessor.

**Files:** `services/gateway-api/src/index.ts`, `services/gateway-api/src/server.ts`, potentially a new `openclaw-rebuilder.ts`

### 2. RateLimiter hardening

**Why:** The current `RateLimiter` has two issues: (a) the `windows` Map never prunes expired entries, causing unbounded memory growth under diverse-IP load, and (b) the rate limit value is captured once at server creation and does not react to config changes.

**What:** Add a periodic cleanup interval (e.g., every 60 seconds via `setInterval().unref()`) that removes entries where `now >= resetAt`. Optionally, make the rate limiter read `configStore.get().server.rateLimitPerMinute` on each `check()` call instead of caching the value, or register a `ConfigStore.onChange()` listener. Consider replacing the plain Map with a bounded LRU cache if deployment scenarios include high-cardinality IP addresses.

**Files:** `services/gateway-api/src/server.ts` (RateLimiter class)

### 3. Integration testing against live services

**Why:** The current test suite uses mocks for all external service interactions (WhisperX API, OpenAI API, OpenClaw WebSocket). The OpenClaw WebSocket protocol (message format, auth handshake, session lifecycle) and Even Hub audio format (codec, container, sample rate) have not been validated against running instances. Protocol mismatches will only surface during real deployment.

**What:** Create a smoke test script (`test/smoke/live-voice-turn.sh` or similar) that: (a) sends a real audio file to `POST /api/voice/turn`, (b) verifies STT transcription against a running WhisperX instance, (c) validates the OpenClaw WebSocket handshake and message exchange. This can run in CI with service containers or manually against the user's existing WhisperX and OpenClaw instances. Also capture a real audio sample from Even G2 glasses to confirm the exact format (WebM/Opus, CAF/AAC, or WAV) and add it as a test fixture.

**Files:** New `test/smoke/` directory, test fixture audio files
