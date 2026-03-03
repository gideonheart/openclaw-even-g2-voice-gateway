---
phase: quick-22
plan: 01
subsystem: config
tags: [websocket, config-loader, env-vars, connectivity]

# Dependency graph
requires:
  - phase: quick-21
    provides: "Clean gateway-api source files including config-loader.ts"
provides:
  - "Smart URL derivation from OPENCLAW_GATEWAY_PORT in config-loader"
  - "Regression tests for URL fallback chain (5 new tests)"
  - "Documented env precedence and stale-shell-token hazard in .env.example"
affects: [gateway-api, deployment]

# Tech tracking
tech-stack:
  added: []
  patterns: ["3-step env fallback chain: explicit > derived > default"]

key-files:
  created: []
  modified:
    - services/gateway-api/src/config-loader.ts
    - services/gateway-api/src/config-loader.test.ts
    - .env.example

key-decisions:
  - "Used 127.0.0.1 instead of localhost in PORT-derived URL to avoid DNS ambiguity"
  - "Empty string OPENCLAW_GATEWAY_URL treated as unset (falls through to PORT derivation)"

patterns-established:
  - "resolveOpenClawUrl: 3-step fallback for env-derived config values"

requirements-completed: [CONN-FIX-01]

# Metrics
duration: 2min
completed: 2026-03-03
---

# Quick-22: Fix OpenClaw Connectivity Regression Summary

**Smart URL derivation from OPENCLAW_GATEWAY_PORT with 3-step fallback chain, 5 regression tests, and shell-override hazard docs**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-03T00:41:54Z
- **Completed:** 2026-03-03T00:44:03Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `resolveOpenClawUrl()` helper with 3-step fallback: explicit URL > PORT-derived > hardcoded default
- Gateway now correctly connects to ws://127.0.0.1:3434 when OPENCLAW_GATEWAY_PORT=3434 is set by systemd
- 5 new regression tests locking down URL derivation logic (17 total config-loader tests)
- Full test suite green: 215 tests passing (was 210)
- Live TCP connectivity to OpenClaw on port 3434 confirmed
- .env.example documents fallback chain and stale-shell-token hazard warning

## Task Commits

Each task was committed atomically:

1. **Task 1: Patch config-loader.ts + .env.example** - `5d9885d` (fix)
2. **Task 2: Add regression tests + verify connectivity** - `682c813` (test)

## Files Created/Modified
- `services/gateway-api/src/config-loader.ts` - Added resolveOpenClawUrl() with 3-step fallback chain
- `services/gateway-api/src/config-loader.test.ts` - 5 new tests for PORT derivation, URL precedence, empty-string fallthrough, stale token
- `.env.example` - Documented URL resolution fallback chain and shell-override warning

## Decisions Made
- Used `127.0.0.1` instead of `localhost` in PORT-derived URLs to avoid potential IPv4/IPv6 DNS ambiguity
- Empty string `OPENCLAW_GATEWAY_URL=""` treated as unset (falls through to PORT-based derivation) to handle cases where .env sets it to empty

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Gateway config now safely derives the correct OpenClaw URL in systemd environments
- Stale-shell-token hazard is documented but remains an operational concern (unset OPENCLAW_GATEWAY_TOKEN before starting)

## Self-Check: PASSED

All files exist, all commits verified, 215/215 tests green.

---
*Phase: quick-22*
*Completed: 2026-03-03*
