# Security

## Threat Model

The gateway handles audio data, authentication tokens, and API keys. It runs alongside an OpenClaw instance, typically on a local network or trusted server. The primary threats are:

1. **Secret leakage** — Auth tokens or API keys appearing in logs or API responses
2. **Unauthorized access** — Requests from disallowed origins or abusive clients
3. **Input injection** — Malformed or oversized payloads causing crashes or resource exhaustion
4. **Configuration tampering** — Invalid runtime config causing undefined behavior

## Secret Protection (SAFE-05, CONF-05)

### API Responses

`GET /api/settings` returns a `SafeGatewayConfig` object where all secrets are replaced with `"********"`:

- `openclawGatewayToken` → `"********"`
- `openai.apiKey` → `"********"`
- `customHttp.authHeader` → `"********"`

The `ConfigStore.getSafe()` method enforces this at the source — there is no path to accidentally return raw secrets.

### Structured Logging

The `@voice-gateway/logging` package masks fields matching secret patterns before writing to stdout/stderr. Fields named `token`, `apiKey`, `authHeader`, `authorization`, and `password` are automatically replaced with `"[REDACTED]"`.

### Environment Variables

Secrets are loaded from environment variables only. The `.env.example` file contains placeholder values. Never commit a `.env` file.

## Input Validation (SAFE-03)

All external boundaries perform runtime validation:

### HTTP Layer

| Check | Enforcement |
|-------|-------------|
| Content-Type | Must be a recognized audio MIME type (`audio/wav`, `audio/webm`, etc.) |
| Body size | Hard limit via `MAX_AUDIO_BYTES` (default 25MB); streaming rejection |
| Settings payload | JSON parse + field-by-field validation with branded constructors |
| CORS origin | Strict allowlist check before any business logic |

### Provider Responses

STT provider adapters validate that responses contain required fields (`text`, `language`) before constructing `SttResult`.

### Configuration

The `validateSettingsPatch()` function validates every field individually:
- URLs validated for protocol and format
- Non-empty string checks for tokens and keys
- Positive integer checks for timeouts and intervals
- Branded type constructors (`createProviderId`, `createSessionKey`) enforce domain constraints

Unknown fields are silently ignored — they do not cause errors or get stored.

## CORS (SAFE-07)

The gateway implements strict CORS enforcement:

- **Strict mode** (non-empty `CORS_ORIGINS`): Only allowlisted origins receive CORS headers. Non-matching origins get `403 CORS_REJECTED`.
- **Development mode** (empty `CORS_ORIGINS`): All origins allowed (for local development only).
- **No-origin requests** (server-to-server): Allowed through without CORS headers.

Configure via `CORS_ORIGINS` environment variable (comma-separated list).

## Rate Limiting (SAFE-06)

In-memory per-IP rate limiting protects both voice turn and settings endpoints:

- Default: 60 requests per minute per IP
- Configurable via `RATE_LIMIT_PER_MINUTE`
- Returns `429` with `RATE_LIMITED` error code when exceeded
- Window resets after 60 seconds
- **Config-reactive:** Rate limit changes via `POST /api/settings` take effect immediately on the next request -- no restart needed. The `RateLimiter` reads the current `rateLimitPerMinute` from `ConfigStore` on every `check()` call.
- **Auto-prune:** Expired rate-limit windows are automatically pruned every 60 seconds to prevent memory growth from diverse-IP traffic. A hard cap of 10,000 entries triggers eager pruning between intervals.

## Error Taxonomy (SAFE-04)

Errors are split into two categories to prevent information leakage:

| Type | Purpose | Exposed To |
|------|---------|------------|
| `UserError` | Safe, human-readable messages | Chat app (HTTP 400) |
| `OperatorError` | Detailed diagnostics with internal context | Logs only (HTTP 502) |

`OperatorError` includes a `detail` field with debugging info that is logged but never returned in HTTP responses. The HTTP response for operator errors returns a generic message.

## Branded Types (SAFE-02)

Critical identifiers use TypeScript branded types to prevent accidental misuse:

- `TurnId` — Correlation ID for tracing a voice turn end-to-end
- `SessionKey` — OpenClaw session identifier
- `ProviderId` — STT provider selection (`whisperx` | `openai` | `custom`)

These are structurally strings but nominally distinct — passing a `SessionKey` where a `TurnId` is expected is a compile-time error.

## Startup Safety (OPS-03)

The gateway performs pre-flight health checks before accepting traffic:

1. Active STT provider health check
2. OpenClaw WebSocket connectivity check
3. 30-second startup timeout (exits if checks don't pass)

The readiness gate (`deps.ready`) stays closed until the server port is bound and pre-checks pass. Only `/healthz` (liveness) is exempt from the gate.

## Recommendations for Production

1. **Always set `CORS_ORIGINS`** to your chat app's origin in production
2. **Rotate tokens regularly** — the settings API allows runtime token updates
3. **Monitor `/readyz`** for dependency health
4. **Use a reverse proxy** (nginx, Caddy) for TLS termination
5. **Set `RATE_LIMIT_PER_MINUTE`** appropriately for expected load
6. **Never expose `.env` files** — use environment variables or a secrets manager
