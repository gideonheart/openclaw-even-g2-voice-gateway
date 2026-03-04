---
status: resolved
trigger: "The gateway backend reportedly does not implement a text endpoint (/text/turn), so typed text chat from the g2-frontend cannot be sent through the gateway API."
created: 2026-03-01T00:00:00Z
updated: 2026-03-01T00:02:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED
test: All tests pass in both gateway (200/200) and frontend (538/538)
expecting: N/A - resolved
next_action: Archive session

## Symptoms

expected: Text chat typed in g2-frontend should be processable through the voice gateway
actual: Gateway has no /text/turn endpoint; frontend's text turn calls fail
errors: Gateway returns error when frontend POSTs to /text/turn
reproduction: Type text in g2-frontend app and attempt to send
started: Feature was never implemented in gateway - voice-only design

## Eliminated

- hypothesis: Frontend might call a different endpoint or have alternative text path
  evidence: Frontend sendTextTurn is explicitly a stub that emits error. No alternative path exists.
  timestamp: 2026-03-01T00:00:30Z

- hypothesis: OpenClaw client might not support sending raw text (only STT output)
  evidence: OpenClawClient.sendTranscript takes a plain string - it's text-agnostic.
  timestamp: 2026-03-01T00:00:40Z

## Evidence

- timestamp: 2026-03-01T00:00:10Z
  checked: Gateway server.ts route definitions
  found: No text endpoint existed. Only voice/turn, settings, healthz, readyz.
  implication: Any POST to /api/text/turn returned 404.

- timestamp: 2026-03-01T00:00:15Z
  checked: Frontend gateway-client.ts sendTextTurn function
  found: sendTextTurn was a STUB that immediately emits error. Never made a fetch call.
  implication: Frontend knew the endpoint didn't exist and short-circuited.

- timestamp: 2026-03-01T00:00:35Z
  checked: Gateway orchestrator.ts executeVoiceTurn
  found: Pipeline is Audio -> STT -> OpenClaw -> Response Shaping. Text turns skip STT.
  implication: Text turn is a simplified subset of voice turn.

- timestamp: 2026-03-01T00:00:40Z
  checked: OpenClawClient.sendTranscript method
  found: Takes (sessionKey, turnId, text:string) - completely text-agnostic.
  implication: OpenClaw client already supports text turns natively. No changes needed there.

## Resolution

root_cause: Gateway was designed as voice-only; POST /api/text/turn endpoint was never implemented. Frontend sendTextTurn was left as a stub. The OpenClaw client already supported sending text - only the HTTP route and frontend client code were missing.

fix: Two-part fix across both codebases:

GATEWAY (openclaw-even-g2-voice-gateway):
1. Added TextTurnRequest/TextTurnResult types to shared-types
2. Added "text" as a valid ProviderId for text turns (no STT provider)
3. Added executeTextTurn() to orchestrator (skips STT, sends text directly to OpenClaw)
4. Added POST /api/text/turn route to server (JSON body {text: string}, returns GatewayReply)
5. Added CORS header for X-Session-Key

FRONTEND (even-g2-openclaw-chat-app):
6. Replaced sendTextTurn stub with real implementation (POST JSON to /api/text/turn)
7. Updated sendTextTurn tests to match JSON response format (was SSE)
8. Updated sendVoiceTurn tests to match current JSON response implementation

verification: |
  Gateway: 200 tests pass (20 files) - includes new orchestrator and integration tests
  Frontend: 538 tests pass (38 files) - includes updated gateway-client tests
  New tests added:
    - orchestrator.test.ts: 2 tests for executeTextTurn
    - text-turn.test.ts: 6 integration tests (happy path, content type validation, empty text, missing field, invalid JSON, rate limiting)

files_changed:
  # Gateway
  - packages/shared-types/src/voice-turn.ts (added TextTurnRequest, TextTurnResult types)
  - packages/shared-types/src/index.ts (exported new types)
  - packages/shared-types/src/branded.ts (added "text" to valid ProviderIds)
  - services/gateway-api/src/orchestrator.ts (added executeTextTurn, TextTurnDeps)
  - services/gateway-api/src/server.ts (added POST /api/text/turn route and handler)
  - services/gateway-api/src/orchestrator.test.ts (added executeTextTurn tests)
  - test/integration/text-turn.test.ts (new: 6 integration tests)
  # Frontend
  - src/api/gateway-client.ts (replaced sendTextTurn stub with real implementation)
  - src/__tests__/gateway-client.test.ts (updated text and voice turn tests)
