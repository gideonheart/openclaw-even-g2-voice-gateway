---
status: resolved
trigger: "After successful WS handshake with OpenClaw (hello-ok received), the gateway's chat.send request is rejected with 'missing scope: operator.write'. The gateway connects as a backend token-auth client (shared secret) to ws://127.0.0.1:3434 without device identity."
created: 2026-02-28T21:00:00Z
updated: 2026-03-01T00:20:00Z
---

## Current Focus

hypothesis: The OpenClaw server message-handler.ts (lines 421-425) unconditionally strips all scopes for connections without device identity. The gateway connects with token auth (shared secret) but no device object, so scopes=["operator.admin"] becomes scopes=[]. When chat.send is invoked, authorizeOperatorScopesForMethod checks scopes and finds none, rejecting with "missing scope: operator.write".
test: Trace the full scope resolution and enforcement path to confirm this is the only place scopes are stripped
expecting: Confirmed that lines 421-425 are the root cause and that shared-secret backend connections SHOULD be allowed to carry scopes
next_action: Read server-methods.ts to see how scopes are enforced on requests after handshake

## Symptoms

expected: POST /api/voice/turn with OGG audio should transcribe via WhisperX STT, send transcript to OpenClaw via WS chat.send, receive assistant reply, and return HTTP 200 with turnId and response text.
actual: STT succeeds (218 chars transcribed from OGG). Transcript reaches OpenClaw via WS. OpenClaw rejects chat.send with "missing scope: operator.write" (HTTP 502 OPENCLAW_SESSION_ERROR returned to caller).
errors: "missing scope: operator.write" on chat.send frame
reproduction: POST /api/voice/turn with Content-Type: audio/ogg and a real OGG file to the running gateway on port 4400
started: Discovered after fixing the nonce 1008 bug. The scope issue was always there but was masked by the earlier handshake failure.

## Eliminated

## Evidence

- timestamp: 2026-02-28T21:00:00Z
  checked: method-scopes.ts - scope enforcement
  found: chat.send is in WRITE_SCOPE group. authorizeOperatorScopesForMethod() checks if scopes includes ADMIN_SCOPE first (returns allowed:true if so), then checks if scopes includes the required scope. With empty scopes=[], it returns {allowed:false, missingScope:"operator.write"}.
  implication: The enforcement logic is correct - it properly checks scopes. The problem is that scopes are being cleared before they reach this check.

- timestamp: 2026-02-28T21:00:30Z
  checked: message-handler.ts lines 421-426
  found: When device is null/undefined (no device identity): if scopes.length > 0 AND NOT allowControlUiBypass, scopes are cleared to []. The gateway client has no device identity, so this code path runs and strips scopes.
  implication: This is the ROOT CAUSE. Shared-secret-authenticated backend clients that don't present device identity lose all scopes.

## Resolution

root_cause: message-handler.ts lines 421-425 unconditionally strip scopes for non-device connections (except control UI bypass). Backend clients authenticated via shared secret (token auth) lose all requested scopes, making chat.send fail with "missing scope: operator.write".
fix: |
  Added !sharedAuthOk guard to scope-stripping condition at line 422 of
  /home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts.
  Changed: if (scopes.length > 0 && !allowControlUiBypass) {
  To:      if (scopes.length > 0 && !allowControlUiBypass && !sharedAuthOk) {
  This exempts shared-secret-authenticated connections from scope stripping.
verification: |
  - Commit 4d1fb3e9f present in /home/forge/openclaw with the guard change at line 422.
  - Commit 801fa7fe8 present with updated e2e tests (2 new, 1 renamed/updated).
  - grep -n "sharedAuthOk" message-handler.ts confirms !sharedAuthOk on disk at line 422.
  - server.auth.e2e.test.ts: 31/31 tests pass using vitest.e2e.config.ts (2026-03-01).
  - New tests: "retains requested scopes for shared-secret-authenticated connections without
    device identity" and "rejects unauthenticated connections without device identity" both pass.
files_changed:
  - /home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts (line 422 guard)
  - /home/forge/openclaw/src/gateway/server.auth.e2e.test.ts (2 new tests, 1 updated)
