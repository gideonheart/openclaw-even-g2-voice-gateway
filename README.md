# OpenClaw Even G2 Voice Gateway

Voice-to-AI gateway for Even G2 smart glasses. Accepts audio, transcribes via pluggable STT providers, routes through OpenClaw for AI responses, and returns transport-safe structured output.

## Quick Start

```bash
# Prerequisites: Node.js >= 20

# Install
npm install
npm run build

# Configure
cp .env.example .env
# Edit .env with your OpenClaw URL, token, session key, and STT provider settings

# Run tests
npm test

# Start
node services/gateway-api/dist/index.js
```

The server starts on port 4400 (configurable via `PORT`).

## How It Works

```
Audio (POST /api/voice/turn)
  → STT transcription (WhisperX / OpenAI / Custom HTTP)
  → OpenClaw agent session (WebSocket)
  → Response shaping (segmentation + truncation)
  → Structured JSON response
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voice/turn` | POST | Send audio, get AI response |
| `/api/settings` | POST | Update runtime config |
| `/api/settings` | GET | View config (secrets masked) |
| `/healthz` | GET | Liveness probe |
| `/readyz` | GET | Readiness probe (checks dependencies) |

## STT Providers

Three providers ship out of the box:

- **WhisperX** — Self-hosted, async submit-then-poll (`logingrupa/whisperX-FastAPI`)
- **OpenAI** — Cloud, synchronous Whisper API
- **Custom HTTP** — Bring your own STT endpoint with configurable field mapping

Switch providers at runtime via `POST /api/settings` with `{"sttProvider": "openai"}`.

## Project Structure

```
packages/
  shared-types/       # Domain types, branded IDs, error taxonomy
  stt-contract/       # SttProvider interface
  stt-whisperx/       # WhisperX adapter
  stt-openai/         # OpenAI adapter
  stt-custom-http/    # Custom HTTP adapter
  openclaw-client/    # WebSocket client with retry
  response-policy/    # Response shaping for glasses viewport
  validation/         # Input validation guards
  logging/            # Structured JSON logger with secret masking
services/
  gateway-api/        # HTTP server + orchestrator
```

## Documentation

- [Architecture](docs/architecture.md) — System design and data flow
- [Security](docs/security.md) — Threat model, secret protection, input validation
- [Runbook](docs/runbook.md) — Configuration reference, troubleshooting, operations

## Development

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run typecheck     # Type-check without emitting
npm run lint          # Lint
npm run format        # Format
```

## License

MIT
