# OpenClaw Even G2 Voice Gateway

## What This Is

A production-ready Node.js gateway service that bridges the Even G2 glasses chat app to OpenClaw AI agents via pluggable speech-to-text providers. The chat app (separate repo) sends captured audio to this gateway, which transcribes it, forwards the transcript to an OpenClaw session over WebSocket, shapes the response for the glasses viewport, and returns it. Designed to be installed alongside OpenClaw by community self-hosters.

## Core Value

A user wearing Even G2 glasses can tap to speak, and reliably get an AI response back on their glasses — the gateway must correctly orchestrate audio → transcription → OpenClaw → shaped response without losing turns or leaking secrets.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Receive audio payloads (PCM/WAV) from chat app via HTTP (PIPE-01) — v1.0
- ✓ Type-safe STT provider abstraction with `SttProvider` interface (PIPE-02) — v1.0
- ✓ All providers normalize to shared `SttResult` type (PIPE-03) — v1.0
- ✓ WhisperX self-hosted provider with async submit-then-poll (PIPE-04) — v1.0
- ✓ OpenAI STT cloud provider via synchronous API (PIPE-05) — v1.0
- ✓ Custom HTTP STT adapter with configurable URL/auth/mapping (PIPE-06) — v1.0
- ✓ Switch STT provider via settings without restart (PIPE-07) — v1.0
- ✓ WebSocket connection to OpenClaw for transcript/response (CLAW-01, CLAW-02) — v1.0
- ✓ Exponential backoff with jitter for STT/OpenClaw retries (CLAW-03) — v1.0
- ✓ Structured response envelope with fullText, segments, timing, meta (RESP-01) — v1.0
- ✓ Response text normalization (RESP-02) — v1.0
- ✓ Hard safety limits on payload/segment size (RESP-03) — v1.0
- ✓ Client-agnostic response contract (RESP-04) — v1.0
- ✓ POST/GET settings API with secret masking (CONF-01, CONF-02, CONF-05) — v1.0
- ✓ Configurable OpenClaw URL, auth, session key (CONF-03) — v1.0
- ✓ Configurable STT provider selection and credentials (CONF-04) — v1.0
- ✓ Health endpoint /healthz (OPS-01) — v1.0
- ✓ Readiness endpoint /readyz with provider checks (OPS-02) — v1.0
- ✓ Startup pre-checks before accepting traffic (OPS-03) — v1.0
- ✓ Structured JSON logging with TurnId correlation (OPS-04) — v1.0
- ✓ Per-turn timing breakdown in response metadata (OPS-05) — v1.0
- ✓ TypeScript strict mode, no `any` in core paths (SAFE-01) — v1.0
- ✓ Branded types for SessionKey, TurnId, ProviderId (SAFE-02) — v1.0
- ✓ Runtime input validation at all external boundaries (SAFE-03) — v1.0
- ✓ Error taxonomy: UserError + OperatorError (SAFE-04) — v1.0
- ✓ Secret masking in all log output (SAFE-05) — v1.0
- ✓ Request body size limits and rate limiting (SAFE-06) — v1.0
- ✓ CORS allowlist in strict mode (SAFE-07) — v1.0

### Active

<!-- Current scope. Building toward these. -->

(None yet — define with next milestone)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Glasses UI / display rendering — handled by separate chat app repo (`even-g2-openclaw-chat-app`)
- Even G2 bridge SDK integration — chat app repo responsibility
- Gesture handling (tap, double-tap, scroll) — chat app repo responsibility
- TTS (text-to-speech) — G2 glasses have no speakers
- Docker packaging — not needed, meant to run directly alongside OpenClaw
- Frontend web UI — settings managed via API from chat app
- Real-time streaming STT — tap-to-talk produces complete audio blobs; streaming adds complexity for no UX benefit
- Audio preprocessing (noise reduction, AEC) — STT providers handle noise internally
- Audio storage / recording persistence — privacy liability, process in memory only
- Multi-tenant / user management — single-user/household gateway
- STT model training / fine-tuning — gateway orchestrates STT, does not train models
- Offline mode — real-time OpenClaw connection is core value

## Context

Shipped v1.0 with 7,138 LOC TypeScript across a monorepo (`apps/` + `packages/`).
Tech stack: Node.js, TypeScript strict mode, Vitest, WebSocket (OpenClaw), HTTP (STT providers).
177 tests passing across unit, contract, and integration suites.
Three STT providers: WhisperX (self-hosted, default), OpenAI (cloud), Custom HTTP (generic).
Runtime configuration via settings API with hot-reload for providers and OpenClaw client.

**Known issues from v1.0 audit:**
- `normalizeText` orphaned export in response-policy (dead public API surface, harmless)
- CONF-05 settings are in-memory only (by design — env vars provide restart defaults)
- Two stale TODO comments in index.ts and orchestrator.ts (informational only)

**Blockers for next milestone:**
- OpenClaw WebSocket protocol details need validation against running instance
- Even Hub audio format (WebM/Opus vs CAF/AAC) needs confirmation

## Constraints

- **Language/runtime**: TypeScript + Node.js — strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **Architecture**: Monorepo with `apps/` and `packages/` — no cross-layer shortcuts
- **Testing**: Vitest-centric, aligned with OpenClaw standards
- **Security**: Never commit real tokens, mask secrets in logs, CORS allowlist, request size/rate limits
- **Code quality**: DRY, SRP, modular package boundaries
- **Deployment**: No Docker, easy npm install alongside OpenClaw
- **API versioning**: v1 endpoints, contract-first development

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Gateway-only repo (no glasses UI) | Glasses UI moved to separate chat app repo for independent release cycles and zero-secret frontend | ✓ Good — clean separation proven in v1.0 |
| Monorepo with packages/ | Clean boundaries for STT adapters, OpenClaw client, response policy — enables reuse | ✓ Good — 7 packages with clear contracts |
| HTTP API surface for chat app | Simpler browser compatibility, CORS-friendly, chat app makes standard fetch calls | ✓ Good — POST /api/voice/turn + settings API |
| WebSocket for OpenClaw | Live connection to OpenClaw gateway protocol for real-time session messaging | ✓ Good — persistent connection with reconnection |
| Split response responsibilities | Gateway does transport-safe normalization/chunk safety; frontend owns viewport pagination | ✓ Good — client-agnostic contract proven |
| WhisperX as default provider | Self-hosted, private, no vendor lock-in — best for community self-hosters | ✓ Good — works alongside other providers |
| ConfigStore as single source of truth | All config reads go through ConfigStore.get() for runtime mutability | ✓ Good — enables hot-reload |
| In-memory config (no persistence) | Env vars provide restart defaults; avoids file I/O complexity | ⚠️ Revisit — may want persistence in v2 |
| Branded type error conversion | TypeError from branded constructors → UserError for HTTP 400 boundary | ✓ Good — clean error taxonomy |
| RateLimiter reads live config | No onChange listener needed; reads configStore on every check() call | ✓ Good — simpler than listener pattern |

---
*Last updated: 2026-02-28 after v1.0 milestone*
