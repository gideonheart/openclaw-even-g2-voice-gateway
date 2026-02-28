# Feature Landscape

**Domain:** Voice gateway / STT orchestration service for smart glasses AI assistant
**Researched:** 2026-02-28
**Confidence:** MEDIUM-HIGH (PRD well-defined; ecosystem patterns verified via multiple sources)

## Table Stakes

Features users expect. Missing = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Audio ingestion endpoint (PCM/WAV over HTTP) | The entire product exists to receive audio and return AI responses. Without a reliable audio intake, nothing works. | Low | `POST /api/voice/turn` accepting multipart or raw binary. Validate content-type, enforce size limits (e.g., 10MB max). |
| STT provider abstraction interface | Industry-standard pattern (LiveKit, Pipecat, Cognigy all use plugin interfaces). Hardcoding a single provider is a rewrite-causing mistake. | Med | `SttProvider` interface with `transcribe(audio, ctx) => SttResult`. All providers normalize to shared result type. Factory pattern for instantiation. |
| WhisperX self-hosted provider (default) | Core differentiator for self-hosters. The PRD and project context explicitly require it. Users choosing this product specifically want local/private STT. | Med | Async submit-then-poll pattern per WhisperX-FastAPI API. Handle task lifecycle: submit audio, poll status, extract transcript, handle timeout/failure. |
| OpenAI STT cloud provider | Table stakes for users who do not self-host STT. Simple onboarding path. Every voice gateway comparison lists OpenAI Whisper API as a baseline provider. | Low | Synchronous HTTP call to OpenAI `/v1/audio/transcriptions`. Straightforward request/response. |
| Custom HTTP STT adapter | Extensibility escape hatch. Without it, adding Deepgram/AssemblyAI/enterprise STT requires code changes -- that violates the pluggable architecture promise. | Med | Configurable URL, auth header, request/response mapping. Must document the expected request/response contract clearly. |
| Provider switching via configuration | Multi-provider STT strategies article confirms: "Switch providers by changing config, not rewriting your voice pipeline." Runtime config change is expected. | Low | `STT_PROVIDER` env var or settings API. Factory reads config, instantiates correct adapter. No code deploy needed. |
| OpenClaw session messaging (WebSocket) | The gateway's other half. Audio goes in, AI response comes out. WebSocket connection to OpenClaw is the delivery mechanism for transcripts and the receive channel for responses. | Med | Connect to OpenClaw gateway WebSocket, send transcript on configured session, receive assistant response. Handle connection lifecycle. |
| Response shaping for glasses viewport | Smart glasses have a 576x288 display. Raw LLM output will overflow or be unreadable. Shaping is not optional -- it is the gateway's core value-add over a raw proxy. | Med | Pagination into viewport-sized windows, truncation with continuation markers, whitespace normalization for narrow display. Metadata: window index, total windows, continuation flags. |
| Settings API (CRUD for runtime config) | Chat app (separate repo) manages settings UI and pushes config to gateway. Without a settings API, the gateway cannot be configured at runtime. | Low | `POST /api/settings` to validate+store, `GET /api/settings` to return safe subset (secrets masked). Validate before persisting. |
| Secrets protection (no leakage) | Security table stakes. Every voice gateway and API gateway product enforces this. Leaking API keys in logs or responses is a ship-blocking bug. | Low | Mask secrets in logs, never echo credentials in API responses, validate `.env.example` has only placeholders, CORS allowlist. |
| Health + readiness endpoints | Standard for any service meant to run alongside other infrastructure. Required for operational confidence and integration with monitoring. | Low | `/healthz` for liveness, `/readyz` for dependency reachability (OpenClaw WebSocket connectable, selected STT provider responding). |
| Structured logging with correlation IDs | Every voice turn spans multiple async operations (receive audio, transcribe, send to OpenClaw, receive response, shape). Without correlation IDs, debugging production issues is impossible. | Low | Generate `TurnId` at request entry, propagate through all log lines for that turn. JSON structured logs. |
| Error taxonomy (user-safe + operator-detailed) | Users get "transcription failed, try again." Operators get "WhisperX returned HTTP 503, task ID abc123, retried 3x." Mixing these audiences breaks both UX and ops. | Low | Error types: `UserError` (safe message for chat app), `OperatorError` (detailed for logs). Map provider-specific errors to taxonomy. |
| Retry with backoff for network calls | STT providers and OpenClaw are remote services. Transient failures are guaranteed. Without retry logic, single-packet-loss kills a voice turn. | Low | Exponential backoff with jitter, configurable max retries (default 3), timeout per attempt. Apply to both STT and OpenClaw calls. |
| Request size + rate limits | Prevents abuse and protects self-hosted STT from overload. Standard API gateway feature. | Low | Max request body size (10MB for audio), rate limit per IP or API key. Reject oversized/excessive requests with clear error. |
| Input validation at external boundaries | TypeScript `strict` mode catches compile-time issues; runtime validation catches malformed HTTP payloads, unexpected provider responses, bad config. | Low | Validate audio payload headers, settings schema, provider responses. Fail fast with clear error on invalid input. |

## Differentiators

Features that set the product apart. Not universally expected, but create competitive advantage or delight.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| STT provider failover/fallback chain | If WhisperX is down (self-hosted server offline), automatically try OpenAI. Eliminates single point of failure. Multi-provider redundancy article confirms this is advanced but high-value. | Med | Config: `STT_FAILOVER_CHAIN=whisperx,openai`. Try primary, on failure try next. Circuit breaker pattern prevents hammering a dead provider. |
| Virtualized message window for long responses | PRD FR-4.6 describes this. Most gateways just truncate. A sliding window over full conversation history with scroll-to-materialize is a genuine UX differentiator for glasses. | High | Maintain canonical conversation history in memory, render only viewport-sized slice, support scroll up/down to re-materialize older content. Pagination metadata per window. |
| Turn state machine with explicit lifecycle | Explicit states (IDLE, RECORDING, TRANSCRIBING, SENT, THINKING, STREAMING, DONE, ERROR) enable the chat app to show precise state feedback. LiveKit/Pipecat both implement this. | Med | State machine emitted as part of turn response or via status field. Each state transition logged with correlation ID. Chat app maps states to UI icons/animations. |
| Voice turn timing metrics | Emit per-turn timing: audio duration, transcription latency, OpenClaw response latency, total turn duration. Essential for debugging "why is it slow" and optimizing provider selection. | Low | Timestamp each phase boundary. Include timing breakdown in turn response metadata and structured logs. |
| Language hint passthrough | WhisperX and OpenAI both accept language hints. Allowing the chat app to pass `languageHint` improves accuracy for non-English users. | Low | Optional `languageHint` field in voice turn request. Pass through to STT provider. Default to auto-detect if not provided. |
| Conversation history management | Gateway maintains conversation context (not just single turns) so scroll-back and context-aware interactions work. Essential for the virtualized window feature. | Med | In-memory conversation store keyed by session. Append each turn (user transcript + assistant response). Expose via API for chat app to render history on reconnect. |
| Configurable response policy | Different users may want different truncation/pagination behavior (max chars per window, split strategy). Making this configurable rather than hardcoded enables adaptation. | Low | `response-policy` package with configurable params: `maxCharsPerWindow`, `splitStrategy` (sentence-boundary, word-boundary), `maxWindows`. |
| Graceful WebSocket reconnection to OpenClaw | OpenClaw sessions are long-lived. Network blips, server restarts, and session timeouts will disconnect the WebSocket. Auto-reconnect with exponential backoff and session state recovery is expected by sophisticated users. | Med | Heartbeat/ping-pong, detect disconnect, exponential backoff reconnect, re-authenticate, resume session. Queue outbound messages during reconnect window. |
| Provider health pre-check on startup | `readyz` checks provider reachability, but a startup pre-check that validates credentials and connectivity before accepting traffic prevents confusing "transcription failed" errors on first use. | Low | On boot: test-connect to configured STT provider and OpenClaw. Log result. If critical dependency unreachable, log warning but still start (for config-via-API flow). |
| Branded/opaque IDs for type safety | `SessionKey`, `TurnId`, `ProviderId` as branded types prevent accidentally passing a session key where a turn ID is expected. Not visible to users but prevents an entire class of bugs. | Low | TypeScript branded types (`type TurnId = string & { __brand: 'TurnId' }`). Factory functions to create. Compile-time safety. |

## Anti-Features

Features to explicitly NOT build. Inclusion would hurt the product.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Text-to-Speech (TTS) | Even G2 glasses have no speakers. Building TTS adds complexity with zero user value. The PRD explicitly excludes this. | Display text responses on glasses viewport. If future glasses add speakers, TTS becomes a new provider adapter -- not a current concern. |
| Frontend / Web UI in this repo | The chat app lives in a separate repo (`even-g2-openclaw-chat-app`). Mixing UI into the gateway breaks the separation of concerns and couples release cycles. | Expose clean HTTP API. Let the chat app repo own all UI rendering, gestures, and display logic. |
| Real-time streaming STT (WebSocket audio streaming) | The Even G2 interaction model is tap-to-start/tap-to-stop, producing a complete audio blob. Streaming STT adds massive complexity (partial results, endpointing, interruption handling) for a use case that does not need it. | Accept complete audio payloads via HTTP POST. Process as a batch. If streaming is needed later, add it as a new endpoint -- do not complicate the primary path. |
| Docker packaging | PRD explicitly excludes this. Target users run alongside OpenClaw via npm. Docker adds a packaging/testing burden for a single-service Node.js app. | Provide clear `npm install` and `.env.example` setup. Document running alongside OpenClaw. |
| Multi-tenant / user management | This is a single-user or single-household gateway. Adding auth, user management, and tenant isolation adds complexity that self-hosters do not need. | Single-config model. One STT provider, one OpenClaw session. If multi-user is needed, run multiple gateway instances. |
| Audio storage / recording persistence | Storing raw audio creates privacy liability and storage burden. Self-hosters want privacy, not an audio archive. | Process audio in memory, discard after transcription. Log only metadata (duration, format, turn ID). |
| STT model training / fine-tuning | Far outside scope. The gateway orchestrates STT, it does not train models. | Use pre-trained models via provider APIs. WhisperX supports model selection (tiny/medium/large-v3) as a config option -- that is sufficient. |
| Voice Activity Detection (VAD) in the gateway | VAD belongs in the audio capture layer (chat app / glasses firmware). The gateway receives already-captured audio. Adding VAD duplicates work and adds latency. | Trust the chat app to send speech-containing audio. If silence detection is needed, it is a chat app feature. |
| Complex audio preprocessing (noise reduction, AEC) | Same reasoning as VAD. The glasses and chat app handle capture quality. The gateway should not reprocess audio. | Pass audio through to STT provider as-is. STT providers (WhisperX, OpenAI) have their own noise handling. |
| Monolithic single-file implementation | PRD explicitly forbids this. A single file gateway becomes unmaintainable as providers and features grow. | Monorepo with `services/` and `packages/`. Each STT adapter is its own package. Response policy is its own package. Clean dependency boundaries. |

## Feature Dependencies

```
Audio Ingestion Endpoint
  --> STT Provider Abstraction Interface
      --> WhisperX Provider
      --> OpenAI Provider
      --> Custom HTTP Provider
      --> Provider Switching via Config
      --> STT Provider Failover (requires 2+ providers)
  --> OpenClaw Session Messaging (WebSocket)
      --> WebSocket Reconnection Logic
      --> Turn State Machine
  --> Response Shaping for Glasses
      --> Virtualized Message Window (requires Conversation History)
      --> Configurable Response Policy

Settings API
  --> Provider Switching via Config
  --> Secrets Protection

Health + Readiness Endpoints
  --> Provider Health Pre-check

Structured Logging
  --> Correlation IDs (per turn)
  --> Voice Turn Timing Metrics

Input Validation
  --> Error Taxonomy
  --> Request Size + Rate Limits
```

## MVP Recommendation

Prioritize (Phase 1 -- Foundation):
1. **Audio ingestion endpoint** -- without it, nothing works
2. **STT provider abstraction + WhisperX provider** -- the core pipeline
3. **OpenClaw session messaging** -- completes the audio-to-response loop
4. **Response shaping** -- makes responses readable on glasses (basic pagination, no virtualized window yet)
5. **Settings API** -- enables runtime configuration from chat app
6. **Health/readiness endpoints** -- operational baseline
7. **Structured logging with correlation IDs** -- debuggability from day one
8. **Error taxonomy + input validation + secrets protection** -- non-negotiable safety

Prioritize (Phase 2 -- Provider Extensibility):
1. **OpenAI STT provider** -- second provider proves the abstraction works
2. **Custom HTTP STT adapter** -- opens the door to any provider
3. **Provider failover chain** -- resilience with 2+ providers available
4. **Turn state machine** -- enables rich chat app UX

Defer:
- **Virtualized message window**: High complexity. Basic pagination is sufficient for launch. Add when real users hit long-response pain points.
- **Conversation history management**: Needed for virtualized window. Defer together.
- **WebSocket reconnection with state recovery**: Important for production robustness but not for initial integration testing. Add in hardening phase.
- **Voice turn timing metrics**: Low complexity but not blocking. Add during observability hardening.
- **A/B testing between providers**: Only relevant at scale. Not needed for community self-hosters.

## Sources

- [Multi-Provider STT/TTS Strategies (Sayna AI)](https://sayna.ai/blog/multi-provider-stt-tts-strategies-when-and-why-to-abstract-your-speech-stack) -- MEDIUM confidence, single source but patterns consistent with LiveKit/Pipecat architectures
- [6 Best Orchestration Tools for AI Voice Agents 2026 (AssemblyAI)](https://www.assemblyai.com/blog/orchestration-tools-ai-voice-agents) -- MEDIUM confidence, vendor blog but comprehensive comparison
- [The Voice AI Stack for Building Agents 2026 (AssemblyAI)](https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents) -- MEDIUM confidence, vendor blog
- [Real-Time vs Turn-Based Voice Agent Architecture (Softcery)](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture) -- MEDIUM confidence, confirms turn-based is appropriate for tap-to-talk
- [LiveKit Agents Plugin Architecture (DeepWiki)](https://deepwiki.com/livekit/agents/5.1-cli-and-development-tools) -- MEDIUM confidence, documents LiveKit's STT/TTS base class pattern
- [WebSocket Reconnection Logic (OneUptime)](https://oneuptime.com/blog/post/2026-01-27-websocket-reconnection-logic/view) -- MEDIUM confidence, standard patterns
- [VAD Complete Guide (Picovoice)](https://picovoice.ai/blog/complete-guide-voice-activity-detection-vad/) -- MEDIUM confidence, confirms VAD belongs in capture layer
- [Building Resilient Stateful Failover (DEV Community)](https://dev.to/dantesbytes/building-resilient-systems-implementing-stateful-failover-between-multiple-external-providers-4i3g) -- LOW confidence, community article but patterns are sound
- PRD.md (local) -- HIGH confidence, authoritative project spec
- PROJECT.md (local) -- HIGH confidence, authoritative project context
- WhisperX SKILL.md (local) -- HIGH confidence, documents actual WhisperX API contract
