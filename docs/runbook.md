# Runbook

## Quick Reference

| Action | Command |
|--------|---------|
| Install | `npm install` |
| Build | `npm run build` |
| Run tests | `npm test` |
| Type-check | `npm run typecheck` |
| Start server | `node services/gateway-api/dist/index.js` |
| Liveness check | `curl http://localhost:4400/healthz` |
| Readiness check | `curl http://localhost:4400/readyz` |
| Get config | `curl http://localhost:4400/api/settings` |

## Prerequisites

- Node.js >= 20.0.0
- npm (comes with Node.js)
- A running OpenClaw gateway instance (WebSocket)
- At least one STT provider accessible (WhisperX, OpenAI, or custom)

## Installation

```bash
git clone <repo-url>
cd openclaw-even-g2-voice-gateway
npm install
npm run build
```

## Configuration

Copy `.env.example` and set values:

```bash
cp .env.example .env
```

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENCLAW_GATEWAY_URL` | OpenClaw WebSocket URL | `ws://localhost:3000` |
| `OPENCLAW_GATEWAY_TOKEN` | Auth token for OpenClaw | `your-token` |
| `OPENCLAW_SESSION_KEY` | Target session key | `my-session` |
| `STT_PROVIDER` | Active provider: `whisperx`, `openai`, or `custom` | `whisperx` |

### Provider-Specific Variables

**WhisperX (self-hosted):**
| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPERX_BASE_URL` | `https://wsp.kingdom.lv` | WhisperX API base URL |
| `WHISPERX_MODEL` | `medium` | Model size |
| `WHISPERX_LANGUAGE` | `en` | Default language |
| `WHISPERX_POLL_INTERVAL_MS` | `3000` | Poll interval for async results |
| `WHISPERX_TIMEOUT_MS` | `300000` | Max wait time (5 minutes) |

**OpenAI:**
| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *(empty)* | OpenAI API key |
| `OPENAI_STT_MODEL` | `whisper-1` | Model name |
| `OPENAI_STT_LANGUAGE` | `en` | Default language |

**Custom HTTP:**
| Variable | Default | Description |
|----------|---------|-------------|
| `CUSTOM_STT_URL` | *(empty)* | STT endpoint URL |
| `CUSTOM_STT_AUTH` | *(empty)* | Authorization header value |
| `CUSTOM_STT_TEXT_FIELD` | `text` | Response field for transcript text |
| `CUSTOM_STT_LANGUAGE_FIELD` | `language` | Response field for detected language |
| `CUSTOM_STT_CONFIDENCE_FIELD` | `confidence` | Response field for confidence score |

### Server Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4400` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `CORS_ORIGINS` | *(empty = allow all)* | Comma-separated allowed origins |
| `MAX_AUDIO_BYTES` | `26214400` (25MB) | Max audio upload size |
| `RATE_LIMIT_PER_MINUTE` | `60` | Rate limit per IP |

## Starting the Server

```bash
# With .env file loaded (using your preferred method)
node services/gateway-api/dist/index.js
```

The server will:
1. Load config from environment variables
2. Initialize all STT providers
3. Initialize OpenClaw WebSocket client
4. Run startup pre-checks (STT + OpenClaw health)
5. Open the readiness gate and start accepting requests

If pre-checks fail, the server exits with code 1.

## Health Checks

### Liveness (`/healthz`)

Always responds, even during startup. Use for container/process liveness probes.

```bash
curl http://localhost:4400/healthz
# {"status":"ok","timestamp":"2026-02-28T..."}
```

### Readiness (`/readyz`)

Checks STT provider and OpenClaw connectivity. Use for load balancer readiness.

```bash
curl http://localhost:4400/readyz
# {"status":"ready","checks":{"stt":{"healthy":true,...},"openclaw":{"healthy":true,...}},...}
```

Returns `503` if any dependency is unhealthy.

## Making a Voice Turn

```bash
curl -X POST http://localhost:4400/api/voice/turn \
  -H "Content-Type: audio/wav" \
  --data-binary @sample.wav
```

Response:
```json
{
  "turnId": "turn_abc123",
  "sessionKey": "my-session",
  "assistant": {
    "fullText": "The AI response text...",
    "segments": [{"index": 0, "text": "The AI response text...", "continuation": false}],
    "truncated": false
  },
  "timing": {"sttMs": 1200, "agentMs": 800, "totalMs": 2100},
  "meta": {"provider": "whisperx", "model": null}
}
```

## Runtime Configuration

Update settings without restart:

```bash
# Switch STT provider
curl -X POST http://localhost:4400/api/settings \
  -H "Content-Type: application/json" \
  -d '{"sttProvider": "openai"}'

# View current settings (secrets masked)
curl http://localhost:4400/api/settings
```

**Note:** Changing provider-specific config (URLs, API keys) currently requires a restart. Provider *selection* (which provider is active) works immediately.

## Troubleshooting

### Server won't start

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Startup timed out after 30s" | STT or OpenClaw unreachable | Check provider URLs and network |
| "Startup pre-check failed" | Health check returned unhealthy | Check `stt` and `openclaw` fields in error log |
| "Invalid integer for PORT" | Non-numeric PORT env var | Set PORT to a valid number |
| "Invalid ProviderId" | Unknown STT_PROVIDER value | Use `whisperx`, `openai`, or `custom` |

### Request errors

| HTTP Code | Error Code | Meaning |
|-----------|------------|---------|
| 400 | `INVALID_CONTENT_TYPE` | Audio content-type not recognized |
| 400 | `AUDIO_TOO_LARGE` | Body exceeds MAX_AUDIO_BYTES |
| 400 | `INVALID_CONFIG` | Settings patch validation failed |
| 403 | `CORS_REJECTED` | Origin not in CORS allowlist |
| 429 | `RATE_LIMITED` | Too many requests from this IP |
| 502 | `STT_UNAVAILABLE` | STT provider unreachable |
| 502 | `OPENCLAW_UNAVAILABLE` | OpenClaw not responding |
| 503 | `NOT_READY` | Gateway still starting up |

### Graceful Shutdown

The server handles `SIGTERM` and `SIGINT`:
1. Closes readiness gate (new requests get 503)
2. Disconnects OpenClaw WebSocket
3. Closes HTTP server (waits for in-flight requests)
4. Force exits after 10 seconds if connections hang
