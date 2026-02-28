# Requirements: OpenClaw Even G2 Voice Gateway

**Defined:** 2026-02-28
**Core Value:** A user wearing Even G2 glasses can tap to speak and reliably get an AI response back — the gateway must correctly orchestrate audio → transcription → OpenClaw → structured response without losing turns or leaking secrets.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Voice Pipeline

- [ ] **PIPE-01**: Gateway accepts audio payloads (PCM/WAV) via HTTP POST with content-type validation and size limits
- [ ] **PIPE-02**: Type-safe STT provider abstraction interface (`SttProvider` with `transcribe(audio, ctx): Promise<SttResult>`)
- [ ] **PIPE-03**: All STT providers normalize output to shared `SttResult` type (text, language, confidence)
- [ ] **PIPE-04**: WhisperX self-hosted provider using async submit-then-poll pattern with timeout and cancellation
- [ ] **PIPE-05**: OpenAI STT cloud provider using synchronous transcription API
- [ ] **PIPE-06**: Custom HTTP STT adapter with configurable URL, auth header, and request/response mapping
- [ ] **PIPE-07**: User can switch STT provider via settings API without code changes or restart

### OpenClaw Integration

- [ ] **CLAW-01**: Gateway connects to OpenClaw gateway via WebSocket protocol and sends transcript on configured session
- [ ] **CLAW-02**: Gateway receives assistant response from OpenClaw session over WebSocket
- [ ] **CLAW-03**: Network calls to STT providers and OpenClaw use exponential backoff with jitter on transient failures

### Response Shaping

- [ ] **RESP-01**: Gateway returns structured response envelope: `{ turnId, sessionKey, assistant: { fullText, segments[], truncated }, timing: { sttMs, agentMs, totalMs }, meta: { provider, model } }`
- [ ] **RESP-02**: Response text is normalized (control characters stripped, line endings unified, semantic blocks preserved)
- [ ] **RESP-03**: Hard safety limits enforced on max payload size and max segment size to prevent client crashes
- [ ] **RESP-04**: Response contract is client-agnostic — no viewport dimensions, bubble widths, or scroll position assumptions

### Configuration

- [ ] **CONF-01**: `POST /api/settings` validates and stores runtime configuration
- [ ] **CONF-02**: `GET /api/settings` returns safe subset with secrets masked
- [x] **CONF-03**: Configurable: OpenClaw gateway URL, auth token, target session key
- [x] **CONF-04**: Configurable: STT provider selection and provider-specific credentials/URLs
- [ ] **CONF-05**: Settings persisted securely — secrets never appear in API responses or logs

### Observability

- [ ] **OPS-01**: `GET /healthz` returns liveness status
- [ ] **OPS-02**: `GET /readyz` checks reachability of OpenClaw gateway and selected STT provider
- [ ] **OPS-03**: Startup pre-check validates provider and OpenClaw connectivity before accepting traffic
- [ ] **OPS-04**: Structured JSON logging with per-turn correlation IDs (`TurnId`) propagated through all operations
- [ ] **OPS-05**: Per-turn timing breakdown included in response metadata (sttMs, agentMs, totalMs)

### Safety

- [ ] **SAFE-01**: TypeScript strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — no `any` in core paths
- [ ] **SAFE-02**: Branded types for critical identifiers (SessionKey, TurnId, ProviderId) preventing accidental misuse
- [x] **SAFE-03**: Runtime input validation at all external boundaries (HTTP payloads, provider responses, settings)
- [ ] **SAFE-04**: Error taxonomy: `UserError` (safe message for chat app) and `OperatorError` (detailed for logs/debugging)
- [ ] **SAFE-05**: Secret masking in all structured log output — auth headers, API keys, tokens never logged
- [ ] **SAFE-06**: Request body size limits (max audio payload) and rate limiting per IP
- [ ] **SAFE-07**: CORS allowlist in strict mode — only configured origins accepted

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Resilience

- **FAIL-01**: STT provider failover/fallback chain — auto-try next provider if primary fails
- **FAIL-02**: Graceful WebSocket reconnection with exponential backoff, re-authentication, and message queue during reconnect window
- **FAIL-03**: Circuit breaker pattern prevents hammering a dead STT provider

### Enhanced Pipeline

- **TURN-01**: Turn state machine with explicit lifecycle states (IDLE, TRANSCRIBING, SENT, THINKING, DONE, ERROR) emitted in responses
- **TURN-02**: Language hint passthrough from chat app to STT provider for improved non-English accuracy
- **HIST-01**: Conversation history management — in-memory store keyed by session for context-aware interactions
- **HIST-02**: Conversation history API for chat app to retrieve history on reconnect

### Advanced Response Policy

- **RPOL-01**: Configurable response policy parameters (maxSegmentSize, splitStrategy, maxSegments)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Glasses UI / display rendering | Owned by separate chat app repo (`even-g2-openclaw-chat-app`) |
| Even G2 bridge SDK integration | Chat app repo responsibility — gateway is API-only |
| Viewport pagination / virtualization | Frontend responsibility — gateway returns client-agnostic structured data |
| Text-to-Speech (TTS) | G2 glasses have no speakers |
| Docker packaging | Not needed — meant to run alongside OpenClaw via npm |
| Real-time streaming STT | Tap-to-talk produces complete audio blobs; streaming adds massive complexity for no UX benefit |
| Voice Activity Detection (VAD) | Belongs in audio capture layer (chat app / glasses firmware) |
| Audio preprocessing (noise reduction, AEC) | STT providers handle noise internally; gateway passes audio through |
| Audio storage / recording persistence | Privacy liability — process in memory, discard after transcription |
| Multi-tenant / user management | Single-user/household gateway — run multiple instances if needed |
| STT model training / fine-tuning | Gateway orchestrates STT, does not train models |
| Frontend web UI | Settings managed via API from chat app |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-01 | Phase 1 | Pending |
| PIPE-02 | Phase 1 | Pending |
| PIPE-03 | Phase 1 | Pending |
| PIPE-04 | Phase 1 | Pending |
| PIPE-05 | Phase 3 | Pending |
| PIPE-06 | Phase 3 | Pending |
| PIPE-07 | Phase 3 | Pending |
| CLAW-01 | Phase 1 | Pending |
| CLAW-02 | Phase 1 | Pending |
| CLAW-03 | Phase 1 | Pending |
| RESP-01 | Phase 1 | Pending |
| RESP-02 | Phase 1 | Pending |
| RESP-03 | Phase 1 | Pending |
| RESP-04 | Phase 1 | Pending |
| CONF-01 | Phase 2 | Pending |
| CONF-02 | Phase 2 | Pending |
| CONF-03 | Phase 2 | Complete |
| CONF-04 | Phase 2 | Complete |
| CONF-05 | Phase 2 | Pending |
| OPS-01 | Phase 1 | Pending |
| OPS-02 | Phase 2 | Pending |
| OPS-03 | Phase 2 | Pending |
| OPS-04 | Phase 1 | Pending |
| OPS-05 | Phase 1 | Pending |
| SAFE-01 | Phase 1 | Pending |
| SAFE-02 | Phase 1 | Pending |
| SAFE-03 | Phase 2 | Complete |
| SAFE-04 | Phase 1 | Pending |
| SAFE-05 | Phase 2 | Pending |
| SAFE-06 | Phase 2 | Pending |
| SAFE-07 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-02-28*
*Last updated: 2026-02-28 after roadmap creation*
