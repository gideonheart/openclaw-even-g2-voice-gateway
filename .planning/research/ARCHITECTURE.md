# Architecture Research

**Domain:** Voice gateway / STT orchestration service for smart glasses
**Researched:** 2026-02-28
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
                  Even G2 Glasses
                       |
                  Chat App (separate repo)
                       | HTTP POST (audio + config)
                       v
┌──────────────────────────────────────────────────────────────────┐
│                     GATEWAY API (services/gateway-api)           │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │ HTTP Router  │->│ Turn        │->│ STT Orchestrator         │ │
│  │ + Middleware │  │ Controller  │  │ (provider selection +    │ │
│  │ (CORS, auth, │  │ (lifecycle  │  │  dispatch + normalize)   │ │
│  │  rate limit) │  │  + corrID)  │  │                          │ │
│  └─────────────┘  └──────┬──────┘  └────────────┬─────────────┘ │
│                          │                       │               │
│                          v                       v               │
│                   ┌─────────────┐   ┌──────────────────────┐     │
│                   │ OpenClaw    │   │ STT Provider Adapters │     │
│                   │ Client      │   │ ┌────────┐┌────────┐ │     │
│                   │ (WS session │   │ │WhisperX││OpenAI  │ │     │
│                   │  messaging) │   │ └────────┘└────────┘ │     │
│                   └──────┬──────┘   │ ┌────────────────┐   │     │
│                          │          │ │Custom HTTP     │   │     │
│                          v          │ └────────────────┘   │     │
│                   ┌─────────────┐   └──────────────────────┘     │
│                   │ Response    │                                 │
│                   │ Policy      │                                 │
│                   │ (paginate,  │                                 │
│                   │  truncate,  │                                 │
│                   │  window)    │                                 │
│                   └──────┬──────┘                                 │
│                          │                                       │
│                          v                                       │
│                   Shaped JSON Response                            │
└──────────────────────────────────────────────────────────────────┘
                       | HTTP Response
                       v
                  Chat App -> Glasses Display
```

This is a **turn-based cascading pipeline** (not real-time streaming). The user taps to record, taps to stop, and the gateway processes the full audio through STT then LLM sequentially. This is the correct architecture for this use case because:

1. Even G2 glasses use tap-to-start/tap-to-stop interaction, producing complete audio segments (not continuous streams)
2. No TTS is needed (glasses have no speakers), eliminating half the streaming pipeline
3. Turn-based gives better accuracy, simpler error handling, and predictable latency budgets
4. The glasses viewport (576x288) needs shaped/paginated responses, which requires the full response before rendering

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **HTTP Router + Middleware** | Accept audio uploads, enforce CORS/auth/rate-limits, route to controllers | Express or Fastify with middleware chain |
| **Turn Controller** | Manage the lifecycle of a single voice turn (audio in -> response out), assign correlation IDs, coordinate the pipeline stages | Orchestrator function that calls STT then OpenClaw then Response Policy in sequence |
| **STT Orchestrator** | Select the configured provider, dispatch audio, normalize result to `SttResult` | Factory pattern: read config, instantiate correct adapter, call `transcribe()` |
| **STT Provider Adapters** | Provider-specific HTTP calls (WhisperX poll loop, OpenAI single-shot, Custom HTTP) | Each adapter implements `SttProvider` interface, lives in own package |
| **OpenClaw Client** | Maintain WebSocket connection to OpenClaw gateway, send transcript, receive agent response | Persistent WS with reconnect + exponential backoff, message correlation |
| **Response Policy** | Shape agent responses for 576x288 glasses viewport: paginate, truncate, add window metadata | Pure function: full text in, array of viewport-sized pages out |
| **Settings Manager** | Validate, persist, and serve runtime configuration (provider selection, credentials, OpenClaw URL) | Schema-validated config with secure storage, no secrets in responses |
| **Health/Readiness** | Liveness probe + dependency readiness checks | `/healthz` (always OK if process up), `/readyz` (checks STT + OpenClaw reachability) |
| **Logger** | Structured JSON logging with correlation IDs, secret masking | Shared logging package, pino or similar |
| **Validation** | Runtime schema validation at external boundaries | Zod schemas for HTTP input, provider responses, config |

## Recommended Project Structure

```
openclaw-even-g2-voice-gateway/
├── services/
│   └── gateway-api/              # The runnable Node.js service
│       ├── src/
│       │   ├── server.ts         # HTTP server bootstrap
│       │   ├── routes/           # Route definitions
│       │   │   ├── voice.ts      # POST /api/voice/turn
│       │   │   ├── settings.ts   # GET/POST /api/settings
│       │   │   └── health.ts     # /healthz, /readyz
│       │   ├── controllers/
│       │   │   └── turn.ts       # Turn lifecycle orchestration
│       │   ├── middleware/
│       │   │   ├── cors.ts
│       │   │   ├── rate-limit.ts
│       │   │   └── error-handler.ts
│       │   └── config/
│       │       └── env.ts        # Validated env config loading
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── stt-contract/             # SttProvider interface + SttResult type
│   │   └── src/
│   │       ├── provider.ts       # SttProvider interface
│   │       ├── result.ts         # SttResult, SttError types
│   │       └── index.ts          # Public API barrel
│   │
│   ├── stt-whisperx/             # WhisperX adapter (poll-based)
│   │   └── src/
│   │       ├── adapter.ts        # Implements SttProvider
│   │       ├── poll.ts           # Submit + poll task loop
│   │       └── types.ts          # WhisperX-specific API types
│   │
│   ├── stt-openai/               # OpenAI Whisper adapter (single-shot)
│   │   └── src/
│   │       ├── adapter.ts        # Implements SttProvider
│   │       └── types.ts          # OpenAI-specific types
│   │
│   ├── stt-custom-http/          # Generic HTTP STT adapter
│   │   └── src/
│   │       ├── adapter.ts        # Implements SttProvider
│   │       └── types.ts          # Configurable request/response mapping
│   │
│   ├── openclaw-client/          # OpenClaw WebSocket session client
│   │   └── src/
│   │       ├── client.ts         # WS connection + reconnect
│   │       ├── protocol.ts       # Message types for OpenClaw protocol
│   │       └── session.ts        # Session-scoped message send/receive
│   │
│   ├── response-policy/          # Glasses viewport response shaping
│   │   └── src/
│   │       ├── paginate.ts       # Split response into viewport pages
│   │       ├── truncate.ts       # Truncation rules for long content
│   │       ├── window.ts         # Window metadata (index/total/continuation)
│   │       └── types.ts          # ShapedResponse, PageMeta types
│   │
│   ├── logging/                  # Structured logger with correlation IDs
│   │   └── src/
│   │       ├── logger.ts         # Logger factory
│   │       ├── correlation.ts    # AsyncLocalStorage-based correlation ID
│   │       └── mask.ts           # Secret masking in log output
│   │
│   ├── validation/               # Runtime input validation
│   │   └── src/
│   │       ├── schemas.ts        # Zod schemas for API inputs
│   │       └── guards.ts         # Type guard utilities
│   │
│   └── shared-types/             # Canonical domain types
│       └── src/
│           ├── branded.ts        # Branded ID types (TurnId, SessionKey, etc.)
│           ├── audio.ts          # AudioPayload type
│           ├── turn.ts           # VoiceTurn lifecycle types
│           └── config.ts         # Configuration shape types
│
├── test/
│   ├── unit/                     # Per-package unit tests
│   ├── contract/                 # Provider output normalization tests
│   ├── integration/              # Full pipeline mock tests
│   └── smoke/                    # Startup + health check tests
│
├── pnpm-workspace.yaml
├── tsconfig.base.json            # Shared strict TS config
├── vitest.workspace.ts           # Vitest workspace config
└── .env.example
```

### Structure Rationale

- **services/ vs packages/:** Clear separation between the runnable application and reusable libraries. The gateway service depends on packages, never the reverse. This matches the PRD constraint of "no cross-layer shortcuts."
- **Each STT adapter in its own package:** Enforces the provider abstraction. An adapter cannot accidentally reach into another adapter or bypass the contract. Adding a fourth provider means adding a fourth package -- no changes to existing code.
- **stt-contract as separate package:** The interface lives apart from all implementations. The gateway service and each adapter depend on stt-contract but not on each other. This is the dependency inversion principle applied to the monorepo layout.
- **response-policy as pure functions:** Response shaping has zero side effects -- text goes in, viewport pages come out. This makes it trivially testable and keeps the glasses-specific logic isolated from network concerns.
- **logging + validation as shared packages:** Cross-cutting concerns that every other package needs. Keeping them in packages avoids duplicating correlation ID logic or Zod schemas across adapters.

## Architectural Patterns

### Pattern 1: Turn-Based Pipeline Orchestration

**What:** A single voice turn flows through a linear pipeline: receive audio, transcribe (STT), send to LLM (OpenClaw), shape response, return. Each stage completes before the next begins.
**When to use:** When input arrives as complete audio segments (tap-to-record UX), when no TTS is needed, when response shaping requires the full response.
**Trade-offs:** Higher latency than streaming (expected 1-3s total), but much simpler error handling and state management. For a glasses viewport that needs paginated text, streaming partial tokens adds complexity with little UX benefit.

**Example:**
```typescript
// services/gateway-api/src/controllers/turn.ts
import type { SttProvider, SttResult } from '@voice-gateway/stt-contract';
import type { OpenClawClient } from '@voice-gateway/openclaw-client';
import type { ShapedResponse } from '@voice-gateway/response-policy';

interface TurnContext {
  readonly turnId: TurnId;
  readonly correlationId: string;
  readonly provider: SttProvider;
  readonly openClaw: OpenClawClient;
}

async function processTurn(
  audio: AudioPayload,
  ctx: TurnContext
): Promise<ShapedResponse> {
  // Stage 1: Transcribe
  const transcript: SttResult = await ctx.provider.transcribe(audio, {
    turnId: ctx.turnId,
    language: audio.languageHint,
  });

  // Stage 2: Send to OpenClaw, receive response
  const agentResponse = await ctx.openClaw.sendMessage(
    transcript.text,
    ctx.turnId
  );

  // Stage 3: Shape for glasses viewport
  const shaped = shapeForViewport(agentResponse.text, {
    maxWidth: 576,
    maxHeight: 288,
  });

  return shaped;
}
```

### Pattern 2: Provider Adapter with Shared Contract

**What:** All STT providers implement a single `SttProvider` interface. The gateway never knows which provider is active -- it calls `transcribe()` and gets back an `SttResult`. Provider selection happens at startup/config-change time via a factory.
**When to use:** Always, for any pluggable external service. This is the core extensibility mechanism.
**Trade-offs:** Slight overhead of the abstraction layer, but prevents vendor lock-in and enables fallback routing. The contract must be strict enough to normalize all providers but flexible enough to not lose provider-specific capabilities.

**Example:**
```typescript
// packages/stt-contract/src/provider.ts
export interface SttProvider {
  readonly providerId: ProviderId;
  transcribe(audio: AudioPayload, ctx: SttContext): Promise<SttResult>;
  checkHealth(): Promise<boolean>;
}

export interface SttResult {
  readonly text: string;
  readonly language: string;
  readonly confidence: number | null; // null if provider doesn't report it
  readonly durationMs: number;        // transcription processing time
}

// packages/stt-whisperx/src/adapter.ts
export class WhisperXAdapter implements SttProvider {
  readonly providerId = 'whisperx' as ProviderId;

  async transcribe(audio: AudioPayload, ctx: SttContext): Promise<SttResult> {
    // 1. POST audio to /speech-to-text
    const taskId = await this.submitAudio(audio);
    // 2. Poll GET /task/{taskId} until complete
    const raw = await this.pollUntilComplete(taskId, ctx);
    // 3. Normalize to SttResult
    return this.normalize(raw);
  }
}
```

### Pattern 3: Persistent WebSocket with Reconnection

**What:** The OpenClaw client maintains a single WebSocket connection per configured session. On disconnect, it reconnects with exponential backoff. Messages are correlated by turn ID so responses can be matched to requests.
**When to use:** For the OpenClaw integration specifically. The WS connection is long-lived (not per-request) because establishing a new WS handshake per turn would add 100-300ms latency.
**Trade-offs:** Must handle connection state carefully -- what happens if a turn is in-flight when the WS drops? Must buffer or fail-fast. Reconnection logic adds complexity but is essential for reliability.

**Example:**
```typescript
// packages/openclaw-client/src/client.ts
export class OpenClawClient {
  private ws: WebSocket | null = null;
  private pendingTurns: Map<TurnId, PendingTurn> = new Map();

  async connect(url: string, token: string): Promise<void> {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onclose = () => this.scheduleReconnect();
  }

  async sendMessage(text: string, turnId: TurnId): Promise<AgentResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new OpenClawConnectionError('Not connected');
    }
    return new Promise((resolve, reject) => {
      this.pendingTurns.set(turnId, { resolve, reject, sentAt: Date.now() });
      this.ws!.send(JSON.stringify({
        type: 'user_message',
        sessionKey: this.sessionKey,
        turnId,
        text,
      }));
    });
  }
}
```

### Pattern 4: AsyncLocalStorage Correlation IDs

**What:** Each incoming HTTP request generates a unique correlation ID (turnId). Using Node.js `AsyncLocalStorage`, this ID propagates through the entire async call chain without explicit parameter threading. Every log line, error report, and metric includes this ID.
**When to use:** Always, from day one. Debugging production voice turns without correlation IDs is effectively impossible.
**Trade-offs:** Minimal performance overhead (AsyncLocalStorage is well-optimized in Node.js). Requires discipline to use the logger from the shared package rather than raw `console.log`.

**Example:**
```typescript
// packages/logging/src/correlation.ts
import { AsyncLocalStorage } from 'node:async_hooks';

interface TurnContext {
  readonly turnId: TurnId;
  readonly startedAt: number;
}

export const turnStore = new AsyncLocalStorage<TurnContext>();

// In middleware:
app.use((req, res, next) => {
  const turnId = generateTurnId();
  turnStore.run({ turnId, startedAt: Date.now() }, () => next());
});

// In any package, any depth:
export function log(level: string, msg: string, data?: unknown): void {
  const ctx = turnStore.getStore();
  console.log(JSON.stringify({
    level,
    msg,
    turnId: ctx?.turnId ?? 'no-context',
    elapsed: ctx ? Date.now() - ctx.startedAt : undefined,
    ...data,
  }));
}
```

## Data Flow

### Voice Turn Request Flow

```
Chat App
    |
    | POST /api/voice/turn
    | Body: { audio: Buffer (PCM/WAV), languageHint?: string }
    | Headers: Content-Type, X-Request-Id
    v
[HTTP Middleware]
    | - CORS check
    | - Rate limit check
    | - Request size validation
    | - Generate TurnId + correlation context
    v
[Turn Controller]
    | - Validate audio payload (format, size, duration)
    | - Look up active STT provider from config
    v
[STT Orchestrator] ──> [STT Adapter (selected)]
    |                        |
    |                        | WhisperX: POST /speech-to-text + poll /task/{id}
    |                        | OpenAI: POST /v1/audio/transcriptions (single-shot)
    |                        | Custom: POST to configured URL
    |                        v
    |                   External STT Service
    |                        |
    |                   Raw provider response
    |                        |
    |                   Normalize to SttResult
    |<───────────────────────┘
    |
    | SttResult { text, language, confidence, durationMs }
    v
[OpenClaw Client]
    | - Send transcript over persistent WebSocket
    | - Wait for agent response (with timeout)
    | - Correlate response by turnId
    v
OpenClaw Gateway (external)
    |
    | Agent response text
    v
[Response Policy]
    | - Measure text against 576x288 viewport
    | - Split into pages if needed
    | - Add window metadata (pageIndex, totalPages, continuationMarker)
    | - Normalize whitespace for narrow display
    v
[HTTP Response]
    |
    | JSON: {
    |   turnId,
    |   transcript: { text, language, confidence },
    |   response: {
    |     fullText,
    |     pages: [{ text, index, isLast }],
    |     currentPage: 0,
    |     totalPages: N
    |   }
    | }
    v
Chat App -> Glasses Display
```

### Configuration Flow

```
Chat App Settings UI
    |
    | POST /api/settings { provider, credentials, openClawUrl, ... }
    v
[Validation Layer]
    | - Zod schema validation
    | - Credential format checks (not connectivity checks)
    v
[Settings Manager]
    | - Persist to local file or env-backed store
    | - Mask secrets in any log output
    | - Emit config-changed event
    v
[Provider Factory]              [OpenClaw Client]
    | - Re-instantiate adapter      | - Reconnect to new URL if changed
    | - Run health check            | - Re-authenticate if token changed
    v                               v
Ready for next turn with new config
```

### Key Data Flows

1. **Audio In -> Transcript Out (STT):** Binary audio payload crosses the HTTP boundary, gets dispatched to the configured adapter. Each adapter handles its own transport (WhisperX uses async polling with configurable interval/timeout; OpenAI is a single POST/response; Custom HTTP is configurable). All normalize to the same `SttResult` shape before returning to the turn controller.

2. **Transcript -> Agent Response (OpenClaw):** Plain text transcript goes over a persistent WebSocket. The client maintains a map of pending turns keyed by `TurnId`. When a response arrives, it resolves the matching promise. Timeout (configurable, suggest 30s default) rejects with a typed error so the turn controller can return an appropriate HTTP error.

3. **Agent Response -> Shaped Pages (Response Policy):** The full agent response text is split into viewport-sized pages. This is a pure computation with no I/O. The policy considers line length (characters per line at the glasses font size), total lines per page, and paragraph boundaries. Continuation markers indicate when a message spans multiple pages.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 concurrent users | Single process, single WS to OpenClaw, no queuing needed. This is the target scale for v1 -- self-hosters with one pair of glasses. |
| 10-50 concurrent users | Add request queuing for STT (WhisperX can only process one transcription at a time on a single GPU). Consider STT request timeout to prevent pile-up. OpenClaw WS connection pooling (one per session key). |
| 50+ concurrent users | Out of scope for this project's target audience, but: horizontal scaling behind a load balancer, sticky sessions for WS, Redis-backed config store. Not recommended to over-engineer for this. |

### Scaling Priorities

1. **First bottleneck: STT processing time.** WhisperX on a single GPU processes sequentially. If two users submit audio simultaneously, one waits. Mitigation: per-request timeout + queue with max depth + clear error when overloaded. For v1, this is acceptable because target is 1-3 simultaneous users.
2. **Second bottleneck: OpenClaw response latency.** LLM response times vary (500ms to 10s+ depending on agent complexity). Mitigation: generous timeout (30s), clear "thinking" state communicated to chat app, response streaming from OpenClaw if protocol supports it.

## Anti-Patterns

### Anti-Pattern 1: Provider Logic in the Gateway Service

**What people do:** Put WhisperX polling logic, OpenAI API calls, and response normalization directly in the route handler or controller.
**Why it is wrong:** Violates SRP. When you add a fourth provider or change WhisperX's polling behavior, you are editing the gateway service instead of an isolated package. Testing requires mocking the entire HTTP layer instead of just the adapter interface.
**Do this instead:** Each provider is a separate package implementing `SttProvider`. The gateway service only imports the contract package and the selected adapter. Provider-specific logic is invisible to the service.

### Anti-Pattern 2: Creating a New WebSocket per Voice Turn

**What people do:** Open a WebSocket to OpenClaw when a voice turn arrives, send the message, receive the response, close the connection.
**Why it is wrong:** WS handshake adds 50-300ms per turn. Connection setup/teardown creates unnecessary load on OpenClaw. Loses session continuity and any server-side connection state.
**Do this instead:** Maintain a persistent WebSocket that outlives individual turns. Reconnect on failure with exponential backoff. Correlate turns by ID, not by connection.

### Anti-Pattern 3: Synchronous Config Reads on Every Request

**What people do:** Read the `.env` file or call a config endpoint on every incoming request to get the current provider configuration.
**Why it is wrong:** File I/O on every request adds latency and creates a hot path that can fail. Config rarely changes (maybe once per session).
**Do this instead:** Load config at startup, cache in memory. When settings change via API, validate, persist, and update the in-memory cache. Provider factory creates a new adapter instance only on config change.

### Anti-Pattern 4: Leaking Provider-Specific Errors to the Client

**What people do:** Let WhisperX 500 errors or OpenAI rate-limit errors propagate directly to the chat app as raw error payloads.
**Why it is wrong:** Exposes internal architecture. Chat app cannot meaningfully act on "WhisperX task failed with status FAILURE". Leaks information about which provider is in use.
**Do this instead:** Map all provider errors to a small set of typed gateway errors: `STT_UNAVAILABLE`, `STT_TIMEOUT`, `TRANSCRIPTION_FAILED`, `OPENCLAW_UNAVAILABLE`, `RESPONSE_ERROR`. Log the full provider error server-side with the correlation ID.

### Anti-Pattern 5: Mixing Response Shaping with OpenClaw Communication

**What people do:** Have the OpenClaw client truncate or paginate the response before returning it.
**Why it is wrong:** Couples display concerns to the communication layer. If the viewport size changes or a new display target is added, you must modify the OpenClaw client.
**Do this instead:** OpenClaw client returns the full, unmodified agent response. Response Policy is a separate pure-function package that takes full text + viewport constraints and produces shaped output. Different display targets can have different policies without touching the OpenClaw client.

## Integration Points

### External Services

| Service | Integration Pattern | Gotchas |
|---------|---------------------|---------|
| **WhisperX (self-hosted)** | HTTP POST audio -> poll task endpoint until status is "completed" | Async polling means you need configurable poll interval (default 1s) and timeout (default 60s). Task can return "FAILURE" -- must handle gracefully. Audio format must be supported (WAV, OGG, MP3). Health check via `GET /health/ready`. |
| **OpenAI STT** | Single HTTP POST to `/v1/audio/transcriptions` with multipart form data | Rate limits apply. API key must be kept secret. Response is synchronous -- no polling needed. Max audio file size 25MB. Model selection (`whisper-1`) is mandatory. |
| **Custom HTTP STT** | Configurable POST to user-provided URL with audio payload | Must define expected request format (multipart? raw binary?) and response shape. Should validate response matches expected schema. Timeout and retry behavior must be configurable per-endpoint. |
| **OpenClaw Gateway** | Persistent WebSocket connection, protocol-specific message format | Must match OpenClaw's gateway protocol exactly. Session key authentication. Message format likely JSON over WS. Need to handle: connection drops, authentication failures, session not found, agent timeout. |

### Internal Boundaries

| Boundary | Communication | Considerations |
|----------|---------------|----------------|
| **gateway-api -> stt-contract** | TypeScript import (compile-time) | Gateway depends on the interface, never on concrete adapters directly. Adapter selection via factory at runtime. |
| **gateway-api -> stt-{provider}** | Dynamic import or factory instantiation | Only one adapter is active at a time. Factory reads config, returns the correct `SttProvider` implementation. |
| **gateway-api -> openclaw-client** | TypeScript import, long-lived instance | Client is instantiated at startup, persists across requests. Gateway passes transcript string + turnId, receives agent response. |
| **gateway-api -> response-policy** | TypeScript import, pure function call | No state, no side effects. Input: full text + viewport config. Output: shaped response with pagination metadata. |
| **gateway-api -> logging** | TypeScript import, AsyncLocalStorage | Every package uses the shared logger. Correlation ID is injected via middleware and automatically available in all async contexts. |
| **gateway-api -> validation** | TypeScript import, schema functions | Validation runs at HTTP boundaries (request body) and at provider response boundaries (normalize external data). |
| **gateway-api -> shared-types** | TypeScript import (compile-time) | Branded types, audio payload shapes, turn lifecycle types. All packages depend on shared-types for canonical definitions. |

## Build Order (Dependency Graph)

The dependency graph dictates the build order. Packages with no dependencies must be built first.

```
Layer 0 (no deps):       shared-types
                               |
Layer 1 (depends on L0):  stt-contract, logging, validation
                           |           |          |
Layer 2 (depends on L0-1): stt-whisperx, stt-openai, stt-custom-http,
                           openclaw-client, response-policy
                               |
Layer 3 (depends on all): gateway-api (services/)
```

**Suggested implementation order for roadmap:**

1. **shared-types** -- Branded IDs, AudioPayload, SttResult, config shapes. Zero external deps, fast to build, everything depends on it.
2. **logging + validation** -- Cross-cutting concerns needed by every other package. Build once, use everywhere.
3. **stt-contract** -- The `SttProvider` interface and `SttResult` type. Tiny package, but must be locked down before any adapter work begins.
4. **stt-whisperx** -- First concrete adapter. WhisperX is the default provider and the user has a running instance for testing. This proves the contract works.
5. **openclaw-client** -- WebSocket client for OpenClaw. Can be tested against the user's running OpenClaw instance. This is the second critical integration point.
6. **response-policy** -- Pure functions for viewport shaping. Can be built and tested in isolation with mock text data. No external dependencies.
7. **gateway-api** -- The service that wires everything together. By this point, all packages exist and have been unit-tested independently.
8. **stt-openai + stt-custom-http** -- Additional adapters. These prove the contract is genuinely pluggable, not just WhisperX-shaped. Build after the first adapter proves the pattern.

This order ensures each layer is testable before the layer above it is built. The gateway-api is the final integration point, assembled from already-proven packages.

## Sources

- [Multi-Provider STT/TTS Strategies: When and Why to Abstract Your Speech Stack](https://dev.to/tigranbs/multi-provider-stttts-strategies-when-and-why-to-abstract-your-speech-stack-2aio) -- MEDIUM confidence, verified against multiple sources
- [Chained Voice Agent Architectures: Speech-to-Speech vs Chained Pipeline vs Hybrid](https://brain.co/blog/chained-voice-agent-architectures-speech-to-speech-vs-chained-pipeline-vs-hybrid-approaches) -- MEDIUM confidence
- [Designing Voice AI Workflows Using STT + NLP + TTS (Deepgram)](https://deepgram.com/learn/designing-voice-ai-workflows-using-stt-nlp-tts) -- MEDIUM confidence, specific latency budgets and error handling patterns
- [Real-Time vs Turn-Based Voice Agent Architecture (Softcery)](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture) -- MEDIUM confidence, cost and architecture comparison
- [The Voice AI Stack for Building Agents (AssemblyAI)](https://www.assemblyai.com/blog/the-voice-ai-stack-for-building-agents) -- MEDIUM confidence
- [Adding Voice to Your AI Agent: A Framework-Agnostic Integration Pattern](https://dev.to/tigranbs/adding-voice-to-your-ai-agent-a-framework-agnostic-integration-pattern-1f02) -- LOW confidence (single source)
- [WebSocket Architecture Best Practices (Ably)](https://ably.com/topic/websocket-architecture-best-practices) -- MEDIUM confidence
- WhisperX SKILL.md (local reference, `/home/forge/.openclaw/workspace/skills/whisperx/SKILL.md`) -- HIGH confidence, verified local documentation of actual API
- PRD.md (local reference) -- HIGH confidence, authoritative project requirements

---
*Architecture research for: voice gateway / STT orchestration service*
*Researched: 2026-02-28*
