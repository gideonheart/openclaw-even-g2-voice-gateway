# OpenClaw Even G2 Voice Gateway

## What This Is

A production-ready Node.js gateway service that bridges the Even G2 glasses chat app to OpenClaw AI agents via pluggable speech-to-text providers. The chat app (separate repo) sends captured audio to this gateway, which transcribes it, forwards the transcript to an OpenClaw session over WebSocket, shapes the response for the glasses viewport, and returns it. Designed to be installed alongside OpenClaw by community self-hosters.

## Core Value

A user wearing Even G2 glasses can tap to speak, and reliably get an AI response back on their glasses — the gateway must correctly orchestrate audio → transcription → OpenClaw → shaped response without losing turns or leaking secrets.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Receive audio payloads (PCM/WAV) from chat app via HTTP
- [ ] Transcribe audio via WhisperX (self-hosted, default provider)
- [ ] Transcribe audio via OpenAI STT (cloud provider)
- [ ] Transcribe audio via generic Custom HTTP STT adapter
- [ ] Type-safe STT provider abstraction (`SttProvider` interface with `transcribe()`)
- [ ] All providers normalize to shared `SttResult` type
- [ ] Switch STT provider via settings without code changes
- [ ] Send transcript to OpenClaw session via WebSocket protocol
- [ ] Receive assistant response from OpenClaw session
- [ ] Shape responses for glasses viewport (pagination, truncation, window metadata)
- [ ] Settings API — configure OpenClaw URL, auth, session key, STT provider, credentials
- [ ] Validate and persist settings securely (no secrets in logs or responses)
- [ ] Health endpoint (`/healthz`) for liveness
- [ ] Readiness endpoint (`/readyz`) checking OpenClaw + STT provider reachability
- [ ] Structured logging with correlation IDs per voice turn
- [ ] Type-safe API boundaries (strict TS, no `any` in core paths)
- [ ] Branded IDs for critical keys (SessionKey, TurnId, ProviderId)
- [ ] Runtime input validation at external boundaries
- [ ] Retry/backoff for STT and OpenClaw network calls
- [ ] Comprehensive test suite (unit, contract, integration, smoke) with Vitest
- [ ] CI-ready: typecheck + tests + lint + secret scan all pass
- [ ] Easy install alongside OpenClaw — clear setup docs, `.env.example`

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Glasses UI / display rendering — handled by separate chat app repo (`even-g2-openclaw-chat-app`)
- Even G2 bridge SDK integration — chat app repo responsibility
- Gesture handling (tap, double-tap, scroll) — chat app repo responsibility
- TTS (text-to-speech) — G2 glasses have no speakers
- Docker packaging — not needed, meant to run directly alongside OpenClaw
- Frontend web UI — settings managed via API from chat app
- Monolithic single-file implementation — modular monorepo required

## Context

- **Chat app repo**: `/home/forge/bibele.kingdom.lv/samples/even-g2-openclaw-chat-app` — the Even Hub frontend that captures audio from glasses and displays responses. Communicates with this gateway over HTTP.
- **Communication contract**: Chat app POSTs audio to `POST /api/voice/turn`, receives JSON with transcript + transport-safe assistant payload (`fullText`, optional coarse `segments`, timing/meta). Viewport pagination/virtualization is frontend-owned. Settings via `POST/GET /api/settings`.
- **OpenClaw integration**: WebSocket connection to OpenClaw gateway, sending messages on a configured session and receiving agent responses.
- **WhisperX reference**: Uses Rolands' fork at `https://github.com/logingrupa/whisperX-FastAPI`. POST audio to `/speech-to-text`, poll task endpoint until complete.
- **WhisperX skill/runbook**: `/home/forge/.openclaw/workspace/skills/whisperx/SKILL.md`
- **Even G2 reference apps**: `https://github.com/KingAtoki/even-g2-apps` — UI patterns (relevant for chat app, not this repo)
- **User has running instances**: Both OpenClaw gateway and WhisperX-FastAPI are live and available for testing.
- **Target users**: OpenClaw self-hosters with Even G2 glasses, developers extending OpenClaw voice workflows, community users wanting reproducible G2/OpenClaw setup.

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
| Gateway-only repo (no glasses UI) | Glasses UI moved to separate chat app repo for independent release cycles and zero-secret frontend | — Pending |
| Monorepo with packages/ | Clean boundaries for STT adapters, OpenClaw client, response policy — enables reuse | — Pending |
| HTTP API surface for chat app | Simpler browser compatibility, CORS-friendly, chat app makes standard fetch calls | — Pending |
| WebSocket for OpenClaw | Live connection to OpenClaw gateway protocol for real-time session messaging | — Pending |
| Split response responsibilities | Gateway does transport-safe normalization/chunk safety; frontend owns viewport pagination/virtualization/rendering | — Accepted |
| WhisperX as default provider | Self-hosted, private, no vendor lock-in — best for community self-hosters | — Pending |

---
*Last updated: 2026-02-28 after initialization*
