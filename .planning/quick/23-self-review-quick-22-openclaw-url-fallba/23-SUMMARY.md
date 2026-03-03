---
phase: quick-23
plan: 01
subsystem: config
tags: [self-review, config-loader, port-validation, hardening]

# Dependency graph
requires:
  - phase: quick-22
    provides: "resolveOpenClawUrl with 3-step URL fallback chain"
provides:
  - "Port validation (1-65535) in resolveOpenClawUrl before URL interpolation"
  - "5 new edge-case tests for invalid OPENCLAW_GATEWAY_PORT values"
  - "Self-review documentation of quick-22 strengths, risks, and hardening"
affects: [gateway-api, config]

# Tech tracking
tech-stack:
  added: []
  patterns: ["parseInt + range-check guard before env-to-URL interpolation"]

key-files:
  created: []
  modified:
    - services/gateway-api/src/config-loader.ts
    - services/gateway-api/src/config-loader.test.ts

key-decisions:
  - "Use parsed integer (not raw string) in URL to normalize leading zeros"
  - "Reject port 0 as invalid -- even though it is technically assignable, it is never correct for an upstream WebSocket URL"

patterns-established:
  - "Validate env-derived values at config load time, not at connection time"

requirements-completed: [REVIEW-22]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Quick-23: Self-Review of Quick-22 OpenClaw URL Fallback Summary

**Port validation hardening for resolveOpenClawUrl -- rejects non-numeric/out-of-range OPENCLAW_GATEWAY_PORT with OperatorError at config load time, 5 new edge-case tests, self-review of quick-22 quality**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T00:49:43Z
- **Completed:** 2026-03-03T00:53:00Z
- **Tasks:** 2
- **Files modified:** 2

## What Quick-22 Did Well

1. **Clean 3-step fallback chain** -- explicit URL > PORT-derived > hardcoded default. Easy to understand, well-documented in code comments.
2. **Used 127.0.0.1 instead of localhost** in PORT-derived URLs -- avoids IPv4/IPv6 DNS ambiguity in the common case.
3. **Empty string OPENCLAW_GATEWAY_URL treated as unset** -- handles .env edge case gracefully where a user might set `OPENCLAW_GATEWAY_URL=""`.
4. **5 regression tests** covering all fallback paths: PORT derivation, URL precedence, neither-set fallback, empty-URL fallthrough, explicit token.
5. **.env.example updated** with clear fallback chain docs and shell-override hazard warning.
6. **Atomic commits** (fix then tests) with descriptive messages.

## Risks Identified

| # | Risk | Status | Notes |
|---|------|--------|-------|
| 1 | PORT validation gap: non-numeric or out-of-range values produced invalid URLs | **FIXED** | Now throws OperatorError(INVALID_CONFIG) at config load time |
| 2 | localhost vs 127.0.0.1 inconsistency (last-resort default vs PORT-derived) | **ACCEPTED** | Deliberate -- 127.0.0.1 avoids DNS ambiguity for the PORT case; localhost is fine as last resort |
| 3 | Stale shell token hazard (shell env overrides .env) | **OPERATIONAL** | Cannot be fixed in code (Bun/.env runtime behavior). Documented in .env.example |
| 4 | PORT interpolated as raw string (leading zeros, whitespace) | **FIXED** | parseInt normalizes "03434" to 3434; NaN/range check rejects garbage |

## Hardening Applied (This Task)

- Added `parseInt(port, 10)` + range check (1-65535) to `resolveOpenClawUrl`
- Throws `OperatorError(ErrorCodes.INVALID_CONFIG)` with descriptive message for invalid ports
- Uses parsed integer `n` in URL instead of raw string `port` -- normalizes leading zeros
- Added 5 new tests covering: non-numeric, zero, negative, out-of-range (>65535), and leading-zero normalization

## Accomplishments

- Hardened resolveOpenClawUrl with port validation -- invalid values now fail fast at config load time
- 5 new edge-case tests bring config-loader tests from 17 to 22 and total suite from 215 to 220
- Self-review documents quick-22 quality assessment: 4 risks identified, 2 fixed, 1 accepted, 1 operational
- Zero regressions -- all 220 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PORT validation to resolveOpenClawUrl and regression tests** - `17ec058` (fix)
2. **Task 2: Write self-review summary** - (this commit, docs)

## Files Created/Modified

- `services/gateway-api/src/config-loader.ts` - Added parseInt + range validation in resolveOpenClawUrl before URL interpolation
- `services/gateway-api/src/config-loader.test.ts` - 5 new edge-case tests for invalid OPENCLAW_GATEWAY_PORT values

## Decisions Made

- Used parsed integer (`n`) in URL instead of raw string to normalize leading zeros (e.g., "03434" becomes 3434)
- Rejected port 0 as invalid -- while technically assignable, port 0 is never correct for an upstream WebSocket URL
- Kept error message format consistent with existing intOrDefault/positiveIntOrDefault pattern

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- resolveOpenClawUrl now fully validates all inputs before producing a URL
- The 3-step fallback chain (quick-22) plus port validation (quick-23) provide robust config loading
- Stale shell token hazard remains an operational concern documented in .env.example

## Self-Check: PASSED

All files verified present, commit 17ec058 confirmed, 220/220 tests green.

---
*Phase: quick-23*
*Completed: 2026-03-03*
