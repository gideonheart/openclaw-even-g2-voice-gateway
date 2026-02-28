# OVERNIGHT TODO — openclaw-even-g2-voice-gateway

## Mission
Ship production-ready backend gateway for Even G2 voice -> OpenClaw responses.

## Status Legend
- [ ] planned
- [~] in progress
- [x] done
- [!] blocked

## 1) Foundation
- [x] Scaffold project structure from PRD (`apps/`, `packages/`, `test/`, `docs/`)
- [x] Add strict TS config (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [x] Add Vitest config + baseline test scripts
- [x] Add lint/format scripts (minimal deps)

## 2) Core contracts (type-safe)
- [x] Define `VoiceTurnRequest`, `VoiceTurnResult`, `SttResult`, `GatewayReply`
- [x] Define `ProviderId` and provider capability contracts
- [x] Add runtime validation for external inputs (settings + API payloads)

## 3) STT providers
- [x] Implement `stt-contract` interface
- [x] Implement `stt-whisperx` adapter for `logingrupa/whisperX-FastAPI`
- [x] Implement `stt-openai` adapter
- [x] Implement `stt-custom-http` adapter
- [x] Add provider unit tests + normalization contract tests

## 4) OpenClaw integration
- [x] Implement `openclaw-client` for session messaging
- [x] Add retries/timeouts + correlation id in each turn
- [x] Add safe error mapping (user-safe + operator logs)
- [x] Add integration test with mocked OpenClaw responses

## 5) API service
- [x] Add HTTP endpoints: `/api/settings`, `/api/voice/turn`, `/healthz`, `/readyz`
- [x] Add rate limiting + payload size limits
- [x] Add masked logging for secrets/tokens

## 6) Streaming + response policy
- [x] Add response chunking policy for glasses viewport constraints
- [x] Add pagination metadata in API response
- [x] Add truncation safeguards with continuation markers

## 7) Docs + release
- [x] Write `docs/architecture.md`
- [x] Write `docs/security.md`
- [x] Write `docs/runbook.md`
- [x] Add `.env.example` (no secrets)
- [x] Update README quickstart (no Docker)

## 8) Push checkpoints
- [x] Commit foundation scaffold (3dde320)
- [x] Commit STT adapters + tests (3901d54)
- [x] Commit OpenClaw client + integration tests (a42657b)
- [x] Commit API + docs + release notes (89e6b6e)

## Blockers to surface immediately
- [x] Missing gateway auth/session details — resolved (configurable via settings API)
- [x] STT provider response mismatches — resolved (contract tests pass for all 3)
- [x] Any secret-management risk — resolved (SAFE-05 masking, CONF-05 protection)
