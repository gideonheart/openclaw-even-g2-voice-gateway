---
phase: 02-configuration-and-hardening
plan: 01
subsystem: api
tags: [config-store, validation, runtime-config, branded-types, tdd]

# Dependency graph
requires:
  - phase: quick-1
    provides: GatewayConfig types, branded constructors, validation guards, error taxonomy
provides:
  - ConfigStore class with get(), getSafe(), update() methods
  - validateSettingsPatch function for POST /api/settings input validation
  - ValidatedSettingsPatch type for type-safe config patches
  - CORS_REJECTED and NOT_READY error codes
affects: [02-configuration-and-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns: [mutable-wrapper-immutable-read, partial-nested-merge, branded-type-error-conversion]

key-files:
  created:
    - services/gateway-api/src/config-store.ts
    - services/gateway-api/src/config-store.test.ts
  modified:
    - packages/shared-types/src/errors.ts

key-decisions:
  - "ValidatedSettingsPatch uses Partial at both top and nested levels for flexible partial updates"
  - "Unknown fields silently ignored (not thrown, not included) per research anti-pattern guidance"
  - "TypeError from branded constructors caught and rethrown as UserError(INVALID_CONFIG) for proper 400 responses"
  - "validateString guard not added -- requireNonEmpty suffices for all string validation needs"

patterns-established:
  - "Branded type error conversion: catch TypeError from constructors, rethrow as UserError for HTTP boundary"
  - "Nested shallow merge: spread { ...existing, ...patch } preserves sibling fields on partial updates"
  - "Secret masking: getSafe() builds SafeGatewayConfig with literal '********' for token/key/auth fields"

requirements-completed: [CONF-03, CONF-04, SAFE-03]

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 2 Plan 01: ConfigStore and Settings Validation Summary

**ConfigStore class with mutable state, immutable reads, secret masking, and validateSettingsPatch for all GatewayConfig fields using existing guards and branded constructors**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T01:54:22Z
- **Completed:** 2026-02-28T01:58:02Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- ConfigStore class wraps GatewayConfig with get(), getSafe(), update() -- single source of truth for runtime config
- getSafe() masks all 3 secret fields (openclawGatewayToken, openai.apiKey, customHttp.authHeader) matching existing server.ts pattern
- update() shallow-merges nested objects (whisperx, openai, customHttp, server) so partial patches preserve sibling fields
- validateSettingsPatch validates all config fields using existing guards (validateUrl, requireNonEmpty, validatePositiveInt) and branded constructors (createProviderId, createSessionKey)
- TypeError from branded constructors caught and converted to UserError(INVALID_CONFIG) for HTTP 400 responses
- CORS_REJECTED and NOT_READY error codes added for Plan 02
- 26 tests passing with full TDD coverage

## Task Commits

Each task was committed atomically:

1. **Task 1: ConfigStore class with TDD tests** - `79dcabe` (feat)
2. **Task 2: validateSettingsPatch with TDD tests** - `fddd5e6` (feat)

_Both tasks followed TDD RED-GREEN cycle._

## Files Created/Modified
- `services/gateway-api/src/config-store.ts` - ConfigStore class and validateSettingsPatch function
- `services/gateway-api/src/config-store.test.ts` - 26 tests covering ConfigStore and validateSettingsPatch
- `packages/shared-types/src/errors.ts` - Added CORS_REJECTED and NOT_READY error codes

## Decisions Made
- ValidatedSettingsPatch uses Partial at both top and nested levels, enabling granular config updates
- Unknown fields silently ignored (not thrown, not included in output) -- follows research anti-pattern guidance for extensibility
- TypeError from branded constructors caught and rethrown as UserError(INVALID_CONFIG) so HTTP layer returns 400, not 500
- validateString guard not added to guards.ts -- requireNonEmpty suffices for all current string validation needs (plan marked this as optional)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ConfigStore and validateSettingsPatch ready for Plan 02 to wire into POST /api/settings endpoint
- CORS_REJECTED and NOT_READY error codes available for Plan 02 CORS strict rejection and startup gate
- ValidatedSettingsPatch type exported for use by server handlers

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 02-configuration-and-hardening*
*Completed: 2026-02-28*
