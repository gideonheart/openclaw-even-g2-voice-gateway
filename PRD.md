# PRD — openclaw-even-g2-voice-gateway

## 0) Purpose
Build a production-ready, community-usable **Even G2 voice gateway module** for OpenClaw so users can talk to an OpenClaw agent from G2 glasses (Telegram-like flow), with pluggable STT providers and strict engineering quality (type safety + tests).

---

## 1) Product Goals

### Primary Goal
Enable this end-to-end loop on Even G2:
1. Tap glasses to start recording
2. Tap glasses to stop recording
3. Audio is transcribed via selected STT provider
4. Transcript is sent to OpenClaw session
5. Agent response is rendered back on glasses

### Secondary Goals
- Support multiple STT providers (not WhisperX-only)
- Reusable architecture for other teams
- Secure-by-default config and deployment
- Open-source quality aligned with OpenClaw standards

### Non-Goals (v1)
- No Docker requirement
- No TTS (glasses have no speakers)
- No monolithic single-file implementation
- No hardcoded secret values

---

## 2) Constraints (explicit)
- Language/runtime: **TypeScript + Node.js**
- Code quality: **DRY, SRP**, modular boundaries
- UI layer: use **EvenRealities native UI approach/components**, aligned with:
  - https://github.com/KingAtoki/even-g2-apps
- Config: all operational settings manageable from frontend settings menu and persisted safely
- Testing approach: align with OpenClaw style (Vitest-centric)

---

## 3) Users
1. OpenClaw self-hosters with Even G2 glasses
2. Developers extending OpenClaw-compatible voice workflows
3. Community users wanting a reproducible, secure G2/OpenClaw setup

---

## 4) Functional Requirements

### FR-1: G2 Voice Capture
- Capture PCM audio frames via Even bridge events
- Handle tap-to-start/tap-to-stop reliably
- Show clear recording state in UI and logs

### FR-2: STT Provider Abstraction
Define type-safe provider interface:
- `transcribe(input: AudioPayload, ctx: SttContext): Promise<SttResult>`

Required providers (v1):

1) **WhisperX (self-hosted) — default provider**
- What it is: self-hosted speech-to-text backend (fast + private, no vendor lock-in).
- Why include: best for users who want local control over audio/transcripts.
- Reference:
  - WhisperX project: https://github.com/m-bain/whisperX
- In this gateway, expected config:
  - `STT_PROVIDER=whisperx`
  - `WHISPERX_BASE_URL=https://your-whisperx-host`
- Request sample (conceptual):
  - `POST /speech-to-text` with multipart audio file
  - poll task endpoint until completed

2) **OpenAI STT (API key)**
- What it is: managed cloud transcription provider.
- Why include: simple onboarding and good reliability for users who do not self-host STT.
- Reference:
  - OpenAI platform docs: https://platform.openai.com/docs/guides/speech-to-text
- In this gateway, expected config:
  - `STT_PROVIDER=openai`
  - `OPENAI_API_KEY=...`

3) **Generic Custom HTTP STT**
- What it is: adapter interface for any external STT service with HTTP API.
- Why include: extensibility (Deepgram, AssemblyAI, enterprise internal STT, etc.) without code rewrite.
- In this gateway, expected config:
  - `STT_PROVIDER=custom`
  - `CUSTOM_STT_URL=https://your-stt-endpoint`
  - `CUSTOM_STT_AUTH=Bearer ...` (or provider-specific secret)
- Contract sample:
  - Request: audio blob + metadata (`sampleRate`, `languageHint`)
  - Response (normalized):
    ```json
    { "text": "transcribed text", "language": "en", "confidence": 0.92 }
    ```

Provider implementation note:
- All providers must map into a shared `SttResult` type so downstream OpenClaw messaging logic stays provider-agnostic.

### FR-3: OpenClaw Session Messaging
- Send transcript to configured OpenClaw target session
- Receive assistant response
- Support configurable response shaping for glasses (truncation/pagination)

### FR-4: Glasses Output
- Render response to glasses text container(s)
- Preserve readable formatting
- Handle long replies safely

### FR-5: Settings + Configuration
Configurable from frontend settings menu:
- OpenClaw URL
- OpenClaw auth token
- Target session key
- STT provider selection
- Provider-specific credentials/URLs
- Timeout/retry knobs (advanced section)

Persist settings with secure local storage strategy.

### FR-6: Observability
- On-page debug panel (full-height practical logs)
- Structured server logs with correlation IDs per voice turn
- Health/readiness endpoints

---

## 5) Non-Functional Requirements
- Type-safe API boundaries (no `any` in core paths)
- Strong error taxonomy (user-safe + operator-detailed)
- Retry/backoff for network calls
- No secret leakage in logs
- Minimal dependency surface
- Works in same-host and remote-host deployments

---

## 6) Architecture (SRP/DRY)

## 6.1 Repo Root
`/home/forge/openclaw-even-g2-voice-gateway`

## 6.2 Proposed Structure

```
apps/
  g2-client/                # Even Hub frontend app (native UI style)
  gateway-adapter/          # Node service: orchestration + API surface

packages/
  stt-contract/             # STT interfaces + shared types
  stt-whisperx/             # WhisperX adapter
  stt-openai/               # OpenAI STT adapter
  stt-custom-http/          # Generic HTTP adapter
  openclaw-client/          # OpenClaw gateway/session client
  response-policy/          # Glasses response shaping (pagination/truncation)
  logging/                  # structured logger + correlation
  validation/               # schema + runtime guards
  shared-types/             # canonical domain types

test/
  unit/
  integration/
  contract/

docs/
  architecture.md
  security.md
  runbook.md
```

No cross-layer shortcuts: apps depend on packages, not vice versa.

---

## 7) Type Safety Standards
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- Branded IDs for critical keys (`SessionKey`, `TurnId`, `ProviderId`)
- Runtime input validation for external boundaries (HTTP/UI/provider responses)
- Exhaustive switch handling for provider/result states

---

## 8) Testing Strategy (aligned with OpenClaw)

Use **Vitest** as primary suite (matching OpenClaw tooling direction).

### Required test layers
1. **Unit tests**
   - STT adapters
   - response shaping
   - parser/validation utilities
2. **Contract tests**
   - provider output normalization
   - OpenClaw client request/response contract
3. **Integration tests**
   - end-to-end mocked voice turn: PCM -> STT -> OpenClaw -> glasses payload
4. **Smoke tests**
   - startup configuration checks
   - health/readiness endpoints

### CI expectation
- `typecheck` passes
- unit + integration tests pass
- lint + formatting checks pass
- no secret patterns in repo (`gitleaks` style pass or equivalent secret scan)

---

## 9) Security Requirements
- Never commit real tokens/keys
- `.env.example` only placeholders
- Token masking in logs
- CORS allowlist strict mode
- Request size limits and rate limits
- Explicit auth failure messages without sensitive detail
- Session key allowlist support for outbound OpenClaw calls

---

## 10) Config Model

### Backend env keys (initial)
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_SESSION_KEY`
- `STT_PROVIDER`
- `WHISPERX_BASE_URL`
- `OPENAI_API_KEY`
- `CUSTOM_STT_URL`
- `CUSTOM_STT_AUTH`

### Frontend settings mirror
All above configurable from settings UI and synced to backend config endpoint (validated, encrypted-at-rest where applicable).

---

## 11) API Surface (v1 draft)

### `POST /api/voice/start`
Initializes turn context (optional).

### `POST /api/voice/stop`
Accepts captured PCM/WAV payload and processes full pipeline.

### `POST /api/settings`
Validates and stores runtime config.

### `GET /api/settings`
Returns safe subset + provider metadata.

### `GET /healthz`
Liveness check.

### `GET /readyz`
Dependency readiness (OpenClaw reachable, selected STT provider ready).

---

## 12) OpenClaw Best Practices to Follow
1. Single gateway/control-plane responsibility
2. Strong protocol contracts and explicit handshakes
3. Scope-based auth and policy-driven operations
4. Operational runbooks + diagnostics first
5. Configuration validation and safe defaults

Reference docs:
- Gateway runbook: https://docs.openclaw.ai/gateway
- Gateway protocol: https://docs.openclaw.ai/gateway/protocol
- Configuration: https://docs.openclaw.ai/gateway/configuration

Reference repos:
- OpenClaw: https://github.com/openclaw/openclaw
- Even G2 UI patterns: https://github.com/KingAtoki/even-g2-apps
- Clawbber (comparison/reference): https://github.com/robotrooster/clawbber

---

## 13) Milestones

### M1 — Foundation
- Repo scaffold
- Type-safe domain contracts
- Basic settings UI
- WhisperX provider integrated
- OpenClaw session messaging integrated

### M2 — Provider Extensibility
- OpenAI STT adapter
- Custom HTTP adapter
- Provider test matrix

### M3 — Hardening
- Full test suite + CI gates
- Security hardening checks
- Community-grade docs and runbook

---

## 14) Acceptance Criteria
- A user can complete 10 voice turns from G2 to OpenClaw and receive responses on glasses
- Switching STT provider in settings works without code changes
- All core modules are type-safe and covered by tests
- No secrets leaked in code or logs
- Project is publish-ready with setup docs

---

## 15) Risks & Mitigations
- **Even bridge event inconsistencies** → add compatibility layer + event normalization tests
- **Provider API drift** → strict adapter contracts + contract tests
- **Network instability** → retries + timeout + user-visible state machine
- **Config misuse** → schema validation + startup fail-fast

---

## 16) Initial Definition of Done (for first public release)
- Public repo initialized
- PRD + architecture + runbook present
- Working WhisperX + OpenAI STT provider options
- OpenClaw response path verified on real G2 device
- CI green on typecheck + tests + lint
- Release tag + changelog
