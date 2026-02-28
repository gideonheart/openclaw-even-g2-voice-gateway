# Architecture

## Overview

The OpenClaw Even G2 Voice Gateway is a backend HTTP service that orchestrates voice-to-AI-response pipelines for Even G2 smart glasses. A user taps to speak, audio is sent to the gateway, transcribed via a pluggable STT provider, forwarded to an OpenClaw agent session over WebSocket, and the response is shaped into transport-safe segments returned to the client.

This repo is **backend gateway only**. The frontend chat app lives in a separate repository (`even-g2-openclaw-chat-app`) and owns all viewport rendering, pagination, and glasses UI concerns.

## System Context

```
┌─────────────────────┐     HTTP POST       ┌──────────────────────┐
│  Even G2 Chat App   │ ──────────────────►  │   Voice Gateway      │
│  (separate repo)    │ ◄──────────────────  │   (this repo)        │
└─────────────────────┘   JSON response      └──────┬───────┬───────┘
                                                     │       │
                                           STT API   │       │  WebSocket
                                                     ▼       ▼
                                              ┌──────────┐ ┌──────────┐
                                              │ STT      │ │ OpenClaw │
                                              │ Provider │ │ Gateway  │
                                              └──────────┘ └──────────┘
```

## Monorepo Structure

```
openclaw-even-g2-voice-gateway/
├── packages/
│   ├── shared-types/      # Branded types, config types, error taxonomy, domain types
│   ├── stt-contract/      # SttProvider interface (PIPE-02)
│   ├── stt-whisperx/      # WhisperX adapter: async submit-then-poll (PIPE-04)
│   ├── stt-openai/        # OpenAI adapter: synchronous transcription (PIPE-05)
│   ├── stt-custom-http/   # Custom HTTP adapter: configurable mapping (PIPE-06)
│   ├── openclaw-client/   # WebSocket client with retry + correlation IDs
│   ├── response-policy/   # Response shaping: segmentation, truncation, normalization
│   ├── validation/        # Input validation guards (audio type, size, URLs)
│   └── logging/           # Structured JSON logger with secret masking
├── services/
│   └── gateway-api/       # HTTP server, orchestrator, config-store, entry point
├── test/
│   ├── contract/          # STT provider contract tests (all 3 providers)
│   └── integration/       # End-to-end voice turn tests
├── docs/                  # This directory
├── .env.example           # Environment variable template
├── tsconfig.json          # Root project references config
├── vitest.config.ts       # Test configuration
└── package.json           # Workspace root
```

## Voice Turn Pipeline

Every voice turn follows this exact sequence:

```
1. HTTP POST /api/voice/turn
   ├── Readiness gate check (503 if not ready)
   ├── CORS validation (403 if origin not allowed)
   ├── Rate limit check (429 if exceeded)
   ├── Read body (with size limit)
   ├── Validate content-type (audio/wav, audio/webm, etc.)
   └── Validate audio size

2. Orchestrator (executeVoiceTurn)
   ├── Select active STT provider from ConfigStore
   ├── Transcribe audio → SttResult { text, language, confidence }
   ├── Send transcript to OpenClaw via WebSocket
   ├── Receive assistant response
   └── Shape response (segment, truncate, normalize)

3. Return GatewayReply
   {
     turnId, sessionKey,
     assistant: { fullText, segments[], truncated },
     timing: { sttMs, agentMs, totalMs },
     meta: { provider, model }
   }
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Branded types (TurnId, SessionKey, ProviderId) | Prevents accidental string misuse at compile time |
| UserError / OperatorError taxonomy | User-safe messages for the chat app; detailed diagnostics for operators only |
| ConfigStore with runtime mutation | Chat app can update settings via API without gateway restart |
| Secret masking at log + API boundaries | Auth tokens, API keys never appear in responses or log output |
| Provider interface abstraction | Adding a new STT provider requires zero changes to orchestrator |
| Response shaping in gateway | Client-agnostic segments; frontend owns viewport rendering |
| In-memory rate limiter per IP | Adequate for single-instance deployment alongside OpenClaw |

## Dependency Graph

```
shared-types ◄── stt-contract ◄── stt-whisperx
             ◄── logging       ◄── stt-openai
             ◄── validation    ◄── stt-custom-http
                               ◄── openclaw-client
                               ◄── response-policy
                                        │
                               gateway-api (orchestrator + server)
                               uses all of the above
```

## TypeScript Configuration

- `strict: true` with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- No `any` on core paths
- Project references for incremental builds
- ES2022 target, Node16 module resolution

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/voice/turn` | Execute a voice turn (audio in, structured response out) |
| POST | `/api/settings` | Update runtime configuration |
| GET | `/api/settings` | Get current config with secrets masked |
| GET | `/healthz` | Liveness probe (always responds) |
| GET | `/readyz` | Readiness probe (checks STT + OpenClaw health) |
