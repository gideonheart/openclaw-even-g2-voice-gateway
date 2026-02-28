---
phase: 02-configuration-and-hardening
plan: 02
subsystem: api
tags: [config-store-wiring, cors-hardening, readiness-gate, startup-prechecks, settings-endpoint]

# Dependency graph
requires:
  - phase: 02-configuration-and-hardening
    plan: 01
    provides: ConfigStore class, validateSettingsPatch, ValidatedSettingsPatch type, CORS_REJECTED and NOT_READY error codes
provides:
  - POST /api/settings endpoint with validation, ConfigStore update, and safe response
  - GET /api/settings reading from ConfigStore.getSafe() (no duplicated masking)
  - Strict CORS rejection (403 CORS_REJECTED) for non-allowlisted origins
  - Readiness gate (503 NOT_READY) blocking traffic until startup pre-checks pass
  - Startup pre-checks validating STT provider and OpenClaw health with 30s timeout
  - ConfigStore-backed server eliminating all static config references
affects: [03-provider-extensibility]

# Tech tracking
tech-stack:
  added: []
  patterns: [configstore-wired-server, readiness-gate, startup-prechecks, strict-cors-rejection]

key-files:
  created: []
  modified:
    - services/gateway-api/src/server.ts
    - services/gateway-api/src/index.ts
    - test/integration/voice-turn.test.ts

key-decisions:
  - "handleGetSettings uses ConfigStore.getSafe() directly, eliminating duplicated masking logic from server.ts"
  - "Readiness gate exempts /healthz (liveness probe must always respond)"
  - "Settings endpoint rate-limited using same RateLimiter instance as voice turn"
  - "Provider re-initialization deferred to Phase 3 with documented TODO"
  - "deps.ready set in listen callback (not before) to ensure port is bound"
  - "Graceful shutdown sets ready=false immediately to reject in-flight requests"

patterns-established:
  - "ConfigStore-backed deps: all config reads go through deps.configStore.get() for runtime mutability"
  - "Readiness gate: deps.ready flag checked before routing, exempting liveness probes"
  - "Strict CORS: non-allowlisted origins rejected with 403, empty allowlist = development mode"
  - "Startup pre-checks: validate external dependencies before accepting traffic"

requirements-completed: [CONF-01, CONF-02, CONF-05, OPS-02, OPS-03, SAFE-05, SAFE-06, SAFE-07]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Phase 2 Plan 02: Server ConfigStore Wiring and Hardening Summary

**ConfigStore-backed HTTP server with POST settings endpoint, strict CORS rejection, startup readiness gate, and pre-checks for STT/OpenClaw health**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T02:01:00Z
- **Completed:** 2026-02-28T02:05:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- ServerDeps refactored from static `config: GatewayConfig` to mutable `configStore: ConfigStore` with `ready` flag
- POST /api/settings endpoint validates JSON body via validateSettingsPatch, updates ConfigStore, returns safe config with secrets masked
- CORS hardened: non-allowlisted origins receive 403 CORS_REJECTED; empty allowlist permits all origins (dev mode)
- Readiness gate returns 503 NOT_READY for all endpoints except /healthz until startup pre-checks pass
- Startup pre-checks validate STT provider and OpenClaw connectivity with 30s timeout before accepting traffic
- GET /api/settings simplified to use ConfigStore.getSafe() (removed duplicated masking logic)
- GET /readyz reads active provider from ConfigStore for post-config-change accuracy
- All 153 existing tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire ConfigStore into server, implement POST settings, harden CORS** - `b32d68b` (feat)
2. **Task 2: Wire ConfigStore in entry point, add startup gate, provider re-initialization** - `e88cf9b` (feat)

## Files Created/Modified
- `services/gateway-api/src/server.ts` - Updated ServerDeps interface, POST settings handler, strict CORS, readiness gate, ConfigStore-backed config reads
- `services/gateway-api/src/index.ts` - ConfigStore creation, buildSttProviders helper, startup pre-checks with 30s timeout, readiness gate lifecycle
- `test/integration/voice-turn.test.ts` - Updated to use ConfigStore-based ServerDeps interface with ready flag

## Decisions Made
- handleGetSettings uses ConfigStore.getSafe() directly, eliminating 15 lines of duplicated masking logic that previously lived in server.ts
- Readiness gate exempts /healthz only (liveness probe) -- all other endpoints including /readyz return 503 during startup
- Settings endpoint shares the same RateLimiter instance as voice turn (simpler than separate limiters)
- Provider re-initialization deferred to Phase 3 with documented TODO -- provider selection works immediately via per-request config reads, but provider-specific settings (URLs, models) require restart
- deps.ready set inside server.listen callback to guarantee port is bound before accepting traffic
- Graceful shutdown sets ready=false immediately to fast-reject new requests during drain

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated integration tests for new ServerDeps interface**
- **Found during:** Task 1 (ServerDeps refactor)
- **Issue:** 5 integration tests in test/integration/voice-turn.test.ts passed `config` property which no longer exists on ServerDeps (now `configStore`)
- **Fix:** Updated all test callsites to create `ConfigStore(config)` and pass `configStore` + `ready: true`
- **Files modified:** test/integration/voice-turn.test.ts
- **Verification:** All 153 tests pass
- **Committed in:** b32d68b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for interface change. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Gateway is now runtime-configurable via POST /api/settings
- ConfigStore is the single source of truth for all config reads
- CORS, readiness, and rate limiting hardening complete
- Phase 3 (Provider Extensibility) can build on ConfigStore for hot provider switching

---
*Phase: 02-configuration-and-hardening*
*Completed: 2026-02-28*
