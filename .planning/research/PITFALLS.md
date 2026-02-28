# Pitfalls Research

**Domain:** Voice gateway / STT orchestration for wearable glasses
**Researched:** 2026-02-28
**Confidence:** HIGH (domain-specific patterns verified across multiple sources)

## Critical Pitfalls

### Pitfall 1: WhisperX Polling Without Timeout or Cancellation Leads to Hung Turns

**What goes wrong:**
The WhisperX-FastAPI service uses an async task pattern: POST audio to `/speech-to-text`, then poll `GET /task/{identifier}` until complete. Without a strict per-turn timeout, AbortController-based cancellation, and dead-task detection, the gateway hangs indefinitely on a turn. The user sees "THINKING" forever on their glasses. Worse, if the user taps to start a new turn while the old one is stuck, multiple polling loops run concurrently and responses arrive out of order.

**Why it happens:**
Developers implement the happy path (submit, poll, done) and forget that WhisperX can stall -- GPU OOM on large audio, model cold-start after idle, Gunicorn worker timeout killing the task mid-process, or simply Rolands' PC being off. The WhisperX SKILL.md documents a 300-second POLL_TIMEOUT, but gateway code often omits equivalent protection.

**How to avoid:**
- Wrap every polling loop in `Promise.race([pollUntilDone(), timeout(configurable)])` with AbortController to cancel the HTTP requests on timeout.
- Track a per-turn state machine: `SUBMITTED -> POLLING -> COMPLETED | FAILED | TIMED_OUT`. Never allow a turn to stay in POLLING longer than the configured ceiling (default: 60s for voice turns, not the 300s used for batch transcription).
- When a new turn starts, cancel any in-flight polling for the previous turn using AbortController.
- Use the WhisperX health endpoints (`/health/ready`) in the readiness check to detect the service being down *before* accepting a turn.

**Warning signs:**
- Integration tests pass but only test the happy path with fast audio
- No AbortController or timeout wrapper around the polling fetch calls
- No per-turn state machine (just raw polling in a loop)
- Test fixtures use tiny audio files that always transcribe in < 2 seconds

**Phase to address:**
Foundation (M1) -- the WhisperX adapter must ship with timeout/cancellation from day one. This is not hardening; it is core correctness.

---

### Pitfall 2: Audio Format Mismatch Silently Degrades Transcription Quality

**What goes wrong:**
The chat app captures audio from the phone's microphone (the G2 glasses have no mic -- audio capture is via the phone running Even Hub). Depending on the browser/platform, the raw audio may be in various formats: WebM/Opus from Chrome, CAF/AAC from Safari, or raw PCM at non-standard sample rates (44.1kHz, 48kHz). If the gateway forwards this directly to WhisperX or OpenAI without normalization, transcription silently degrades -- Whisper models expect 16kHz mono 16-bit PCM. You get garbled text or empty transcripts, not an error.

**Why it happens:**
The failure is silent. Whisper will *attempt* to transcribe any audio format it can decode (WAV, OGG, MP3, etc.), but quality drops dramatically with wrong sample rates or stereo input. OpenAI's API accepts multiple formats but has a 25MB limit. Developers test with a single known-good WAV file and never encounter the mismatch.

**How to avoid:**
- Define a canonical internal audio format: 16kHz mono 16-bit PCM WAV.
- Normalize all incoming audio at the gateway boundary before passing to any provider. Use ffmpeg (via `fluent-ffmpeg` or a subprocess call) to transcode: `.audioFrequency(16000).audioChannels(1).audioCodec('pcm_s16le').format('wav')`.
- Validate the incoming audio payload (check Content-Type, minimum byte size, attempt format detection) and return a clear error if the audio is undecodable.
- Include audio format metadata in the `SttContext` so providers can log what they received.
- Test with real browser captures from both Chrome and Safari on iOS/Android.

**Warning signs:**
- WhisperX returns empty or nonsensical transcripts intermittently
- Tests only use pre-made WAV files, never real browser-captured audio
- No `ffmpeg` or audio processing dependency in the project
- The `POST /api/voice/turn` endpoint accepts any Content-Type without validation

**Phase to address:**
Foundation (M1) -- audio normalization must be in the request pipeline before the STT provider is ever called. It is part of the contract, not a nice-to-have.

---

### Pitfall 3: WebSocket to OpenClaw Treated as Stateless When It Is Stateful

**What goes wrong:**
The gateway opens a WebSocket to the OpenClaw gateway to send transcripts and receive agent responses. Developers treat this like a fire-and-forget HTTP call: send message, get response. But WebSocket connections are stateful -- they can silently die (half-open), the OpenClaw session may expire or be reclaimed, and messages sent during reconnection are lost. When the connection drops mid-turn, the user's transcript vanishes into the void and no response arrives.

**Why it happens:**
WebSocket APIs look simple (`ws.send(data)`), so developers skip connection lifecycle management. TCP keepalive does not detect all failure modes (e.g., load balancer idle timeout, server-side session eviction). Without application-level heartbeats and reconnection logic, the gateway does not know it is talking to a dead socket.

**How to avoid:**
- Implement application-level ping/pong heartbeats (every 15-30s) in addition to TCP keepalive. If no pong within 5s, consider the connection dead.
- Use exponential backoff with jitter on reconnection (start 1s, max 30s, jitter +/-25%).
- Queue outgoing messages during reconnection. On successful reconnect, replay the queue.
- After reconnection, re-establish the OpenClaw session context (session key, auth). Do not assume the session survives the socket disconnect.
- Expose connection state in the health/readiness endpoint: `readyz` should report unhealthy if the WebSocket is not in OPEN state.
- Track a `lastMessageReceived` timestamp; alert if the gap exceeds the expected heartbeat interval.

**Warning signs:**
- Using `ws` or `WebSocket` directly without a reconnection wrapper
- No heartbeat/ping implementation
- `/readyz` does not check WebSocket connection state
- Integration tests mock the WebSocket entirely (never test reconnection)
- No message queue for the reconnection window

**Phase to address:**
Foundation (M1) -- the `openclaw-client` package must encapsulate connection lifecycle from the start. Bolting on reconnection later requires rearchitecting the message flow.

---

### Pitfall 4: Correlation ID Not Threaded Through the Entire Turn Pipeline

**What goes wrong:**
A voice turn spans multiple async hops: HTTP request from chat app -> audio normalization -> STT provider call (possibly with polling) -> WebSocket message to OpenClaw -> response back -> response shaping -> HTTP response to chat app. Without a single correlation ID (TurnId) propagated through every log statement and every outgoing request, debugging a failed turn requires manually correlating timestamps across disjointed log entries. In production, this is nearly impossible.

**Why it happens:**
Each component is developed independently. The HTTP handler generates a request ID, the STT adapter logs with its own context, the OpenClaw client logs WebSocket frames separately. Nobody passes the TurnId through. The problem is invisible until a real user reports "my turn disappeared" and the operator has to trace it.

**How to avoid:**
- Generate a branded `TurnId` (UUID v7 for time-sortability) at the HTTP request boundary (`POST /api/voice/turn`).
- Use Node.js `AsyncLocalStorage` to propagate the TurnId through the entire async call chain without explicit parameter threading.
- Every log statement from the structured logger must include the TurnId automatically (the logging package reads from AsyncLocalStorage).
- Include the TurnId in outgoing headers to WhisperX (`X-Correlation-Id`) and in the OpenClaw WebSocket message metadata.
- Return the TurnId to the chat app in the response, so the frontend can reference it in bug reports.

**Warning signs:**
- Log entries lack a consistent ID field across different components
- Debugging requires grepping by timestamp rather than by turn ID
- The `logging` package does not integrate with `AsyncLocalStorage`
- STT adapter and OpenClaw client accept no context/correlation parameter

**Phase to address:**
Foundation (M1) -- the logging package and `TurnId` generation must be established before any other component ships. Retrofitting AsyncLocalStorage-based correlation into existing code is painful.

---

### Pitfall 5: Provider Abstraction Leaks Implementation Details Into the Gateway

**What goes wrong:**
The `SttProvider` interface looks clean in theory (`transcribe(input, ctx): Promise<SttResult>`), but implementations leak: WhisperX needs polling so its adapter returns "in progress" states; OpenAI is synchronous but has rate limits; the Custom HTTP adapter needs configurable request/response mapping. If the abstraction forces all providers into a single synchronous-looking interface without accommodating these differences, you end up with: (a) polling logic leaking into the gateway orchestrator, (b) error types that only make sense for one provider, or (c) a lowest-common-denominator interface that cannot express provider-specific capabilities.

**Why it happens:**
The classic "false abstraction" anti-pattern. A developer designs the interface based on the simplest provider (OpenAI: send audio, get text) and then discovers WhisperX does not fit. The fix is usually to add provider-specific flags or callbacks that defeat the purpose of the abstraction.

**How to avoid:**
- The `SttProvider.transcribe()` must always return `Promise<SttResult>` -- the *adapter* owns all polling, retries, and async orchestration internally. The gateway never polls; it awaits a promise.
- Define a clear `SttError` union type with discriminated variants: `TIMEOUT`, `PROVIDER_UNAVAILABLE`, `AUDIO_INVALID`, `RATE_LIMITED`, `UNKNOWN`. All providers map their native errors to this union. The gateway only handles `SttError`, never provider-native error shapes.
- Provider-specific configuration (WhisperX poll interval, OpenAI model name, Custom HTTP response mapping) stays in the adapter's config, not in the shared interface.
- Write contract tests that verify all three providers conform to the `SttProvider` interface: same input produces structurally valid `SttResult`, same error conditions produce correct `SttError` variants.

**Warning signs:**
- Gateway code contains `if (provider === 'whisperx')` branches
- The `SttResult` type has optional fields that only one provider populates
- Error handling differs per provider in the orchestration layer
- Contract tests exist for one provider but not others

**Phase to address:**
Foundation (M1) for the interface design and WhisperX adapter; Provider Extensibility (M2) must enforce the contract across all three providers with shared contract tests.

---

### Pitfall 6: Secret Leakage Through Logs, Error Responses, and Settings API

**What goes wrong:**
The gateway handles multiple secrets: `OPENCLAW_GATEWAY_TOKEN`, `OPENAI_API_KEY`, `CUSTOM_STT_AUTH`, `WHISPERX_BASE_URL` (which may contain auth in the URL). These leak through: (a) structured logs that serialize the full request context, (b) error responses that include raw error messages from upstream (which may contain auth headers), (c) the `GET /api/settings` endpoint returning unmasked secrets, (d) stack traces in development mode.

**Why it happens:**
Structured logging encourages logging "everything" for debuggability. When a developer adds `logger.error({ err, request })` and the request object contains auth headers, the secret is now in the log file. The Settings API is designed to be useful for the frontend, so it returns the stored config -- including secrets if not explicitly filtered.

**How to avoid:**
- Define a `SENSITIVE_KEYS` allowlist in the logging package: `['authorization', 'token', 'api_key', 'apiKey', 'password', 'secret', 'auth']`. The structured logger's serializer must redact any value whose key matches (case-insensitive). This is not optional middleware; it is built into the logger.
- The `GET /api/settings` endpoint returns a "safe view" where secrets are masked (e.g., `"sk-...7f3a"`) using a `maskSecret()` utility. The full value is never returned over HTTP.
- Upstream error messages must be sanitized before inclusion in HTTP responses. Wrap provider errors in the gateway's own error type; never forward raw error bodies.
- Use `gitleaks` or equivalent in CI to prevent secrets from being committed. Provide `.env.example` with placeholder values only.
- Test for leakage: write a test that sets a known secret value, triggers various error paths, and asserts the secret string does not appear in any log output or HTTP response body.

**Warning signs:**
- No log redaction middleware or serializer configuration
- `GET /api/settings` returns the same shape as the internal settings store
- Error responses include `message` fields from axios/fetch errors (which contain URLs with tokens)
- No CI secret scanning step

**Phase to address:**
Foundation (M1) -- the logging package must redact from day one. Settings API masking is part of the settings endpoint implementation. CI secret scanning is part of the CI setup.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline polling logic in gateway instead of in WhisperX adapter | Ship faster, fewer files | Polling logic cannot be reused or tested in isolation; gateway becomes coupled to WhisperX internals | Never -- the adapter boundary is the whole point of the provider pattern |
| Skip audio normalization, pass raw browser audio to provider | Fewer dependencies (no ffmpeg) | Silent transcription quality degradation on non-WAV input; works in dev (WAV), fails in prod (WebM/Opus) | Never -- normalization is a correctness requirement |
| Single shared tsconfig instead of per-package configs | Simpler setup | Package boundaries become meaningless; changing one package's compiler settings affects all; circular dependency detection fails | Only in first week of scaffolding, then split immediately |
| `any` casts at provider boundaries | Unblock integration quickly | Runtime type errors surface in production instead of at compile time; defeats the branded ID system | Never in core paths; acceptable in test fixtures only |
| Hardcoded polling intervals / timeouts | Quick implementation | Cannot tune for different environments (fast GPU vs slow GPU, local vs remote WhisperX) | Only if configuration system is not yet built; must be replaced in same milestone |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| WhisperX-FastAPI | Sending audio without `Content-Type: multipart/form-data` or wrong field name | Check the exact endpoint contract: `POST /speech-to-text` expects multipart with file field; poll `GET /task/{id}` for result. Test with curl first. |
| WhisperX-FastAPI | Not handling the `PENDING` / `PROCESSING` / `COMPLETED` / `FAILED` task states correctly | Treat any state other than `COMPLETED` or `FAILED` as "keep polling". Map `FAILED` to `SttError.PROVIDER_UNAVAILABLE`. |
| WhisperX-FastAPI | Assuming the service is always warm | WhisperX on Rolands' RTX 4090 may have cold-start latency of 5-15s on first request after idle. The `/health/ready` endpoint distinguishes liveness from model-loaded readiness. |
| OpenAI STT API | Not setting `response_format` or `language` hint | Default response format may not include confidence scores. Always set `response_format: 'verbose_json'` for structured output. Set `language` hint when known to improve accuracy and speed. |
| OpenAI STT API | Exceeding 25MB file size limit | Pre-check audio file size. If the chat app sends long recordings, truncate or compress before sending to OpenAI. WhisperX has no such limit (supports TUS protocol for up to 5GB). |
| OpenClaw WebSocket | Sending messages before session handshake is complete | The OpenClaw protocol requires an initial handshake (session key + auth). Messages sent before the handshake completes are silently dropped. Wait for the handshake acknowledgement before sending transcripts. |
| OpenClaw WebSocket | Not handling session expiry / eviction | OpenClaw sessions can expire or be evicted. The gateway must detect "session not found" errors and re-establish the session, then retry the message. |
| Chat App HTTP | Returning raw error objects from upstream providers | Chat app expects a stable error contract (`{ error: { code, message, turnId } }`). Raw upstream errors expose internal details and change shape per provider. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous audio transcoding blocking the event loop | Other HTTP requests stall during ffmpeg conversion; health checks time out | Run ffmpeg as a child process (not in-process) or use worker threads. fluent-ffmpeg already does this via subprocess, but verify the pipeline is fully async. | When audio files exceed 10s duration or multiple turns are processed concurrently |
| Unbounded request body size on audio upload endpoint | Memory exhaustion, crash on large uploads | Set `express.raw({ limit: '10mb' })` or equivalent body size cap. Return 413 immediately for oversized payloads. Align with OpenAI's 25MB limit as the practical ceiling. | When a user accidentally sends a long recording or the chat app has a bug |
| Holding full conversation history in gateway memory | Memory grows linearly per active user session | The gateway shapes the current response only. Conversation history is OpenClaw's responsibility. The gateway maintains a sliding window of recent turns for display pagination, not the full history. | When sessions last hours or users send hundreds of turns |
| Creating a new WebSocket connection per voice turn | Connection overhead (TLS handshake, session setup) adds 200-500ms per turn | Maintain a persistent WebSocket connection per OpenClaw session. Reuse across turns. Only reconnect on failure. | Immediately -- every single turn is slower |
| Polling WhisperX too frequently | Floods WhisperX with status check requests, especially under load | Use configurable poll interval (default 2s), with backoff if multiple consecutive polls return PROCESSING. Never poll more than 1/sec. | When multiple users submit turns simultaneously |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing secrets in settings JSON file without encryption | Local attacker reads API keys from disk | At minimum, use file permissions (600). For production, use OS keychain or encrypted-at-rest file. For self-hosters, document the risk clearly. |
| CORS wildcard (`*`) on the voice/settings endpoints | Any website can submit audio and read settings from the gateway | Strict CORS allowlist: only the chat app origin. No wildcard. Validate Origin header. |
| No rate limiting on `POST /api/voice/turn` | Attacker floods the gateway, burns STT provider quota (especially OpenAI API credits) | Rate limit per client IP: e.g., 10 turns/minute. Return 429 with Retry-After header. |
| Including auth tokens in WhisperX URL (`https://user:pass@host/`) | URL logged by default in most logging frameworks, tokens visible in process list via /proc | Use separate header-based auth or env var. Never put credentials in URLs. Validate at startup that WHISPERX_BASE_URL does not contain userinfo. |
| No input validation on settings API | Attacker sets `OPENCLAW_GATEWAY_URL` to a malicious server, intercepting all transcripts | Validate URL format and scheme (https only in production). Consider a URL allowlist for OpenClaw gateway. Validate all settings fields with a strict schema. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No feedback between "audio sent" and "transcript received" | User stares at blank glasses for 3-15 seconds, wonders if it worked | Show SENT state immediately on audio upload, then THINKING with a throbber animation while STT is processing. Return state transitions to the chat app so it can update the UI. |
| Truncating long responses at a character limit without word boundaries | Words cut mid-syllable on the 576x288 display, unreadable | The response-policy package must split at word boundaries, respect paragraph breaks, and include continuation markers ("...1/3") so the user knows to scroll. |
| Returning the full AI response in one shot | Chat app must parse and paginate locally, duplicating logic | Gateway owns response shaping. Return pre-paginated windows with metadata (`{ windows: [...], currentWindow: 0, totalWindows: 3 }`). Chat app just renders. |
| No error message on STT failure | User gets no response, retries, gets no response again | Return a user-friendly error message shaped for the glasses display: "Could not transcribe. Please try again." with the error type. Do not show stack traces. |
| Ignoring language detection | User speaks Latvian, gets garbled English transcript | Pass language hint from chat app settings to STT provider. Support `auto` detection as fallback. Include detected language in the response so the chat app can display it. |

## "Looks Done But Isn't" Checklist

- [ ] **WhisperX adapter:** Often missing timeout/cancellation -- verify that a 90-second stall in WhisperX causes the turn to fail cleanly (not hang forever)
- [ ] **Audio normalization:** Often missing real browser audio test -- verify with actual WebM/Opus captured from Chrome on Android, not just pre-made WAV files
- [ ] **Settings API:** Often missing secret masking -- verify that `GET /api/settings` never returns unmasked `OPENAI_API_KEY` or `OPENCLAW_GATEWAY_TOKEN`
- [ ] **WebSocket reconnection:** Often missing queue replay -- verify that a turn submitted during a 3-second reconnection window is retried after reconnection, not silently dropped
- [ ] **Error responses:** Often missing provider error sanitization -- verify that an OpenAI 401 error does not leak the API key in the response body
- [ ] **Response pagination:** Often missing continuation markers -- verify that a 3-window response includes "1/3", "2/3", "3/3" markers and respects word boundaries
- [ ] **Health endpoints:** Often missing dependency checks -- verify that `/readyz` fails when WhisperX is unreachable AND when WebSocket is disconnected, not just when the gateway process is alive
- [ ] **Correlation IDs:** Often missing in async hops -- verify that a single TurnId appears in logs from the HTTP handler, STT adapter, OpenClaw client, and response shaper
- [ ] **Rate limiting:** Often missing on the voice endpoint -- verify that 20 rapid requests return 429 after the limit, not 200 with a queue that exhausts memory
- [ ] **Monorepo builds:** Often missing incremental build setup -- verify that changing `stt-whisperx` does not trigger a full rebuild of all packages

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Polling loop hangs (no timeout) | LOW | Add AbortController + timeout wrapper. No architectural change needed if adapter boundary is clean. |
| Audio format mismatch in production | MEDIUM | Add ffmpeg normalization layer at the gateway boundary. Requires adding a dependency and a preprocessing step to the request pipeline. May need to update the API contract if the chat app was sending raw audio. |
| WebSocket reconnection not implemented | HIGH | Requires building a connection manager with state machine, heartbeats, message queue, and backoff. Touches every component that sends/receives WebSocket messages. Do it right the first time. |
| Secrets leaked in logs | MEDIUM | Add log redaction serializer. Requires auditing all existing log statements and testing that redaction works. Lower cost if the logging package was designed for it from the start. |
| Provider abstraction leaks | HIGH | Redesigning the provider interface after multiple providers are implemented requires changing all adapters and the gateway orchestrator. The contract tests must be rewritten. Avoid by getting the interface right with the first two providers. |
| Correlation IDs missing | MEDIUM | Retrofit AsyncLocalStorage integration into the logging package and add TurnId propagation. Each component needs minor changes (accept context, log with it). Lower cost if done before many log statements exist. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| WhisperX polling hangs | M1 (Foundation) | Integration test: mock WhisperX to never complete, verify turn fails within timeout |
| Audio format mismatch | M1 (Foundation) | Test with real Chrome WebM/Opus and Safari CAF/AAC captures; verify 16kHz mono WAV reaches provider |
| WebSocket stateful lifecycle | M1 (Foundation) | Integration test: kill WebSocket mid-turn, verify reconnection and message replay within 10s |
| Correlation ID threading | M1 (Foundation) | Log audit: submit a turn, verify TurnId appears in every log line from every component |
| Provider abstraction leakage | M1 (interface design) + M2 (enforcement) | Contract test suite: all 3 providers pass identical test matrix with same input/output shapes |
| Secret leakage | M1 (Foundation) | Automated test: set known secret, trigger error paths, grep all log output and HTTP responses for the secret string |
| Response pagination word boundaries | M1 (Foundation) | Unit test: feed 5000-character response, verify no window splits mid-word |
| CORS misconfiguration | M1 (Foundation) | Integration test: send request with disallowed Origin header, verify 403 |
| Rate limiting | M3 (Hardening) | Load test: send 50 requests in 10 seconds, verify 429s after threshold |
| Monorepo build coupling | M1 (Foundation) | Change one package, run build, verify only that package and its dependents rebuild |

## Sources

- [WhisperX SKILL.md](/home/forge/.openclaw/workspace/skills/whisperx/SKILL.md) -- WhisperX polling contract, timeout defaults, health endpoints (HIGH confidence, primary source)
- [OpenAI Speech-to-Text Guide](https://developers.openai.com/api/docs/guides/speech-to-text/) -- Audio format limits, response formats, 25MB limit (HIGH confidence, official docs)
- [Whisper Audio Format Discussion](https://github.com/openai/whisper/discussions/41) -- Format optimization for Whisper models (MEDIUM confidence)
- [Optimal Audio Input Settings for Whisper](https://gist.github.com/danielrosehill/06fb17e7462980f99efa9fdab2335a14) -- 16kHz mono PCM recommendation (MEDIUM confidence)
- [WebSocket Reconnection Strategies](https://dev.to/hexshift/robust-websocket-reconnection-strategies-in-javascript-with-exponential-backoff-40n1) -- Backoff, heartbeat, message queue patterns (MEDIUM confidence)
- [WebSocket Reconnection Logic](https://oneuptime.com/blog/post/2026-01-24-websocket-reconnection-logic/view) -- Production reconnection patterns (MEDIUM confidence)
- [Correlation IDs Engineering Playbook](https://microsoft.github.io/code-with-engineering-playbook/observability/correlation-id/) -- ID generation and propagation patterns (HIGH confidence, Microsoft)
- [Mastering Correlation IDs](https://medium.com/@nynptel/mastering-correlation-ids-enhancing-tracing-and-debugging-in-distributed-systems-602a84e1ded6) -- Async context loss pitfall (MEDIUM confidence)
- [Common Secret Leaking Patterns 2026](https://www.d4b.dev/blog/2026-02-04-common-secret-leaking-patterns-2026) -- Log leakage, structured logging risks (MEDIUM confidence)
- [Node.js Logging Best Practices](https://betterstack.com/community/guides/logging/nodejs-logging-best-practices/) -- Structured logging patterns (MEDIUM confidence)
- [Even G2 BLE Protocol](https://github.com/i-soxi/even-g2-protocol) -- Display constraints, no audio in BLE protocol (MEDIUM confidence, community reverse-engineering)
- [Even G2 Architecture Rebuild](https://www.evenrealities.com/blog/how-we-rebuilt-g2-from-the-inside-out) -- BLE bandwidth, latency improvements (MEDIUM confidence, official blog)
- [Northflank STT Benchmarks 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks) -- Model latency and cold-start context (MEDIUM confidence)
- [FastAPI Long-Running Tasks](https://medium.com/@bhagyarana80/serving-long-running-jobs-with-fastapi-using-webhooks-and-task-polling-860bb0d3e0f9) -- Polling pattern and timeout management (MEDIUM confidence)
- [Node.js Race Conditions](https://nodejsdesignpatterns.com/blog/node-js-race-conditions/) -- Async race condition patterns (MEDIUM confidence)
- [TypeScript Monorepo Mistakes](https://dev.to/alex_aslam/monorepo-dependency-chaos-proven-hacks-to-keep-your-codebase-sane-and-your-team-happy-1957) -- Cross-package dependency pitfalls (MEDIUM confidence)
- [Reading on Smart Glasses](https://nhenze.net/uploads/Reading-on-Smart-Glasses-The-Effect-of-Text-Position-Presentation-Type-and-Walking.pdf) -- Text readability constraints on small displays (HIGH confidence, academic research)

---
*Pitfalls research for: Voice gateway / STT orchestration for Even G2 glasses*
*Researched: 2026-02-28*
