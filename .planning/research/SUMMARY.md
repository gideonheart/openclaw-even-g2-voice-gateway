# Project Research Summary

**Project:** openclaw-even-g2-voice-gateway
**Domain:** Voice gateway / STT orchestration service for Even G2 smart glasses
**Researched:** 2026-02-28
**Confidence:** HIGH

## Executive Summary

This project is a turn-based voice pipeline gateway that sits between an Even G2 glasses chat application and the OpenClaw AI agent backend. The core job is simple to describe and demanding to build correctly: receive a complete audio segment from the phone's microphone (tap-to-record UX), normalize it to 16kHz mono PCM, dispatch it to a pluggable STT provider (WhisperX self-hosted by default, OpenAI as cloud fallback), forward the transcript over a persistent WebSocket to OpenClaw, receive the AI response, shape it for the 576x288 glasses viewport, and return structured pagination to the chat app. Research confirms this turn-based pipeline pattern is the right architecture for tap-to-talk wearable UX — streaming STT adds complexity with no UX benefit since the full response must be paginated before display anyway.

The recommended approach is a pnpm monorepo with Fastify 5 as the HTTP framework and a clean separation between the runnable service (`services/gateway-api`) and isolated packages for each concern: the STT contract interface, three provider adapters (WhisperX, OpenAI, Custom HTTP), the OpenClaw WebSocket client, the response-policy shaper, shared logging, validation, and domain types. This layered structure is not premature abstraction — it is the minimum structure that lets each adapter be tested in isolation, prevents vendor lock-in, and satisfies the PRD's explicit prohibition on a monolithic single-file implementation. The build order follows strict dependency layering: shared-types first, then cross-cutting packages (logging, validation, stt-contract), then the adapters, then the gateway service that wires them together.

The top risks are all correctness failures that are invisible until production: WhisperX polling loops that hang indefinitely without timeout/cancellation, audio format mismatches that silently degrade transcription quality without errors, and a WebSocket to OpenClaw that appears connected while actually half-open. All six critical pitfalls identified in research are M1 issues — none can be deferred to a hardening phase. The provider abstraction must also be designed correctly up front with the first two providers, because retrofitting a flawed interface after three adapters are implemented is a high-cost rework. Ship with correlation IDs and structured logging from day one; debugging production voice turns without them is effectively impossible.

## Key Findings

### Recommended Stack

The stack is straightforward with well-justified choices. Fastify 5 is the clear HTTP framework pick over Express (better TypeScript support, schema validation, 2-3x faster, plugin architecture that maps to the gateway's modular design). Zod v4 serves dual purpose as both runtime validation and Fastify type provider, eliminating duplicated type definitions. The `ws` library handles the persistent OpenClaw WebSocket client. Native Node.js fetch (stable in Node 22) replaces axios/got for STT provider HTTP calls. pino is the structured logger via Fastify's built-in integration. Vitest 4 is mandated by the PRD for OpenClaw ecosystem alignment. All package versions have been verified against npm registry.

**Core technologies:**
- **Node.js 22 LTS + TypeScript 5.9:** Runtime and type system — stable LTS with native fetch, .env loading, and type-stripping support
- **Fastify 5 + fastify-type-provider-zod:** HTTP framework — first-class TypeScript, 2-3x faster than Express, built-in schema validation
- **Zod 4:** Runtime validation and type inference — 7-14x faster than v3, `.toJSONSchema()` for Fastify integration, single source of truth for schema shapes
- **pnpm 10 workspaces:** Monorepo package manager — strict node_modules (no phantom deps), content-addressable store, security-by-default in v10
- **ws 8:** WebSocket client for OpenClaw — 35M weekly downloads, battle-tested, zero dependencies
- **pino 10:** Structured JSON logging — Fastify's native logger, child loggers for per-turn correlation IDs
- **openai 6:** OpenAI STT adapter — official SDK handles auth, retries, multipart uploads
- **p-retry 7 + nanoid 5:** Retry/backoff and ID generation utilities
- **tsx 4 / tsup 8 / Vitest 4 / Biome 2:** Dev toolchain — fast TypeScript execution, esbuild bundling, testing, linting+formatting

See `.planning/research/STACK.md` for full version table and alternatives considered.

### Expected Features

The PRD is well-defined and maps cleanly to the feature landscape. The gateway's core value is the pipeline it orchestrates — any feature that breaks that pipeline or adds concerns that belong elsewhere (VAD, TTS, audio storage, UI) is explicitly an anti-feature.

**Must have (table stakes):**
- Audio ingestion endpoint (POST /api/voice/turn, PCM/WAV, multipart) — the entire product depends on this
- STT provider abstraction interface (SttProvider + SttResult contract) — pluggability from day one
- WhisperX self-hosted adapter (submit + poll pattern) — core differentiator for privacy-conscious self-hosters
- OpenClaw session messaging over persistent WebSocket — completes the audio-to-response loop
- Response shaping for 576x288 glasses viewport — pagination is not optional; raw LLM output overflows the display
- Settings API (POST/GET /api/settings with secret masking) — enables runtime configuration from the chat app
- Health + readiness endpoints (/healthz, /readyz with dependency checks) — operational baseline
- Structured logging with correlation IDs (TurnId per turn, AsyncLocalStorage propagation) — debuggability from day one
- Error taxonomy separating user-safe messages from operator-detailed errors — prevents architecture leakage to the chat app
- Retry with backoff for STT and OpenClaw network calls — transient failures are guaranteed
- Request size + rate limits (10MB body cap, IP-based rate limiting) — protects self-hosted STT quota
- Input validation at all external boundaries — fail fast with clear errors on malformed payloads
- Secrets protection — mask in logs, never echo in API responses, CORS allowlist

**Should have (competitive differentiators):**
- OpenAI STT cloud provider adapter — second provider proving the abstraction is genuinely pluggable
- Custom HTTP STT adapter — extensibility escape hatch for Deepgram/AssemblyAI/enterprise STT
- STT provider failover/fallback chain — eliminates single point of failure when WhisperX is offline
- Turn state machine with explicit lifecycle (IDLE, RECORDING, TRANSCRIBING, SENT, THINKING, DONE, ERROR) — enables precise UI feedback on glasses
- Voice turn timing metrics — per-phase timestamps for debugging latency
- Language hint passthrough to STT providers — improves accuracy for non-English users
- Graceful WebSocket reconnection with message queue replay — production robustness
- Provider health pre-check on startup — catches misconfiguration before first turn attempt

**Defer (v2+):**
- Virtualized message window for long conversation history — high complexity, basic pagination covers launch
- Conversation history management in gateway — prerequisite for virtualized window, defer together
- A/B testing between providers — only relevant at meaningful scale

See `.planning/research/FEATURES.md` for feature dependency graph and detailed notes.

### Architecture Approach

The architecture is a turn-based cascading pipeline: HTTP request in, STT transcription, OpenClaw WebSocket message, response shaping, HTTP response out. Four key patterns govern the design. First, the provider adapter pattern keeps all WhisperX-specific polling, OpenAI rate-limit handling, and custom HTTP mapping inside isolated adapter packages — the gateway orchestrator only calls `provider.transcribe()` and receives `SttResult`. Second, the OpenClaw WebSocket connection is persistent across turns (not per-request) to avoid 200-500ms handshake overhead on each voice turn. Third, AsyncLocalStorage propagates TurnIds through the entire async call chain without explicit parameter threading. Fourth, response-policy is a pure function with no I/O: full agent text in, viewport-sized pages out, making it trivially testable and decoupled from the network layer.

**Major components:**
1. **HTTP Router + Middleware** (gateway-api) — CORS, rate limiting, request size enforcement, TurnId generation
2. **Turn Controller** (gateway-api/controllers) — lifecycle orchestration: coordinates STT, OpenClaw, and response-policy in sequence
3. **STT Orchestrator + Provider Adapters** (stt-contract + stt-whisperx/stt-openai/stt-custom-http packages) — factory selects provider, adapter owns all transport details
4. **OpenClaw Client** (openclaw-client package) — persistent WebSocket with reconnection, heartbeats, pending-turn correlation map
5. **Response Policy** (response-policy package) — pure function, splits full agent response into 576x288 viewport pages with word-boundary splits and continuation markers
6. **Settings Manager** (gateway-api/config) — schema-validated config store, masked secrets, config-changed events to provider factory
7. **Logging + Validation** (logging + validation packages) — AsyncLocalStorage correlation, secret redaction, Zod boundary validation
8. **Shared Types** (shared-types package) — branded IDs (TurnId, SessionKey, ProviderId), AudioPayload, VoiceTurn lifecycle types

Build order follows the dependency graph: shared-types → logging/validation/stt-contract → adapters/openclaw-client/response-policy → gateway-api.

See `.planning/research/ARCHITECTURE.md` for full data flow diagrams, code examples for each pattern, and anti-pattern explanations.

### Critical Pitfalls

All six critical pitfalls are M1 issues. None are safe to defer.

1. **WhisperX polling without timeout/cancellation** — wrap every poll loop in `Promise.race([poll(), timeout()])` with AbortController; implement per-turn state machine; cancel in-flight polls when new turn starts. Recovery cost if missed: LOW (isolated to adapter), but user experience is broken (infinite hang on glasses display).

2. **Audio format mismatch silently degrading transcription** — normalize all incoming audio to 16kHz mono 16-bit PCM WAV at the gateway boundary before any provider call (ffmpeg via child process); validate Content-Type; test with real Chrome WebM/Opus and Safari CAF/AAC captures, not just pre-made WAV files. Recovery cost if missed: MEDIUM (requires adding ffmpeg dependency and pipeline stage, may require API contract update).

3. **WebSocket to OpenClaw treated as stateless** — implement application-level ping/pong heartbeats (15-30s), exponential backoff reconnection, outbound message queue with replay on reconnection, session re-establishment after reconnect. Recovery cost if missed: HIGH (requires rearchitecting the message flow; do not bolt this on later).

4. **Correlation ID not threaded through the entire turn pipeline** — generate branded TurnId (UUID v7) at HTTP boundary, propagate via AsyncLocalStorage through all async hops, include in outgoing headers to WhisperX and OpenClaw WebSocket messages, return to chat app in response. Recovery cost if missed: MEDIUM (retrofit is painful but possible; much easier before many log statements exist).

5. **Provider abstraction leaking implementation details into the gateway** — `SttProvider.transcribe()` must always return `Promise<SttResult>`; the adapter owns all polling/retry/normalization internally; define `SttError` discriminated union so gateway handles typed errors, not provider-native shapes; write contract tests covering all three adapters with identical input/output matrices. Recovery cost if missed: HIGH (redesigning the interface after three adapters are implemented requires changing all adapters and the orchestrator).

6. **Secret leakage through logs, error responses, and settings API** — build log redaction into the logging package's serializer from day one (SENSITIVE_KEYS allowlist); `GET /api/settings` returns masked secrets only; sanitize upstream error messages before including in HTTP responses; add CI secret scanning. Recovery cost if missed: MEDIUM (audit and retrofit, but security implication is immediate).

See `.planning/research/PITFALLS.md` for integration gotchas table, performance traps, security mistakes, UX pitfalls, and the "Looks Done But Isn't" checklist.

## Implications for Roadmap

The build order is dictated by the dependency graph and the correctness requirements identified in pitfalls research. The foundation phase is larger than typical because six critical pitfalls must be addressed before any integration work begins. The provider extensibility phase proves the abstraction genuinely works. The hardening phase adds production robustness and the differentiating features that require the full pipeline to exist first.

### Phase 1: Foundation — Core Pipeline and Infrastructure

**Rationale:** The dependency graph dictates this order. shared-types and cross-cutting packages (logging with correlation IDs and secret redaction, validation) must exist before any adapter or service code is written. The WhisperX adapter is the first concrete provider and the only provider available for local testing during development. The OpenClaw client's reconnection architecture cannot be bolted on later — it must be correct from the first commit. Response shaping is a prerequisite for any end-to-end test since raw LLM output cannot render on the glasses display. Audio normalization (ffmpeg) must be in the pipeline before the STT adapter is ever called. All six critical pitfalls map to this phase.
**Delivers:** A complete working end-to-end voice turn: audio in → WhisperX transcription → OpenClaw response → viewport-paged response out. Settings API, health/readiness endpoints, structured logging with correlation IDs, error taxonomy, CORS, rate limiting, secret protection.
**Addresses features:** Audio ingestion endpoint, STT provider abstraction + WhisperX adapter, OpenClaw session messaging, response shaping (basic pagination), settings API, health endpoints, structured logging, error taxonomy, retry/backoff, request limits, input validation, secrets protection.
**Avoids:** All six critical pitfalls — WhisperX polling timeout (must ship with AbortController), audio format mismatch (ffmpeg normalization in M1), WebSocket stateful lifecycle (reconnection/heartbeat from first commit), correlation ID threading (AsyncLocalStorage from day one), provider abstraction correctness (interface design before any adapter), secret leakage (log redaction built into logging package).

### Phase 2: Provider Extensibility — Additional Adapters and Failover

**Rationale:** With the full pipeline proven in Phase 1, adding the OpenAI and Custom HTTP adapters is straightforward if the abstraction is clean. This phase is the litmus test: if adding OpenAI requires changes to the gateway orchestrator or the `SttProvider` interface, the abstraction leaked and needs to be fixed here before more adapters accumulate. The failover chain requires 2+ providers, so it belongs in this phase. The turn state machine enables richer chat app UX and is most naturally added when the full pipeline is stable.
**Delivers:** Three interchangeable STT providers, failover/fallback chain, provider switching via config without code changes, turn state machine for precise UI feedback, language hint passthrough.
**Uses:** openai SDK (stt-openai package), native fetch (stt-custom-http package), p-retry for provider-level retry, SttError discriminated union validated across all three adapters via shared contract tests.
**Implements:** Provider factory pattern, SttError union (all three providers mapped), contract test suite (identical input/output matrix for all providers), STT_FAILOVER_CHAIN config.

### Phase 3: Observability and Hardening

**Rationale:** Once the core pipeline and all three providers are working, hardening makes the gateway production-reliable. WebSocket reconnection with message queue replay is important but not required for initial integration testing. Voice turn timing metrics and provider health pre-checks on startup are low-complexity adds that belong here. Rate limiting on the voice endpoint requires load testing to verify.
**Delivers:** Production-grade reliability: graceful WebSocket reconnection with message queue, startup provider health pre-check, voice turn timing metrics in structured logs, load-tested rate limiting, CI secret scanning.
**Avoids:** Performance traps identified in pitfalls research — synchronous audio transcoding blocking the event loop, unbounded conversation history in memory, polling WhisperX too frequently under concurrent load.

### Phase 4: Advanced UX — Virtualized Message Window (Deferred)

**Rationale:** Deferred because the virtualized message window (PRD FR-4.6) requires in-gateway conversation history management, which adds memory complexity and changes the response API contract. Basic pagination from Phase 1 covers the launch use case. This phase becomes relevant when real users hit long-response pain points or when scroll-back is needed for context-aware interactions.
**Delivers:** Sliding window over full conversation history, scroll-to-materialize older content, configurable response policy (maxCharsPerWindow, splitStrategy), conversation history store keyed by session.
**Requires:** Phase 1 and Phase 3 complete; conversation history API surfaced to chat app.

### Phase Ordering Rationale

- The dependency graph (shared-types → logging/validation/stt-contract → adapters → gateway-api) directly maps to Phase 1's internal build order.
- All six critical pitfalls require Phase 1 addressal — there is no safe way to defer any of them to hardening.
- Provider extensibility (Phase 2) is blocked on the Phase 1 abstraction being correct; the contract tests are the gate.
- Hardening (Phase 3) is enabled by having a stable pipeline to load-test and observe.
- The virtualized window (Phase 4) is enabled by the stable response API from Phase 1 and the observability from Phase 3.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (WhisperX adapter):** The WhisperX-FastAPI polling protocol has specific gotchas (exact field names, task state machine, cold-start latency). The local SKILL.md is the primary source; validate against the actual running instance before writing adapter code.
- **Phase 1 (audio normalization):** ffmpeg integration via child process needs verification for the specific audio formats the Even Hub app produces. Test with real captures from the target platform before locking the normalization pipeline.
- **Phase 2 (OpenClaw protocol):** The OpenClaw WebSocket message format, session handshake sequence, and session expiry behavior need verification against the running OpenClaw instance. The gateway must match the protocol exactly.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Fastify + Zod setup):** Well-documented patterns, official Fastify v5 docs are comprehensive, fastify-type-provider-zod has clear examples.
- **Phase 1 (pino logging + AsyncLocalStorage):** Standard Node.js patterns with abundant documentation; the architecture research includes working code examples.
- **Phase 3 (rate limiting + CORS):** @fastify/rate-limit and @fastify/cors are official plugins with complete documentation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All package versions verified against npm registry on 2026-02-28. Technology choices are justified against stable official documentation. Version pinning strategy is conservative. |
| Features | MEDIUM-HIGH | PRD is authoritative (HIGH confidence). Feature landscape validated against vendor blogs and LiveKit/Pipecat architectural comparisons (MEDIUM confidence). Anti-features are PRD-explicit. |
| Architecture | HIGH | Turn-based pipeline is unambiguous for tap-to-talk + no-TTS use case. Component boundaries are well-established patterns (adapter, factory, pure function). Code examples provided for all four key patterns. |
| Pitfalls | HIGH | Six critical pitfalls verified across multiple independent sources: WhisperX SKILL.md (primary), official OpenAI docs, Microsoft observability playbook, WebSocket reconnection literature. Integration gotchas table verified against actual API contracts. |

**Overall confidence:** HIGH

### Gaps to Address

- **OpenClaw WebSocket protocol details:** The exact message format, handshake sequence, session key authentication flow, and session expiry/eviction behavior are not fully documented in available sources. These must be validated against the running OpenClaw instance before the openclaw-client package is finalized. The PRD references an existing OpenClaw gateway but does not specify the wire protocol.
- **Even Hub audio format confirmation:** The audio format that the Even Hub companion app produces when capturing from the phone microphone (WebM/Opus on Android Chrome? CAF/AAC on iOS Safari?) needs confirmation from the actual app behavior. The ffmpeg normalization pipeline handles any input, but understanding the actual format informs which test fixtures to create.
- **WhisperX cold-start latency on target hardware:** Research references 5-15s cold-start latency on an RTX 4090 after idle. The actual latency on Rolands' deployment should be measured to set realistic turn timeout values (the SKILL.md documents 300s for batch but a shorter value is needed for voice turns).
- **tsup build configuration for monorepo:** tsup's monorepo workspace setup with project references needs validation during scaffolding. The MEDIUM confidence on tsup reflects this — the tool is proven, but the specific multi-package configuration may require iteration.

## Sources

### Primary (HIGH confidence)
- PRD.md (local) — authoritative project requirements, feature constraints, anti-features
- PROJECT.md (local) — project context, OpenClaw ecosystem, target hardware
- WhisperX SKILL.md (local, `/home/forge/.openclaw/workspace/skills/whisperx/SKILL.md`) — WhisperX polling contract, health endpoints, timeout defaults
- Node.js releases: https://nodejs.org/en/about/previous-releases — LTS schedule confirmation
- TypeScript releases: https://github.com/microsoft/typescript/releases — version status
- Fastify v5 docs: https://fastify.dev/ — framework API and plugin documentation
- Zod v4 release notes: https://zod.dev/v4 — performance claims and API changes
- Vitest 4: https://vitest.dev/blog/vitest-4 — feature verification
- pnpm workspaces: https://pnpm.io/workspaces — workspace configuration
- OpenAI STT docs: https://platform.openai.com/docs/guides/speech-to-text — API contract, limits, response formats
- Correlation IDs Engineering Playbook: https://microsoft.github.io/code-with-engineering-playbook/observability/correlation-id/ — propagation patterns

### Secondary (MEDIUM confidence)
- Fastify vs Express comparison: https://betterstack.com/community/guides/scaling-nodejs/fastify-express/ — performance claims
- Real-Time vs Turn-Based Voice Agent Architecture (Softcery): https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture — architecture pattern validation
- WebSocket Architecture Best Practices (Ably): https://ably.com/topic/websocket-architecture-best-practices — reconnection and heartbeat patterns
- Multi-Provider STT/TTS Strategies (Sayna AI): https://sayna.ai/blog/multi-provider-stt-tts-strategies-when-and-why-to-abstract-your-speech-stack — provider abstraction patterns
- 6 Best Orchestration Tools for AI Voice Agents 2026 (AssemblyAI): https://www.assemblyai.com/blog/orchestration-tools-ai-voice-agents — ecosystem context
- Whisper Audio Format Discussion: https://github.com/openai/whisper/discussions/41 — format optimization
- WebSocket Reconnection Strategies: https://dev.to/hexshift/robust-websocket-reconnection-strategies-in-javascript-with-exponential-backoff-40n1 — backoff implementation
- Even G2 Architecture Rebuild: https://www.evenrealities.com/blog/how-we-rebuilt-g2-from-the-inside-out — hardware constraints
- Reading on Smart Glasses: https://nhenze.net/uploads/Reading-on-Smart-Glasses-The-Effect-of-Text-Position-Presentation-Type-and-Walking.pdf — display readability research
- Common Secret Leaking Patterns 2026: https://www.d4b.dev/blog/2026-02-04-common-secret-leaking-patterns-2026 — log leakage risk patterns

### Tertiary (LOW confidence)
- Building Resilient Stateful Failover (DEV Community): https://dev.to/dantesbytes/building-resilient-systems-implementing-stateful-failover-between-multiple-external-providers-4i3g — failover chain patterns (community article, patterns are sound)
- Adding Voice to Your AI Agent (DEV Community): https://dev.to/tigranbs/adding-voice-to-your-ai-agent-a-framework-agnostic-integration-pattern-1f02 — framework-agnostic voice integration patterns (single source)

---
*Research completed: 2026-02-28*
*Ready for roadmap: yes*
