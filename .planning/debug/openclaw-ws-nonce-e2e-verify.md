---
status: resolved
trigger: "Final live end-to-end verification that commit 2fc85c5 actually prevents the WS close 1008 error during voice-turn processing"
created: 2026-02-28T00:00:00Z
updated: 2026-02-28T20:35:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED - Root-level nonce removed from ConnectParams. WS handshake now succeeds. E2E pipeline reaches OpenClaw but hits a new, separate scope authorization issue.
test: Full live runtime test completed
expecting: N/A -- resolved
next_action: Archive and report

## Symptoms

expected: Voice turn POST with real OGG audio should transcribe via WhisperX STT, open OpenClaw WebSocket with challenge nonce, get assistant reply, return HTTP 200 with turnId and response
actual: Previously got WS close 1008 "invalid request frame" after STT success because connect frame was missing the challenge nonce. Commit 2fc85c5 adds it. Unit/integration tests pass but no live runtime verification done yet.
errors: WS close 1008 "invalid request frame"
reproduction: POST /api/voice/turn with Content-Type: audio/ogg and a real OGG file
started: Fix landed in commit 2fc85c5

## Eliminated

- hypothesis: "Connect frame was missing the challenge nonce, causing 1008 rejection"
  evidence: The real error is "invalid connect params: at root: unexpected property 'nonce'" -- the server rejects the nonce as an UNKNOWN property. Reading the OpenClaw server source (frames.ts ConnectParamsSchema) confirms additionalProperties:false with NO root-level nonce field. The nonce exists only in device.nonce for device-paired connections. For local token-auth backend connections, the nonce is not required (nonceRequired = !isLocalClient, and isLocalClient = true for 127.0.0.1).
  timestamp: 2026-02-28T20:28:00Z

## Evidence

- timestamp: 2026-02-28T20:24:00Z
  checked: git log --oneline -5
  found: HEAD is 6ff39f8, commit 2fc85c5 is present. Branch master is clean (except debug file).
  implication: Working tree ready for verification.

- timestamp: 2026-02-28T20:25:00Z
  checked: .env file at repo root
  found: All required env vars present including OPENCLAW_GATEWAY_URL=ws://127.0.0.1:3434, OPENCLAW_GATEWAY_TOKEN, PORT=4400.
  implication: Env configuration is correct.

- timestamp: 2026-02-28T20:25:15Z
  checked: Live gateway startup with --env-file (BEFORE fix)
  found: Gateway connects to ws://127.0.0.1:3434 (correct), receives connect.challenge with nonce (hasNonce:true), sends connect frame WITH root-level nonce. Server immediately closes with code 1008 reason "invalid connect params: at root: unexpected property 'nonce'". Retries in loop with same result.
  implication: The nonce at root level of ConnectParams is REJECTED by the server's schema validation (additionalProperties:false). Commit 2fc85c5 introduced a new bug.

- timestamp: 2026-02-28T20:27:00Z
  checked: OpenClaw server source - /home/forge/openclaw/src/gateway/protocol/schema/frames.ts lines 20-68
  found: ConnectParamsSchema has { additionalProperties: false }. No root-level nonce field. Nonce only exists inside device sub-object (device.nonce) for device-paired connections. Allowed root keys: minProtocol, maxProtocol, client, caps, commands, permissions, pathEnv, role, scopes, device, auth, locale, userAgent.
  implication: Root-level nonce is illegal per the schema. Commit 2fc85c5 placed it at the wrong location.

- timestamp: 2026-02-28T20:28:00Z
  checked: OpenClaw server source - message-handler.ts lines 486-519
  found: Nonce validation only happens inside the device identity block. nonceRequired = !isLocalClient. For localhost connections, isLocalClient=true so nonce is NOT required. The nonce is read from device.nonce, not from root params.
  implication: For a local backend client using token auth without device identity, the nonce is irrelevant. Simply removing it from root ConnectParams will fix the 1008 rejection.

- timestamp: 2026-02-28T20:29:51Z
  checked: Live gateway startup with --env-file (AFTER fix - nonce removed from root)
  found: Gateway connects, receives connect.challenge, sends connect WITHOUT root-level nonce. Server responds with "hello-ok". Handshake complete. Startup pre-checks pass (STT healthy, OpenClaw connected).
  implication: The 1008 "invalid connect params" error is FIXED. WS handshake now succeeds.

- timestamp: 2026-02-28T20:30:10Z
  checked: healthz endpoint
  found: HTTP 200 {"status":"ok","timestamp":"2026-02-28T20:30:10.716Z"}
  implication: Gateway is healthy.

- timestamp: 2026-02-28T20:30:14Z
  checked: readyz endpoint
  found: HTTP 200 {"status":"ready","checks":{"stt":{"healthy":true,"message":"WhisperX healthy","latencyMs":211},"openclaw":{"healthy":true,"message":"OpenClaw connected","latencyMs":0}}}
  implication: Gateway is ready. Both STT and OpenClaw subsystems are healthy.

- timestamp: 2026-02-28T20:30:25Z
  checked: POST /api/voice/turn with real OGG audio (84746 bytes)
  found: STT transcription succeeded (textLength:218, durationMs:9775). Transcript sent to OpenClaw. OpenClaw rejected chat.send with "missing scope: operator.write" (HTTP 502, code OPENCLAW_SESSION_ERROR).
  implication: The WS connection and handshake work. The pipeline reaches OpenClaw successfully. The new error is a SEPARATE ISSUE: the server strips scopes for non-device connections (message-handler.ts lines 421-426). chat.send requires operator.write scope which the client does not have. This is NOT related to the 1008/nonce bug.

- timestamp: 2026-02-28T20:29:30Z
  checked: Full test suite (npx vitest run)
  found: 192 tests pass across 19 test files. 0 failures. Includes 3 new schema-compliance tests replacing the old nonce-echo tests.
  implication: Fix is correct and no regressions.

## Resolution

root_cause: Commit 2fc85c5 added `nonce` as a root-level property of ConnectParams, but the OpenClaw server's ConnectParamsSchema (TypeBox with additionalProperties:false) does not define a root-level nonce field. The nonce field only exists inside the `device` sub-object for device-paired connections. For local token-authenticated backend clients, the nonce is not needed at all (nonceRequired = !isLocalClient, and localhost = local). The server rejects the unknown property with 1008 "invalid connect params: at root: unexpected property 'nonce'".

fix: |
  Removed root-level nonce from ConnectParams interface and from sendConnectFrame() in openclaw-client.ts.
  Updated 3 tests: replaced nonce-echo tests with schema-compliance tests that verify:
  1. No root-level nonce property in connect params
  2. All connect params keys match the allowed set from OpenClaw ConnectParamsSchema
  3. Connection succeeds against strict-schema mock server that rejects unknown properties

verification: |
  1. Build: npm run build passes (TypeScript strict mode)
  2. Tests: 192/192 pass across 19 test files, 0 failures
  3. Live startup: Gateway connects to ws://127.0.0.1:3434, completes handshake, receives hello-ok
  4. healthz: HTTP 200 {"status":"ok"}
  5. readyz: HTTP 200 {"status":"ready"} with STT+OpenClaw healthy
  6. Voice turn: STT succeeds (218 chars transcribed), transcript reaches OpenClaw via WS
  7. WS 1008 error: GONE -- no longer occurs
  8. New blocker discovered: "missing scope: operator.write" on chat.send (separate issue, not nonce-related)

files_changed:
  - packages/openclaw-client/src/openclaw-client.ts (removed root-level nonce from ConnectParams interface and sendConnectFrame)
  - packages/openclaw-client/src/openclaw-client.test.ts (replaced 3 nonce-echo tests with 3 schema-compliance tests)

## Runtime Verification Report

### 1. Runtime Status
- Gateway: RUNNING on port 4400 (0.0.0.0)
- OpenClaw WS: CONNECTED to ws://127.0.0.1:3434
- Handshake: COMPLETE (hello-ok received)
- Startup pre-checks: PASSED (STT healthy, OpenClaw connected)

### 2. healthz/readyz Results
- GET /healthz: HTTP 200 {"status":"ok","timestamp":"2026-02-28T20:30:10.716Z"}
- GET /readyz: HTTP 200 {"status":"ready","checks":{"stt":{"healthy":true,"message":"WhisperX healthy","latencyMs":211},"openclaw":{"healthy":true,"message":"OpenClaw connected","latencyMs":0}}}

### 3. OGG Voice Turn Result
- HTTP Status: 502 Bad Gateway
- Response: {"error":"An internal error occurred. Please try again.","code":"OPENCLAW_SESSION_ERROR"}
- Detail: "missing scope: operator.write" (OpenClaw rejected chat.send due to insufficient scopes)
- STT portion: SUCCESS (218 chars transcribed from 84746 byte OGG in 9.8s)

### 4. WS Handshake Result
- connect.challenge received: YES (hasNonce: true)
- connect frame sent: YES (without root-level nonce)
- hello-ok received: YES
- WS 1008 error: NONE -- FIXED

### 5. Verdict

**WS 1008 nonce bug: PASS (FIXED)**
The original bug (WS close 1008 "invalid request frame" due to unknown 'nonce' property) is resolved.
The connect frame no longer includes the invalid root-level nonce property. The OpenClaw server
accepts the connection and completes the handshake with hello-ok.

**End-to-end voice turn: FAIL (new blocker)**
The pipeline reaches OpenClaw but chat.send fails with "missing scope: operator.write".
This is a separate authorization issue: the OpenClaw server strips scopes for connections
without device identity (message-handler.ts lines 421-426). The gateway client connects as
a backend token-auth client without device identity, so all requested scopes (operator.admin)
are removed. chat.send requires operator.write.

**Next step (separate issue):** Either:
  (a) Register the gateway as a device-paired connection to retain scopes, or
  (b) Request that the OpenClaw server allows scope-carrying for shared-secret-authenticated
      backend connections without device identity
