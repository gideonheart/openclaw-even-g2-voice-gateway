---
phase: quick-8
plan: 1
subsystem: api
tags: [shutdown, graceful-shutdown, stale-closure, hot-reload, openclaw]

# Dependency graph
requires:
  - phase: quick-5
    provides: "OpenClaw client runtime re-initialization (registerOpenClawRebuilder)"
provides:
  - "Correct shutdown behavior after config hot-reload swaps OpenClaw client"
affects: [ops, shutdown, hot-reload]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Read mutable deps at call-time instead of capturing in closure"]

key-files:
  created: []
  modified:
    - "services/gateway-api/src/index.ts"

key-decisions:
  - "One-line fix only: changed openclawClient.disconnect() to deps.openclawClient.disconnect() in shutdown handler"

patterns-established:
  - "Shutdown handlers must read from deps object (not closed-over locals) to respect runtime swaps"

requirements-completed: [OPS-01]

# Metrics
duration: 1min
completed: 2026-02-28
---

# Quick-8: Fix Stale Closure Shutdown Defect Summary

**Shutdown handler now disconnects the current (possibly hot-reloaded) OpenClaw client via deps.openclawClient instead of stale closed-over local variable**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-28T08:36:01Z
- **Completed:** 2026-02-28T08:36:50Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Fixed stale closure in shutdown handler that would disconnect the original OpenClaw client instead of the current one after a config hot-reload
- Verified all 177 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix stale closure in shutdown handler** - `b771f2d` (fix)
2. **Task 2: Run full test suite and verify no regressions** - no commit (verification-only task, no code changes)

## Files Created/Modified
- `services/gateway-api/src/index.ts` - Changed line 103 from `openclawClient.disconnect()` to `deps.openclawClient.disconnect()` in the shutdown handler

## Decisions Made
- One-line fix only: the local `openclawClient` variable is still correctly used for the startup health check (runs once before any hot-reload can occur), so no other changes needed

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Shutdown handler now correctly disconnects whichever OpenClaw client is active at shutdown time
- All hot-reload paths (STT providers, OpenClaw client, rate limiter) now behave correctly through the full lifecycle including graceful shutdown

## Self-Check: PASSED

- FOUND: services/gateway-api/src/index.ts
- FOUND: commit b771f2d
- FOUND: 8-SUMMARY.md
- VERIFIED: deps.openclawClient.disconnect() in shutdown handler

---
*Phase: quick-8*
*Completed: 2026-02-28*
