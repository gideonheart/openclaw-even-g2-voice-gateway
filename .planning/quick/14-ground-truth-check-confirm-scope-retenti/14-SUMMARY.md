---
phase: quick
plan: 14
subsystem: openclaw-scope-auth
tags: [verification, scope-retention, auth, e2e-tests, openclaw]
dependency_graph:
  requires: [quick-13]
  provides: [scope-fix-verified]
  affects: [openclaw-ws-auth, voice-turn-pipeline]
tech_stack:
  added: []
  patterns: [vitest-e2e-config, sharedAuthOk-guard]
key_files:
  created:
    - .planning/quick/14-ground-truth-check-confirm-scope-retenti/14-SUMMARY.md
  modified:
    - .planning/STATE.md
    - .planning/debug/openclaw-scope-operator-write.md
    - .planning/debug/openclaw-ws-nonce-e2e-verify.md
decisions:
  - "Run e2e tests via vitest.e2e.config.ts (not default config which excludes *.e2e.test.ts)"
  - "quick-13 scope fix is complete and verified — no gaps found"
metrics:
  duration: "25 minutes"
  completed: "2026-03-01"
  tasks_completed: 2
  files_modified: 4
---

# Quick Task 14: Ground Truth Check — Scope Retention Fix Verified

**One-liner:** 31/31 auth e2e tests pass confirming the !sharedAuthOk scope guard fix (commits 4d1fb3e9f + 801fa7fe8) is correct and complete in /home/forge/openclaw.

## What Was Verified

### Commit Verification

Both commits from quick-13 are present in `/home/forge/openclaw`:

| Commit | Type | Description |
|--------|------|-------------|
| `4d1fb3e9f` | fix | Adds `!sharedAuthOk` guard to scope-stripping condition at line 422 of `message-handler.ts` |
| `801fa7fe8` | test | Replaces "ignores scopes" test with "retains scopes for shared-secret" + adds "rejects unauthenticated" test; updates tailscale test to expect `health.ok=true` |

### Exact Change Confirmed

`/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts` line 422:

Before (quick-12 and earlier):
```typescript
if (scopes.length > 0 && !allowControlUiBypass) {
```

After (quick-13 fix, commit 4d1fb3e9f):
```typescript
if (scopes.length > 0 && !allowControlUiBypass && !sharedAuthOk) {
```

On-disk verification: `grep -n "sharedAuthOk" message-handler.ts` returns 4 hits including line 422 with `!sharedAuthOk`.

### Test Results

Command: `npx vitest run --config vitest.e2e.config.ts src/gateway/server.auth.e2e.test.ts`

Result: **31/31 tests passed, 0 failures** (duration: ~17s)

New tests added by commit 801fa7fe8 that now pass:
- "retains requested scopes for shared-secret-authenticated connections without device identity"
- "rejects unauthenticated connections without device identity"
- "allows shared token to skip device and retain scopes when tailscale auth is enabled" (updated from expecting `health.ok=false` to `health.ok=true`)

## Root Cause (Confirmed Closed)

The OpenClaw server's `message-handler.ts` unconditionally stripped all scopes for WebSocket connections that lacked device identity — except for Control UI bypass clients. The Even G2 voice gateway connects as a shared-secret backend client without device identity, so its requested `operator.admin` scope was silently cleared. This caused `chat.send` to fail with "missing scope: operator.write".

The fix adds `!sharedAuthOk` to the scope-stripping condition, exempting shared-secret-authenticated backend clients from scope stripping. The `sharedAuthOk` flag is set at line 390 when the client authenticates successfully using the server's shared secret.

## Gaps Found

**None.** The fix was already correct and complete. All 31 tests pass with no modifications required.

## Deviations from Plan

None — plan executed exactly as written. Note: the plan suggested running `npx vitest run src/gateway/server.auth.e2e.test.ts` which does not work because `vitest.config.ts` explicitly excludes `**/*.e2e.test.ts`. The correct command uses `--config vitest.e2e.config.ts`. This is informational only; the tests themselves pass cleanly.

## Status

Quick task 13 (scope retention fix) is **COMPLETE AND VERIFIED**.

The voice-turn pipeline blocker (WS 1008 nonce + "missing scope: operator.write") is fully resolved:
1. Nonce 1008 fix — commit 862148e (quick-12) in voice-gateway repo
2. Scope retention fix — commits 4d1fb3e9f + 801fa7fe8 (quick-13) in openclaw repo
3. Ground truth verification — this task (quick-14): 31/31 pass

## Self-Check: PASSED

Files confirmed:
- FOUND: `/home/forge/openclaw-even-g2-voice-gateway/.planning/quick/14-ground-truth-check-confirm-scope-retenti/14-SUMMARY.md`
- FOUND: `.planning/STATE.md` (updated with quick-13 and quick-14 entries)
- FOUND: `.planning/debug/openclaw-scope-operator-write.md` (status: resolved)

Commits confirmed:
- `04ef11d` — chore(quick-14): verify scope fix commits and mark debug files resolved
- `4d1fb3e9f` — present in `/home/forge/openclaw` (fix commit)
- `801fa7fe8` — present in `/home/forge/openclaw` (test commit)
