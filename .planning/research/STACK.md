# Technology Stack

**Project:** openclaw-even-g2-voice-gateway
**Researched:** 2026-02-28

## Recommended Stack

### Runtime & Language

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | 22.x LTS (22.22.0 installed) | Runtime | Active LTS until Apr 2027. Stable native fetch, native .env loading (v20.6+), native type-stripping (v22.18+). Node 24 LTS exists but 22 is the safer production target for community self-hosters. | HIGH |
| TypeScript | ~5.9.3 | Type system | Current stable. TS 6.0 is in beta, TS 7 (Go-based) in preview -- neither production-ready. Stick with 5.x for rock-solid tooling. | HIGH |
| pnpm | 10.x (10.29.3 installed) | Package manager | Best monorepo workspace support, strict node_modules preventing phantom deps, security-by-default (no auto postinstall scripts since v10). Already installed on this machine. | HIGH |

### Core Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Fastify | 5.7.4 | HTTP server | First-class TypeScript support (generics-based route typing), 2-3x faster than Express in benchmarks, built-in schema validation via JSON Schema or type providers, plugin architecture maps perfectly to the gateway's modular design. Fastify v5 requires Node 20+, which aligns with our Node 22 target. OpenJS Foundation backed. | HIGH |
| @fastify/cors | 11.2.0 | CORS handling | Official plugin. Allowlist-based origin control required by PRD security constraints. | HIGH |
| @fastify/rate-limit | 10.3.0 | Rate limiting | Official plugin. PRD requires request rate limits. In-memory store sufficient for single-instance gateway. | HIGH |
| @fastify/multipart | 9.4.0 | Audio file upload | Official plugin for receiving PCM/WAV audio payloads via multipart POST. Uses @fastify/busboy under the hood. | HIGH |
| @fastify/under-pressure | 9.0.3 | Backpressure / health | Automatic 503 when event loop lag or memory exceeds thresholds. Directly supports `/healthz` and `/readyz` patterns. | HIGH |
| @fastify/sensible | 6.0.4 | HTTP error helpers | Standardized HTTP error constructors (404, 400, 503 etc.) for the error taxonomy the PRD requires. | HIGH |

### Validation & Schema

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zod | 4.3.6 | Runtime validation + type inference | Zod v4 delivers 7-14x parsing speedup over v3, built-in `.toJSONSchema()` for Fastify schema integration, dominant ecosystem (by far the most popular TS validation library). Bundle size is irrelevant for a Node.js service (not browser). Zod's DX and ecosystem maturity beat Valibot for server-side use. | HIGH |
| fastify-type-provider-zod | 6.1.0 | Fastify + Zod bridge | Integrates Zod schemas as Fastify type providers for automatic request/response validation with full TypeScript inference. Eliminates duplicated type definitions. | HIGH |

### Logging & Observability

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| pino | 10.3.1 | Structured JSON logging | Fastify's built-in logger IS pino. 5x faster than Winston. NDJSON output integrates with any log aggregator. Child loggers enable per-turn correlation IDs natively. Zero config needed -- just use Fastify's `logger: true`. | HIGH |
| pino-http | 11.0.0 | HTTP request logging | Automatic request/response logging with correlation IDs. Integrated into Fastify by default, but useful if custom HTTP clients need logging too. | HIGH |
| pino-pretty | 13.1.3 | Dev-only log formatting | Human-readable colored output during development. Must NOT be used in production (defeats pino's performance). | HIGH |

### WebSocket Client

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| ws | 8.19.0 | OpenClaw WebSocket client | The de facto Node.js WebSocket library: 35M weekly npm downloads, battle-tested, zero dependencies. Node.js native WebSocket (via undici) is client-only and lacks the server features and maturity of ws. For the gateway's role as a WebSocket CLIENT connecting to OpenClaw, ws provides reliable reconnection patterns and well-documented APIs. | HIGH |

### HTTP Client (for STT providers)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js native fetch | built-in (v22) | HTTP client for STT providers | Stable in Node 22. No external dependency needed. Supports FormData/Blob for multipart audio uploads to WhisperX and custom STT endpoints. Avoids adding axios/got/undici as explicit deps. | HIGH |

### OpenAI STT Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| openai | 6.25.0 | OpenAI STT adapter | Official SDK handles auth, retries, file uploads, and model selection. Supports `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and legacy `whisper-1`. The SDK manages multipart upload complexity and API versioning automatically. | HIGH |

### Configuration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @fastify/env | 5.0.3 | Env var loading + validation | Official Fastify plugin. Loads .env files, validates against JSON Schema, fails fast on missing/invalid config. Integrates with Fastify's decorator system to make typed config available app-wide. Superior to raw dotenv because it validates at startup. | HIGH |
| Zod (shared) | 4.3.6 | Settings API validation | Reuse Zod schemas for runtime settings validation at the API boundary (POST /api/settings). Single source of truth for config shape. | HIGH |

### Build & Development

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| tsx | 4.21.0 | Dev-time TypeScript execution | Runs .ts files directly via esbuild. Fast startup, --watch mode for dev server. Already installed (v4.21.0). Node native type-stripping exists in v22 but tsx is more mature and handles edge cases better (path aliases, decorators, etc.). | HIGH |
| tsup | 8.5.1 | Production build | Bundles each package for production. esbuild-powered, outputs ESM. Simple config, proven in monorepo setups. tsdown (0.21 beta) is the successor but still beta -- not production-ready. Stick with tsup until tsdown hits 1.0. | MEDIUM |
| TypeScript (tsc) | 5.9.3 | Type checking only | Use `tsc --noEmit` for CI type checking. Do NOT use tsc for building/transpiling -- tsup handles that faster. | HIGH |

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vitest | 4.0.18 | Test runner | PRD mandates Vitest alignment with OpenClaw. v4 is stable with filesystem caching, Zod schema matching, and excellent monorepo support. Fast parallel execution, native ESM, built-in coverage. | HIGH |

### Code Quality

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Biome | 2.4.4 | Linter + formatter | Single Rust binary replaces ESLint + Prettier. 10-100x faster. 423+ lint rules, type-aware linting since v2.0. For a greenfield TypeScript project, Biome eliminates config sprawl (no .eslintrc, .prettierrc, plugin chains). One tool, one config file. | MEDIUM |

### Utility Libraries

| Library | Version | Purpose | Why | Confidence |
|---------|---------|---------|-----|------------|
| nanoid | 5.1.6 | ID generation | Compact, URL-safe, cryptographically strong IDs for TurnId, correlation IDs. Smaller and faster than uuid. | HIGH |
| p-retry | 7.1.1 | Retry with backoff | Clean async retry with exponential backoff for STT and OpenClaw network calls. PRD requires retry/backoff. Simple, well-tested, no bloat. | HIGH |

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HTTP Framework | Fastify 5 | Express 5 | Express lacks native TypeScript support, no built-in schema validation, ~3x slower, no plugin-based architecture for modular decomposition. Express is legacy for greenfield TS projects. |
| HTTP Framework | Fastify 5 | Hono | Hono optimizes for edge/serverless. This is a long-running Node.js service -- Fastify's plugin system and maturity are better fits. |
| Validation | Zod 4 | Valibot | Valibot's bundle size advantage is irrelevant on Node.js. Zod has 10x larger ecosystem, better Fastify integration (fastify-type-provider-zod), and dominant community adoption. |
| Validation | Zod 4 | ArkType | ArkType is fastest in benchmarks but smaller ecosystem, fewer integrations, less battle-tested. Zod v4 is fast enough for this use case. |
| Logger | pino | Winston | Winston is 5x slower and not Fastify's native logger. Using Winston with Fastify means fighting the framework. |
| Package Manager | pnpm | npm workspaces | npm workspaces lack strict mode (phantom deps allowed), slower installs, no content-addressable store. pnpm is the modern standard for TS monorepos. |
| Package Manager | pnpm | Turborepo | Turborepo is a build orchestrator, not a package manager. Could layer it on top of pnpm if build caching becomes needed, but premature for a project this size. |
| WebSocket | ws | Socket.io | Socket.io adds unnecessary abstraction (rooms, namespaces, auto-reconnect). The gateway needs a raw WebSocket client matching OpenClaw's protocol. ws is the right level of abstraction. |
| HTTP Client | native fetch | axios | axios is unnecessary weight when native fetch is stable in Node 22. Avoids another dependency. |
| HTTP Client | native fetch | got | Same reasoning as axios. Native fetch covers the STT provider HTTP needs. |
| Build Tool | tsup | tsdown | tsdown is still beta (0.21). tsup is proven and stable. Switch when tsdown hits 1.0. |
| Build Tool | tsup | tsc (emit) | tsc is slower than esbuild-based tools by 10-50x. Use tsc only for type checking. |
| Linter | Biome | ESLint + Prettier | Two tools, dozens of plugins, complex config. Biome is a single binary, faster, simpler. For greenfield, there is no reason to start with the ESLint plugin ecosystem. |
| Dev Runner | tsx | ts-node | ts-node has chronic ESM compatibility issues on Node 22. tsx (esbuild-based) just works. |
| Dev Runner | tsx | Node native type-stripping | Native stripping (stable in Node 25, experimental in 22) does not support path aliases or tsconfig `paths`, which monorepos often need. tsx handles these. |
| Testing | Vitest | Jest | PRD mandates Vitest for OpenClaw alignment. Vitest is also faster, native ESM, better TS integration. |

---

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| NestJS | Massive framework overhead for what is a focused gateway service. Decorators, DI containers, and class-based abstractions add complexity without benefit here. |
| tRPC | The chat app communicates via standard HTTP REST. tRPC requires client-server coupling that conflicts with the contract-first API design. |
| Prisma / Drizzle / any ORM | No database in this project. Settings persistence is file-based or in-memory. |
| Docker | PRD explicitly excludes Docker. The gateway runs directly alongside OpenClaw via npm. |
| GraphQL | Overkill for 5 endpoints. REST is the right fit for this API surface. |
| Bun | Not the target runtime. OpenClaw ecosystem is Node.js-based. Bun compatibility quirks would add risk for community self-hosters. |
| Deno | Same reasoning as Bun. Node.js is the ecosystem constraint. |
| dotenv (standalone) | Use @fastify/env instead, which loads .env AND validates config schema at startup. Raw dotenv provides no validation. |

---

## Monorepo Structure

```
pnpm-workspace.yaml          # workspace root
tsconfig.base.json            # shared TS config (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes)
biome.json                    # shared lint/format config

services/
  gateway-api/                # Fastify app -- depends on all packages
    package.json
    tsconfig.json             # extends base, project references to packages
    src/
    test/

packages/
  stt-contract/               # SttProvider interface, SttResult type, AudioPayload type
  stt-whisperx/               # WhisperX adapter (native fetch + poll pattern)
  stt-openai/                 # OpenAI adapter (openai SDK)
  stt-custom-http/            # Generic HTTP adapter (native fetch)
  openclaw-client/            # WebSocket client for OpenClaw gateway (ws)
  response-policy/            # Pagination, truncation, viewport shaping
  logging/                    # pino child logger factory, correlation ID utils
  validation/                 # Shared Zod schemas, branded ID types
  shared-types/               # Canonical domain types (TurnId, SessionKey, etc.)
```

### pnpm-workspace.yaml

```yaml
packages:
  - "services/*"
  - "packages/*"
```

### tsconfig.base.json key settings

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

---

## Installation

```bash
# Initialize workspace (from repo root)
pnpm init

# Core framework
pnpm add -F gateway-api fastify @fastify/cors @fastify/rate-limit @fastify/multipart @fastify/under-pressure @fastify/sensible @fastify/env

# Validation
pnpm add -F gateway-api zod fastify-type-provider-zod

# WebSocket client (for OpenClaw)
pnpm add -F openclaw-client ws
pnpm add -DF openclaw-client @types/ws

# OpenAI STT
pnpm add -F stt-openai openai

# Utilities (shared)
pnpm add -w nanoid p-retry

# Logging (pino comes with Fastify, but explicit for packages)
pnpm add -F logging pino pino-http
pnpm add -DF logging pino-pretty

# Dev dependencies (workspace root)
pnpm add -wD typescript tsx tsup vitest @biomejs/biome @types/node
```

---

## Version Pinning Strategy

Use exact versions (`"fastify": "5.7.4"`) in package.json for production dependencies. Use caret ranges (`"^5.9.3"`) for dev dependencies only. This prevents surprise breakage from semver-minor updates in the STT provider adapters and OpenClaw client -- areas where API stability matters most.

---

## Node.js Engine Constraint

Add to root `package.json`:

```json
{
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=10.0.0"
  }
}
```

This ensures community self-hosters use a compatible Node.js version with stable native fetch and .env support.

---

## Sources

- Node.js releases: https://nodejs.org/en/about/previous-releases (HIGH confidence)
- TypeScript releases: https://github.com/microsoft/typescript/releases (HIGH confidence)
- Fastify v5 docs: https://fastify.dev/ (HIGH confidence)
- Fastify v5 release: https://openjsf.org/blog/fastifys-growth-and-success (HIGH confidence)
- Zod v4 release notes: https://zod.dev/v4 (HIGH confidence)
- Vitest 4 announcement: https://vitest.dev/blog/vitest-4 (HIGH confidence)
- pnpm workspaces: https://pnpm.io/workspaces (HIGH confidence)
- pnpm v10 security defaults: https://pnpm.io/blog/2025/12/29/pnpm-in-2025 (HIGH confidence)
- Biome v2: https://biomejs.dev/ (MEDIUM confidence -- version 2.4.4 verified via npm)
- pino docs: https://github.com/pinojs/pino (HIGH confidence)
- ws library: https://github.com/websockets/ws (HIGH confidence)
- OpenAI STT docs: https://platform.openai.com/docs/guides/speech-to-text (HIGH confidence)
- OpenAI Node SDK: https://www.npmjs.com/package/openai (HIGH confidence)
- tsx: https://tsx.is/ (HIGH confidence)
- tsup: https://github.com/egoist/tsup (HIGH confidence)
- Node.js native TypeScript: https://nodejs.org/en/learn/typescript/run-natively (HIGH confidence)
- @fastify/env: https://github.com/fastify/fastify-env (HIGH confidence)
- fastify-type-provider-zod: https://github.com/turkerdev/fastify-type-provider-zod (HIGH confidence)
- Fastify vs Express comparison: https://betterstack.com/community/guides/scaling-nodejs/fastify-express/ (MEDIUM confidence)

All package versions verified against npm registry on 2026-02-28 via `npm view [package] version`.
