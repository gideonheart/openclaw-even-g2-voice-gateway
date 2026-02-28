---
phase: quick-5
plan: 1
subsystem: api
tags: [websocket, openclaw, config, runtime-reload]

# Dependency graph
requires:
  - phase: 02-configuration-and-hardening
    provides: ConfigStore with onChange listener and provider-rebuilder pattern
provides:
  - OpenClaw client runtime re-initialization on config change
  - Corrected runbook (no stale restart note)
affects: [gateway-api, docs]

# Tech tracking
tech-stack:
  added: []
  patterns: [config-driven client rebuild via ConfigStore.onChange]

key-files:
  created:
    - services/gateway-api/src/openclaw-rebuilder.ts
    - services/gateway-api/src/openclaw-rebuilder.test.ts
  modified:
    - services/gateway-api/src/server.ts
    - services/gateway-api/src/index.ts
    - docs/runbook.md

key-decisions:
  - "OpenClaw rebuilder follows exact same pattern as provider-rebuilder for consistency"
  - "ServerDeps.openclawClient made mutable (removed readonly) to allow runtime swapping"
  - "Both rebuilder registrations grouped together in index.ts after deps creation"

patterns-established:
  - "Config-driven client rebuild: ConfigStore.onChange listener pattern for any client/service that needs runtime reconfiguration"

requirements-completed: [CLAW-01, CLAW-02, CONF-03, PIPE-07]

# Metrics
duration: 4min
completed: 2026-02-28
---

# Quick Task 5: Post-v1 Hardening -- OpenClaw Client Re-initialization Summary

**OpenClaw client runtime rebuild on config change via ConfigStore.onChange, with 6 new tests and corrected runbook**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-28T07:57:21Z
- **Completed:** 2026-02-28T08:02:02Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- OpenClaw client rebuilds automatically when openclawGatewayUrl or openclawGatewayToken changes via POST /api/settings
- Old client properly disconnected on rebuild (pending turns rejected gracefully)
- Runbook corrected -- no longer claims config changes require a restart
- 6 new tests covering rebuild triggers, no-op cases, and correct config passing
- Full test suite green: 168 tests across 17 files

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement OpenClaw client rebuilder and wire it up** - `170c44c` (feat)
2. **Task 2: Add tests for OpenClaw rebuilder and fix runbook** - `d0f993b` (test)

## Files Created/Modified
- `services/gateway-api/src/openclaw-rebuilder.ts` - ConfigStore listener that rebuilds OpenClaw client on URL/token change
- `services/gateway-api/src/openclaw-rebuilder.test.ts` - 6 tests covering rebuild triggers, no-op cases, config passing
- `services/gateway-api/src/server.ts` - ServerDeps.openclawClient made mutable (removed readonly)
- `services/gateway-api/src/index.ts` - Wired registerOpenClawRebuilder, grouped both rebuilders after deps
- `docs/runbook.md` - Corrected stale note: all config changes now take effect at runtime

## Decisions Made
- Followed the exact same pattern as provider-rebuilder.ts for consistency (ConfigStore.onChange listener, logger child, conditional rebuild)
- Used a minimal `OpenClawDeps` interface in the rebuilder rather than importing full `ServerDeps` -- only needs the `openclawClient` property to be mutable
- Moved both rebuilder registrations (STT + OpenClaw) to after deps creation for clean grouping

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Steps
- All post-v1 hardening items from RELEASE_HANDOFF.md priority 1 (config drift) are now addressed
- Remaining RELEASE_HANDOFF.md items (memory leak in RateLimiter, structured logging, E2E tests) available for future quick tasks

## Self-Check: PASSED

All created files verified present. All commit hashes verified in git log.

---
*Quick Task: 5*
*Completed: 2026-02-28*
