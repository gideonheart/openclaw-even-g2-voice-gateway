# Roadmap: OpenClaw Even G2 Voice Gateway

## Overview

This roadmap delivers a production-ready voice gateway in three phases, following the monorepo dependency graph bottom-up. Phase 1 builds the complete end-to-end voice pipeline (audio in through shaped response out) with one STT provider, establishing the architecture and proving the core value works. Phase 2 layers on runtime configuration, observability, and production safety hardening. Phase 3 adds additional STT providers, proving the abstraction is genuinely pluggable and delivering extensibility for the community.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Core Voice Pipeline** - Monorepo foundation, WhisperX adapter, OpenClaw client, response shaping -- one complete voice turn end-to-end
- [ ] **Phase 2: Configuration and Hardening** - Settings API, readiness checks, runtime validation, secret protection, CORS, rate limiting
- [ ] **Phase 3: Provider Extensibility** - OpenAI and Custom HTTP adapters, runtime provider switching

## Phase Details

### Phase 1: Core Voice Pipeline
**Goal**: A developer can send an audio payload to the gateway and receive a shaped AI response back through the complete pipeline: audio ingestion, WhisperX transcription, OpenClaw session round-trip, and structured response envelope with timing metadata
**Depends on**: Nothing (first phase)
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04, CLAW-01, CLAW-02, CLAW-03, RESP-01, RESP-02, RESP-03, RESP-04, OPS-01, OPS-04, OPS-05, SAFE-01, SAFE-02, SAFE-04
**Success Criteria** (what must be TRUE):
  1. Sending a WAV audio payload to POST /api/voice/turn returns a JSON response containing transcript text and a transport-safe assistant response envelope (fullText + optional coarse segments), timing breakdown, and provider metadata
  2. The WhisperX adapter handles the async submit-then-poll pattern with timeout and cancellation -- a hung WhisperX instance does not hang the gateway
  3. The gateway maintains a persistent WebSocket connection to OpenClaw, sends transcripts on a configured session, and receives assistant responses without losing turns
  4. Network failures to WhisperX or OpenClaw trigger exponential backoff retries, and transient failures recover automatically
  5. Every voice turn is traceable end-to-end via a branded TurnId correlation ID present in all log entries, the outbound OpenClaw message, and the HTTP response
**Plans**: TBD

Plans:
- [ ] 01-01: TBD
- [ ] 01-02: TBD
- [ ] 01-03: TBD

### Phase 2: Configuration and Hardening
**Goal**: The gateway is runtime-configurable from the chat app, validates all external input, protects secrets, and reports its own health -- ready for production use alongside OpenClaw
**Depends on**: Phase 1
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, OPS-02, OPS-03, SAFE-03, SAFE-05, SAFE-06, SAFE-07
**Success Criteria** (what must be TRUE):
  1. The chat app can POST settings (OpenClaw URL, auth token, session key, STT provider, provider credentials) and GET them back with all secrets masked -- no secret ever appears in an API response or log output
  2. GET /readyz returns healthy only when both the configured STT provider and OpenClaw gateway are reachable, and the gateway refuses traffic until startup pre-checks pass
  3. Malformed HTTP payloads, oversized audio, and requests from non-allowlisted origins are rejected with clear error responses before reaching any business logic
  4. Rate limiting prevents abuse of the voice endpoint, and request body size limits prevent memory exhaustion from oversized audio payloads
**Plans**: TBD

Plans:
- [ ] 02-01: TBD
- [ ] 02-02: TBD

### Phase 3: Provider Extensibility
**Goal**: The STT layer is genuinely pluggable -- adding the OpenAI and Custom HTTP adapters requires zero changes to the gateway orchestrator or SttProvider interface, and providers are switchable at runtime via settings
**Depends on**: Phase 2
**Requirements**: PIPE-05, PIPE-06, PIPE-07
**Success Criteria** (what must be TRUE):
  1. Switching the STT provider from WhisperX to OpenAI (or Custom HTTP) via the settings API produces a valid transcription through the same voice turn endpoint without code changes or restart
  2. The OpenAI adapter handles synchronous transcription via the official SDK, and the Custom HTTP adapter supports configurable URL, auth header, and request/response mapping
  3. All three providers pass an identical contract test suite verifying they accept the same input and produce conformant SttResult output
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Voice Pipeline | 0/3 | Not started | - |
| 2. Configuration and Hardening | 0/2 | Not started | - |
| 3. Provider Extensibility | 0/1 | Not started | - |
