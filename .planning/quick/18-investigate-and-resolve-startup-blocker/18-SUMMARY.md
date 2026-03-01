---
phase: quick-18
plan: 01
subsystem: infra
tags: [gateway, startup, health-check, openclaw, whisperx, env-config]

# Dependency graph
requires:
  - phase: v1.0
    provides: "Gateway startup pre-check implementation"
provides:
  - "Root-cause analysis of gateway startup blocker"
  - "Corrected OPENCLAW_GATEWAY_TOKEN in .env"
  - "Evidence-based reachability report for both external dependencies"
affects: [gateway-api, openclaw-client, stt-whisperx]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - ".env (OPENCLAW_GATEWAY_TOKEN corrected -- gitignored, local-only)"

key-decisions:
  - "Patched .env gateway token to match openclaw.json auth.token -- old token was stale"
  - "WhisperX at wsp.kingdom.lv is externally unreachable (TLS handshake completes but HTTP response times out) -- not fixable locally"

patterns-established: []

requirements-completed: []

# Metrics
duration: 4min
completed: 2026-03-01
---

# Quick Task 18: Investigate and Resolve Startup Blocker Summary

**Gateway startup fails due to two blockers: stale OPENCLAW_GATEWAY_TOKEN (fixed in .env) and unreachable remote WhisperX at wsp.kingdom.lv (external, not locally fixable)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-01T18:23:50Z
- **Completed:** 2026-03-01T18:28:05Z
- **Tasks:** 2
- **Files modified:** 1 (.env -- gitignored)

## Accomplishments

- Identified root cause of OpenClaw pre-check failure: gateway token mismatch (stale token in .env vs actual token in ~/.openclaw/openclaw.json)
- Patched .env with correct OPENCLAW_GATEWAY_TOKEN -- OpenClaw handshake now succeeds (29ms latency, hello-ok received)
- Confirmed WhisperX at wsp.kingdom.lv is unreachable: DNS resolves, TLS handshake completes, but HTTP /health endpoint times out after 5s (origin server down or Cloudflare-proxied with backend offline)
- Produced definitive pass/fail evidence for gateway startup with full log capture

## Investigation Findings

### 1. Effective Config (from .env + config-loader.ts)

| Variable | Value | Source |
|---|---|---|
| OPENCLAW_GATEWAY_URL | ws://127.0.0.1:3434 | .env |
| OPENCLAW_GATEWAY_TOKEN | ~~30cf8b21...~~ -> cd78074d5ca545d3... | .env (PATCHED) |
| STT_PROVIDER | whisperx | .env |
| WHISPERX_BASE_URL | https://wsp.kingdom.lv | .env |

### 2. OpenClaw Reachability

| Check | Result | Evidence |
|---|---|---|
| openclaw CLI installed | YES | /home/forge/.local/share/pnpm/openclaw v2026.2.27 |
| Gateway systemd service | RUNNING | pid 325469, state active |
| Port 3434 open | YES | nc confirms PORT_3434:OPEN |
| Token authentication | FAIL -> FIXED | Old token rejected with "unauthorized: gateway token mismatch"; new token from ~/.openclaw/openclaw.json auth.token succeeds |
| Health check (corrected token) | HEALTHY | "OpenClaw connected", latencyMs: 29, hello-ok received |

**Root cause:** The .env contained a stale OPENCLAW_GATEWAY_TOKEN (`30cf8b21122b8c0ea86efba4c7fa93da24a4b284f39f0746`) that did not match the gateway's configured auth token (`cd78074d5ca545d3cfd9c1ebbee4cf8aba5eaef2d1c2f8a89813d9815cc50291` from ~/.openclaw/openclaw.json gateway.auth.token).

**Additional finding:** The shell environment also has OPENCLAW_GATEWAY_TOKEN exported with the old value. Node's `--env-file` flag does NOT override existing environment variables. The corrected .env will only take effect in a clean shell without the old export, or the token must be explicitly passed as an env override: `OPENCLAW_GATEWAY_TOKEN=cd78... node ...`

### 3. WhisperX Reachability

| Check | Result | Evidence |
|---|---|---|
| DNS resolution | OK | wsp.kingdom.lv -> 172.67.222.182, 104.21.25.51 (Cloudflare) |
| TCP port 443 | OPEN | nc confirms connection |
| TLS handshake | OK | curl -vvv shows SSL certificate verify ok, HTTP/2 negotiated |
| GET /health | TIMEOUT | No HTTP response within 5s/8s; origin server behind Cloudflare is down |
| Local WhisperX (localhost:9000) | NOT RUNNING | Connection refused |

**Root cause:** The remote WhisperX instance at wsp.kingdom.lv is behind Cloudflare. DNS and TLS work, but the origin server does not respond to HTTP requests. This is an external service issue -- not fixable from this machine.

### 4. Gateway Startup Verdict

**PARTIAL FAIL:**
- OpenClaw pre-check: PASS (with corrected token)
- WhisperX pre-check: FAIL (remote service unreachable)
- Gateway exit code: 1

**Startup log (with corrected token):**
```
stt:  {"healthy":false,"message":"WhisperX unreachable: The operation was aborted due to timeout","latencyMs":5005}
openclaw: {"healthy":true,"message":"OpenClaw connected","latencyMs":29}
```

### 5. Build Status

TypeScript compilation (`tsc --build`): CLEAN -- no errors.

## Task Commits

This task modified only `.env` which is gitignored (contains secrets). No code changes to commit.

1. **Task 1: Probe external dependencies and inspect effective config** - No commit (only .env modified, gitignored)
2. **Task 2: Attempt gateway startup and report pass/fail evidence** - No commit (investigative, no file changes)

**Plan metadata:** (see final docs commit)

## Files Created/Modified

- `.env` - Corrected OPENCLAW_GATEWAY_TOKEN from stale value to current gateway auth token (gitignored, local-only change)

## Decisions Made

- Patched .env with correct gateway token sourced from ~/.openclaw/openclaw.json gateway.auth.token field
- Left WHISPERX_BASE_URL as wsp.kingdom.lv since no alternative local or remote WhisperX is available

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale OPENCLAW_GATEWAY_TOKEN in .env**
- **Found during:** Task 1 (Probe external dependencies)
- **Issue:** The token in .env (30cf8b21...) did not match the gateway's actual auth token (cd78074d...), causing "unauthorized: gateway token mismatch" on every connection attempt
- **Fix:** Updated .env with correct token from ~/.openclaw/openclaw.json
- **Files modified:** .env
- **Verification:** Gateway WebSocket connection succeeds with corrected token (hello-ok received, 29ms)
- **Committed in:** N/A (gitignored file)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix -- without corrected token, OpenClaw health check always fails.

## Issues Encountered

- **Node --env-file does not override existing env vars:** The shell environment has OPENCLAW_GATEWAY_TOKEN exported with the old value. Node's `--env-file` flag only sets variables not already present in process.env. To use the corrected .env token, either: (a) unset OPENCLAW_GATEWAY_TOKEN from the shell, or (b) explicitly override: `OPENCLAW_GATEWAY_TOKEN=cd78... node dist/index.js`
- **WhisperX origin server unresponsive:** The Cloudflare-fronted wsp.kingdom.lv accepts TLS but the origin never sends an HTTP response. This is an external infrastructure issue outside the gateway's control.

## Next Actions Required

To get the gateway fully starting:

1. **WhisperX service** must be restored/restarted at wsp.kingdom.lv, OR configure a local WhisperX instance and update WHISPERX_BASE_URL in .env
2. **Shell environment** should be updated: either `unset OPENCLAW_GATEWAY_TOKEN` before starting, or use explicit env override when launching the gateway
3. Alternatively, if WhisperX is not needed immediately, the startup pre-check logic in `services/gateway-api/src/index.ts` (line 82) could be relaxed to allow startup with degraded STT capability

## Self-Check: PASSED

- FOUND: 18-SUMMARY.md
- FOUND: .env
- FOUND: correct token in .env (cd78074d5ca545d3...)
- No task commits expected (only .env modified, which is gitignored)

---
*Quick Task: 18-investigate-and-resolve-startup-blocker*
*Completed: 2026-03-01*
