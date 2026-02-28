---
status: resolved
trigger: "OpenClaw WebSocket connection fails with close code 1008 (invalid request frame) in the gateway"
created: 2026-02-28T00:00:00Z
updated: 2026-02-28T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: Build + full test suite (192 tests)
expecting: All tests pass including 3 new nonce regression tests
next_action: Archive session

## Symptoms

expected: After WhisperX transcription completes, gateway opens WS to OpenClaw, completes challenge handshake, sends transcript as chat message, receives response, returns HTTP 200.
actual: WS connects -> receives connect.challenge(nonce) -> sends transcript -> socket closes with code 1008 "invalid request frame"
errors: WebSocket close code 1008 - invalid request frame
reproduction: Send OGG audio to /api/voice/turn endpoint. STT succeeds but OpenClaw WS handoff fails.
started: Since initial implementation - connect frame never included challenge nonce response.

## Eliminated

## Evidence

- timestamp: 2026-02-28T00:00:30Z
  checked: sendConnectFrame method (lines 376-450 of openclaw-client.ts)
  found: The `nonce` parameter is received but NEVER placed into the ConnectParams object or anywhere in the frame. The ConnectParams interface (lines 73-89) has no `nonce` or `challenge` field. The frame is built without any nonce. Log at line 411 says `hasNonce: Boolean(nonce)` confirming the nonce arrives, but it goes nowhere.
  implication: This is the primary root cause. The OpenClaw server sends a challenge nonce, the client receives it, but never echoes it back. The server then rejects the connect frame because the challenge was not answered.

- timestamp: 2026-02-28T00:00:45Z
  checked: ConnectParams interface (lines 73-89)
  found: The interface defines minProtocol, maxProtocol, client, caps, role, scopes, auth -- but NO nonce/challenge field
  implication: The type definition itself is incomplete for the protocol. Need to add nonce field.

- timestamp: 2026-02-28T00:00:50Z
  checked: Existing test suite (openclaw-client.test.ts)
  found: Tests use a mock server that does NOT validate nonce in the connect frame. The mock's attachGatewayProtocol accepts any connect request without checking nonce. So existing tests pass despite the bug.
  implication: Need nonce-validation tests to prevent regression.

- timestamp: 2026-02-28T00:01:30Z
  checked: chat.send frame structure (doChatSendAndWait lines 671-773)
  found: ChatSendParams uses sessionKey, message, idempotencyKey, timeoutMs. Frame is properly wrapped as type:"req" with method:"chat.send". This matches the mock server expectations and is not a schema issue.
  implication: The chat.send failure was a downstream consequence of the connect handshake failing (1008 close), not an independent frame schema bug.

## Resolution

root_cause: The ConnectParams interface and sendConnectFrame implementation omitted the challenge nonce from the connect request frame. When the OpenClaw server sends a connect.challenge event containing a nonce, the client correctly received and stored it, but never included it in the connect frame payload. The server rejected the unanswered challenge with WebSocket close code 1008 ("invalid request frame"). The chat.send never had a chance to execute because the handshake failed first.

fix: Two changes to openclaw-client.ts:
  1. Added `nonce?: string | undefined` field to the ConnectParams interface
  2. Populated `nonce: nonce ?? undefined` in the connectParams object inside sendConnectFrame

  Before (connect frame params):
  ```json
  { "minProtocol": 3, "maxProtocol": 3, "client": {...}, "caps": [], "role": "operator", "scopes": [...], "auth": {...} }
  ```

  After (connect frame params):
  ```json
  { "minProtocol": 3, "maxProtocol": 3, "nonce": "server-provided-nonce", "client": {...}, "caps": [], "role": "operator", "scopes": [...], "auth": {...} }
  ```

  Three regression tests added to openclaw-client.test.ts:
  - "includes challenge nonce in connect frame params" - verifies nonce is echoed
  - "omits nonce when no connect.challenge is received" - verifies fallback path
  - "is rejected by server when nonce is missing but required (regression)" - proves the fix prevents 1008

verification: TypeScript build clean (tsc --build). Full test suite: 192 tests passed across 19 test files. Zero failures.

files_changed:
  - packages/openclaw-client/src/openclaw-client.ts
  - packages/openclaw-client/src/openclaw-client.test.ts
