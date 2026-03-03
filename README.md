# OpenClaw Even G2 Voice Gateway

Voice-to-AI gateway for Even G2 smart glasses. Accepts audio, transcribes via pluggable STT providers, routes through OpenClaw for AI responses, and returns transport-safe structured output.

## Quick Start

```bash
# Prerequisites: Bun (https://bun.sh)

# Install
bun install
bun run build

# Configure
cp .env.example .env
# Edit .env with your OpenClaw URL, token, session key, and STT provider settings

# Run tests
bun test

# Start
bun services/gateway-api/dist/index.js
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

## Connection Architecture

The gateway participates in two distinct network roles:

- **PORT** (default `4400`): The port this gateway **listens** on. The G2 frontend (chat app) connects here via HTTP.
- **OPENCLAW_GATEWAY_URL** (e.g., `ws://127.0.0.1:3434`): The upstream OpenClaw WebSocket endpoint that the gateway **connects to** as a client.

```
G2 Frontend (Chat App)
       |
       |  HTTP POST /api/voice/turn
       v
ws://localhost:4400          <-- Gateway listens here (PORT=4400)
  Voice Gateway (this repo)
       |
       |  WebSocket (connect.challenge / hello-ok)
       v
ws://127.0.0.1:3434         <-- Gateway connects here (OPENCLAW_GATEWAY_URL)
  OpenClaw Agent
```

### Remote Access

By default, `localhost` URLs only work when the frontend and gateway run on the same machine. For remote G2 devices or frontends on other machines:

- Replace `localhost` with the server's LAN IP or hostname in the frontend's target URL (e.g., `ws://192.168.1.x:4400` or `ws://your-server.domain:4400`).
- The `HOST=0.0.0.0` default already binds the gateway to all network interfaces, so remote connections work without any config changes on the gateway side -- only the frontend's target URL needs updating.
- Similarly, if OpenClaw runs on a different machine, set `OPENCLAW_GATEWAY_URL` to the actual IP or hostname of the OpenClaw server (e.g., `ws://192.168.1.y:3434`).

For full architectural details, see [docs/architecture.md](docs/architecture.md).

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voice/turn` | POST | Send audio, get AI response |
| `/api/text/turn` | POST | Send text, get AI response (no STT) |
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
bun test              # Run all tests
bun run test:watch    # Watch mode
bun run typecheck     # Type-check without emitting
bun run lint          # Lint
bun run format        # Format
```

## License

MIT
