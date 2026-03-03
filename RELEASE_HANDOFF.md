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

### 2. OpenClaw client not re-initialized on config change -- RESOLVED

**Status:** RESOLVED in quick-21 (2026-03-03) by `openclaw-rebuilder.ts`

**File:** `services/gateway-api/src/index.ts:44-49`
**Original problem:** The `OpenClawClient` was constructed once at startup. Changing `openclawGatewayUrl` or `openclawGatewayToken` via `POST /api/settings` had no effect until restart.

**Resolution:** `openclaw-rebuilder.ts` registers a `ConfigStore.onChange()` listener that disconnects the old client, creates a new `OpenClawClient` with updated config, and swaps the reference on `deps`. The new client connects lazily on the next `sendTranscript()` call.

### 3. RateLimiter uses stale config -- RESOLVED

**Status:** RESOLVED in quick-21 (2026-03-03)

**File:** `services/gateway-api/src/server.ts`
**Original problem:** The `RateLimiter` cached `rateLimitPerMinute` at construction time, ignoring runtime changes.

**Resolution:** `RateLimiter` now takes a `ConfigStore` reference and calls `this.configStore.get().server.rateLimitPerMinute` on every `check()` call. No onChange listener needed -- live reads are simpler and correct.

### 4. RateLimiter memory leak under diverse-IP load -- RESOLVED

**Status:** RESOLVED in quick-21 (2026-03-03)

**File:** `services/gateway-api/src/server.ts`
**Original problem:** The `RateLimiter`'s `windows` Map never pruned expired entries, growing without bound under diverse-IP load.

**Resolution:** `RateLimiter` now runs a periodic prune every 60 seconds via `setInterval().unref()` that removes expired windows. A hard cap of 10,000 entries triggers eager pruning between intervals. A `destroy()` method cleans up the interval for test teardown and graceful shutdown.

### 5. orchestrator.ts TODO -- model field hardcoded to null -- RESOLVED

**Status:** RESOLVED in quick-21 (2026-03-03) clean rewrite

**File:** `services/gateway-api/src/orchestrator.ts`
**Original problem:** `GatewayReply.meta.model` was always `null` with a TODO comment.

**Resolution:** The quick-21 rewrite threads `sttResult.model` through to `GatewayReply.meta.model` via the shared `sendAndShape()` helper. The TODO comment was removed. For text turns, `model` is correctly `null` (no STT provider involved).

### 6. OpenClaw client uses constructor config, not ConfigStore -- RESOLVED

**Status:** RESOLVED in quick-21 (2026-03-03) -- same fix as Finding #2

**Original problem:** The `OpenClawClient` class had no mechanism to receive updated config post-construction.

**Resolution:** `openclaw-rebuilder.ts` handles this by disconnecting the old client (which rejects pending turns gracefully), creating a new `OpenClawClient` with the updated config, and swapping the mutable `deps.openclawClient` reference. The architectural pattern now matches STT provider rebuilding: destroy and recreate on config change.

---

## Tech Debt Summary

### Post-Release Fixes (all resolved in quick-21, 2026-03-03)

| # | Finding | Status | Resolution |
|---|---------|--------|------------|
| 1 | Stale runbook note (`docs/runbook.md:161`) | RESOLVED | Runbook updated to reflect runtime config changes take effect immediately |
| 2 | OpenClaw client re-init gap | RESOLVED | `openclaw-rebuilder.ts` rebuilds client on config change |
| 3 | RateLimiter stale config | RESOLVED | Reads `configStore.get()` on every `check()` call |
| 4 | RateLimiter memory leak | RESOLVED | Periodic prune (60s interval) + 10k hard cap + `destroy()` |
| 5 | Model field threading | RESOLVED | `sttResult.model` threaded through `sendAndShape()` helper |
| 6 | OpenClaw client pattern gap | RESOLVED | Same as #2 -- architectural parity with STT provider rebuilding |

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

### ~~1. OpenClaw client runtime re-initialization~~ RESOLVED (quick-21)

Completed via `openclaw-rebuilder.ts`. See Finding #2 above.

### ~~2. RateLimiter hardening~~ RESOLVED (quick-21)

Completed: periodic prune, 10k hard cap, live config reads. See Findings #3-4 above.

### 3. Integration testing against live services

**Why:** The current test suite uses mocks for all external service interactions (WhisperX API, OpenAI API, OpenClaw WebSocket). The OpenClaw WebSocket protocol was validated in quick-18 but Even Hub audio format (codec, container, sample rate) has not been tested with real hardware. Protocol mismatches may surface during real deployment.

**What:** Create a smoke test script (`test/smoke/live-voice-turn.sh` or similar) that: (a) sends a real audio file to `POST /api/voice/turn`, (b) verifies STT transcription against a running WhisperX instance, (c) validates the OpenClaw WebSocket handshake and message exchange. Also capture a real audio sample from Even G2 glasses to confirm the exact format (WebM/Opus, CAF/AAC, or WAV) and add it as a test fixture.

**Files:** New `test/smoke/` directory, test fixture audio files
