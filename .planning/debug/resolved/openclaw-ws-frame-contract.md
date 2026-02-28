---
status: resolved
trigger: "Gateway's openclaw-client sends frames that OpenClaw rejects with close code 1008 'invalid request frame' after successful STT transcription."
created: 2026-02-28T12:00:00.000Z
updated: 2026-02-28T19:53:00.000Z
---

## Current Focus

hypothesis: CONFIRMED - Complete protocol mismatch between gateway client and OpenClaw server.
test: Build passes, all 189 tests pass including new protocol contract regression tests.
expecting: N/A - resolved.
next_action: Archive and commit.

## Symptoms

expected: After STT transcription succeeds, gateway sends transcript to OpenClaw via WebSocket and receives an agent response back. HTTP 200 with assistant payload returned to caller.
actual: STT succeeds (textLength > 0), but OpenClaw closes WebSocket with code 1008 "invalid request frame". Gateway returns OPENCLAW_UNAVAILABLE error.
errors:
  - websocket close code 1008, reason: "invalid request frame"
  - OPENCLAW_UNAVAILABLE in gateway response
reproduction:
  - curl POST /api/voice/turn with Telegram OGG audio sample
  - STT transcription completes successfully
  - OpenClaw handoff fails every time
started: Since implementation - the openclaw-client was written without understanding the actual OpenClaw gateway protocol.

## Eliminated

(none - root cause found on first hypothesis)

## Evidence

- timestamp: 2026-02-28T12:00:00Z
  checked: OpenClaw gateway message-handler.ts (lines 208-248)
  found: Server validates EVERY incoming frame with validateRequestFrame(). If the first frame is not a valid RequestFrame with method "connect" and valid ConnectParams, it closes with 1008 "invalid request frame".
  implication: Our client sends {sessionKey, turnId, text, timestamp} which is not a RequestFrame ({type:"req", id, method, params}).

- timestamp: 2026-02-28T12:00:00Z
  checked: OpenClaw RequestFrameSchema (frames.ts lines 126-134)
  found: RequestFrame requires {type: "req" (literal), id: NonEmptyString, method: NonEmptyString, params?: unknown}. Our outbound frame has none of these fields.
  implication: 100% schema mismatch. Every frame we send fails validation.

- timestamp: 2026-02-28T12:00:00Z
  checked: OpenClaw gateway client.ts (reference implementation)
  found: Proper protocol flow is: (1) connect WebSocket, (2) receive connect.challenge event with nonce, (3) send connect request frame with ConnectParams (protocol version, client info, auth token, device identity), (4) receive hello-ok response, (5) use request() method for all subsequent communication. For chat, use method "chat.send" with params {sessionKey, message, idempotencyKey}.
  implication: Our client skips the entire handshake and sends raw domain objects instead of protocol frames.

- timestamp: 2026-02-28T12:00:00Z
  checked: ChatSendParamsSchema (logs-chat.ts lines 34-45)
  found: chat.send requires {sessionKey: string, message: string, idempotencyKey: string, thinking?: string, deliver?: boolean, attachments?: unknown[], timeoutMs?: number}
  implication: We need to use "chat.send" method with proper params, not our custom OpenClawOutbound format.

- timestamp: 2026-02-28T12:00:00Z
  checked: OpenClaw gateway auth config (openclaw.json)
  found: Gateway runs on port 3434, uses token auth with token, mode "local", bind "loopback".
  implication: Our client needs to send this token in ConnectParams.auth.token field.

- timestamp: 2026-02-28T19:53:00Z
  checked: Build and test suite
  found: npm run build passes, all 189 tests pass across 19 test files.
  implication: Fix is verified.

## Resolution

root_cause: Complete protocol mismatch. The openclaw-client sent raw JSON domain objects ({sessionKey, turnId, text, timestamp}) directly on the WebSocket, but OpenClaw's gateway protocol requires:
  1. Wait for connect.challenge event frame ({type:"event", event:"connect.challenge", payload:{nonce}})
  2. Send connect request frame ({type:"req", id:<uuid>, method:"connect", params:ConnectParams}) with protocol version 3, client info (id:"gateway-client", mode:"backend"), and auth token
  3. Receive hello-ok response before sending any other frames
  4. All subsequent messages must be request frames ({type:"req", id:<uuid>, method:"chat.send", params:{sessionKey, message, idempotencyKey}})
  5. Responses arrive as chat event frames ({type:"event", event:"chat", payload:{runId, sessionKey, state:"final", message:{content:[{type:"text",text:"..."}]}}})
  The client implemented none of this - it just opened a WebSocket and sent raw JSON, which the server immediately rejected as "invalid request frame" (close 1008).

fix: Complete rewrite of openclaw-client to implement the OpenClaw gateway protocol v3:
  - Handle connect.challenge event (with fallback timer if challenge not received)
  - Send proper connect request frame with ConnectParams (protocol v3, client info, auth)
  - Handle hello-ok response to complete handshake
  - Use chat.send method for transcript delivery with idempotencyKey
  - Collect assistant responses from chat event stream (delta/final/error/aborted states)
  - Extract text from message.content[] array (OpenClaw's standard message format)
  Updated all mock servers in tests to implement the real protocol flow.

verification:
  - npm run build: passes (TypeScript strict mode, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
  - npx vitest run: 189 tests pass, 19 test files, 0 failures
  - New regression tests verify: frame format (type:"req"), connect handshake, chat.send framing, no raw domain objects sent
  - Integration tests verify end-to-end: Audio -> STT -> OpenClaw protocol -> GatewayReply
  - Hot-reload test verifies switching between OpenClaw servers works with protocol

files_changed:
  - packages/openclaw-client/src/openclaw-client.ts: Complete rewrite to implement OpenClaw gateway protocol v3
  - packages/openclaw-client/src/openclaw-client.test.ts: Complete rewrite with proper protocol mock server (14 tests including framing contract regression)
  - test/integration/voice-turn.test.ts: Updated mock server to implement OpenClaw protocol
  - test/integration/config-hot-reload.test.ts: Updated mock servers to implement OpenClaw protocol
