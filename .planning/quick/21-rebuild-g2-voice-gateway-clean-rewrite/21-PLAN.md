---
phase: quick-21
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - services/gateway-api/src/index.ts
  - services/gateway-api/src/server.ts
  - services/gateway-api/src/orchestrator.ts
  - services/gateway-api/src/config-store.ts
  - services/gateway-api/src/config-loader.ts
  - services/gateway-api/src/provider-rebuilder.ts
  - services/gateway-api/src/openclaw-rebuilder.ts
  - services/gateway-api/src/server.test.ts
  - services/gateway-api/src/orchestrator.test.ts
  - services/gateway-api/src/config-store.test.ts
  - services/gateway-api/src/config-loader.test.ts
  - services/gateway-api/src/provider-rebuilder.test.ts
  - services/gateway-api/src/openclaw-rebuilder.test.ts
  - test/integration/text-turn.test.ts
autonomous: true
requirements: [REWRITE-01]

must_haves:
  truths:
    - "POST /api/voice/turn accepts audio, runs STT, queries OpenClaw, returns GatewayReply"
    - "POST /api/text/turn accepts JSON text, queries OpenClaw, returns GatewayReply with sttMs=0"
    - "GET /healthz returns 200 with status ok"
    - "GET /readyz checks STT + OpenClaw health"
    - "POST /api/settings validates and applies config patches at runtime"
    - "GET /api/settings returns secrets-masked config"
    - "CORS, rate limiting, body size limits, and error handling all function"
    - "Config loads from env vars with sensible defaults"
    - "STT providers and OpenClaw client hot-reload when config changes"
    - "All existing tests pass with the rewritten code"
  artifacts:
    - path: "services/gateway-api/src/server.ts"
      provides: "HTTP server with all API routes"
      exports: ["createGatewayServer", "RateLimiter", "ServerDeps"]
    - path: "services/gateway-api/src/orchestrator.ts"
      provides: "Voice and text turn pipeline orchestration"
      exports: ["executeVoiceTurn", "executeTextTurn", "OrchestratorDeps", "TextTurnDeps"]
    - path: "services/gateway-api/src/config-store.ts"
      provides: "Mutable config store with change listeners and validation"
      exports: ["ConfigStore", "validateSettingsPatch", "ValidatedSettingsPatch"]
    - path: "services/gateway-api/src/config-loader.ts"
      provides: "Env var config loading"
      exports: ["loadConfig"]
    - path: "services/gateway-api/src/index.ts"
      provides: "Entry point wiring all deps"
    - path: "services/gateway-api/src/provider-rebuilder.ts"
      provides: "Hot-reload STT providers"
      exports: ["registerProviderRebuilder"]
    - path: "services/gateway-api/src/openclaw-rebuilder.ts"
      provides: "Hot-reload OpenClaw client"
      exports: ["registerOpenClawRebuilder"]
  key_links:
    - from: "services/gateway-api/src/server.ts"
      to: "services/gateway-api/src/orchestrator.ts"
      via: "executeVoiceTurn/executeTextTurn calls in route handlers"
      pattern: "execute(Voice|Text)Turn"
    - from: "services/gateway-api/src/orchestrator.ts"
      to: "@voice-gateway/openclaw-client"
      via: "openclawClient.sendTranscript"
      pattern: "sendTranscript"
    - from: "services/gateway-api/src/orchestrator.ts"
      to: "@voice-gateway/response-policy"
      via: "shapeResponse for reply envelope"
      pattern: "shapeResponse"
    - from: "services/gateway-api/src/index.ts"
      to: "services/gateway-api/src/server.ts"
      via: "createGatewayServer"
      pattern: "createGatewayServer"
---

<objective>
Clean rewrite of the gateway-api service (`services/gateway-api/src/`).

Purpose: The user wants to throw away the current implementation and rewrite the gateway service from scratch with fresh, clean code. The packages (`packages/*`) are NOT being rewritten -- only the service layer that consumes them. The rewrite must preserve all existing functionality and pass all existing tests.

Output: Rewritten `services/gateway-api/src/*.ts` files + updated tests that verify identical behavior.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@CLAUDE.md
@ARCHITECTURE.md
@services/gateway-api/package.json
@packages/shared-types/src/index.ts
@packages/shared-types/src/branded.ts
@packages/shared-types/src/voice-turn.ts
@packages/shared-types/src/config.ts
@packages/stt-contract/src/provider.ts
@packages/openclaw-client/src/openclaw-client.ts
@packages/response-policy/src/shaper.ts
@packages/logging/src/index.ts
@packages/validation/src/index.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rewrite all gateway-api source files from scratch</name>
  <files>
    services/gateway-api/src/config-loader.ts
    services/gateway-api/src/config-store.ts
    services/gateway-api/src/orchestrator.ts
    services/gateway-api/src/server.ts
    services/gateway-api/src/provider-rebuilder.ts
    services/gateway-api/src/openclaw-rebuilder.ts
    services/gateway-api/src/index.ts
  </files>
  <action>
Rewrite all 7 source files in `services/gateway-api/src/` from scratch. Delete each file's current content entirely, then write fresh implementations. The rewrite MUST:

**Read the existing files first** to understand every exported symbol, every function signature, every behavior. Then write new code that preserves the identical PUBLIC API (exports, function signatures, types) so that existing tests pass without modification.

**Order of rewrite** (build bottom-up, types before consumers):

1. **config-loader.ts** — Loads `GatewayConfig` from env vars. Must export `loadConfig(env?)`. Use a clean helper approach for parsing ints (handle NaN + non-positive). Same defaults as current (port 4400, host 0.0.0.0, whisperx default provider, etc). Opportunity: reduce verbosity of the env reading -- consider a small parseEnv utility or destructured approach instead of the current repetitive pattern.

2. **config-store.ts** — Mutable config store. Must export `ConfigStore` class (constructor takes GatewayConfig), `validateSettingsPatch(body)`, and `ValidatedSettingsPatch` type. `get()` returns frozen config, `getSafe()` masks secrets (openclawGatewayToken, openai.apiKey, customHttp.authHeader), `update(patch)` shallow-merges nested objects and fires onChange listeners. The `validateSettingsPatch` function validates unknown input, converts branded types, throws `UserError(INVALID_CONFIG)` on bad input. Opportunity: the current nested validation is very repetitive -- consider a declarative validation approach or at minimum cleaner helper functions.

3. **orchestrator.ts** — Turn pipelines. Must export `executeVoiceTurn(request, deps)` and `executeTextTurn(request, deps)`, plus `OrchestratorDeps` and `TextTurnDeps` interfaces. Voice pipeline: get STT provider from map -> transcribe -> sendTranscript to OpenClaw -> shapeResponse -> build GatewayReply with timing. Text pipeline: same but skip STT (sttMs=0, provider="text"). Opportunity: extract the shared "send to OpenClaw + shape + build reply" into a helper to eliminate duplication between voice and text turns.

4. **server.ts** — HTTP server + RateLimiter. Must export `createGatewayServer(deps)`, `RateLimiter` class, `ServerDeps` interface. Routes: POST /api/voice/turn, POST /api/text/turn, POST /api/settings, GET /api/settings, GET /healthz, GET /readyz, OPTIONS (CORS preflight). All routes go through: readiness gate -> CORS check -> rate limiting (for POST endpoints) -> handler. The handleCors function enforces strict CORS with origin allowlist, null origin support, preflight handling. Error handling maps UserError->400, OperatorError->502, unknown->500. Opportunity: the current routing is a big if/else chain -- consider extracting a minimal router or at least cleaning up the structure. The CORS handler and body reader can be streamlined.

5. **provider-rebuilder.ts** — Must export `registerProviderRebuilder(configStore, sttProviders, logger)`. Listens for config changes on whisperx/openai/customHttp keys, rebuilds the corresponding provider instance in the Map.

6. **openclaw-rebuilder.ts** — Must export `registerOpenClawRebuilder(configStore, deps, logger)`. Listens for config changes on openclawGatewayUrl/openclawGatewayToken, disconnects old client, creates new one, swaps reference on deps.

7. **index.ts** — Entry point. Wires all deps: loadConfig -> ConfigStore -> build STT providers -> create OpenClawClient -> register rebuilders -> createGatewayServer -> startup pre-checks (health) with 30s timeout -> listen -> graceful shutdown on SIGTERM/SIGINT.

**Key constraints:**
- Runtime is Bun (per CLAUDE.md), but code should be compatible with Node.js too (uses node:http, node:crypto)
- TypeScript strict mode -- no `any` in core paths
- All imports use `@voice-gateway/*` workspace packages
- All existing exports must remain so tests don't break
- Use `import type` for type-only imports
- The `MAX_TEXT_BODY_BYTES` constant (64KB) must remain for text turn body limit
- The `RateLimiter` class must remain exported from server.ts (tests reference it)

**What "clean rewrite" means:**
- Fresh code structure, not copy-paste-edit
- Reduce duplication (orchestrator voice/text share logic; config validation is repetitive)
- Cleaner routing in server.ts
- Better variable names where current ones are unclear
- Consistent coding style throughout
- Preserve every behavioral edge case (empty text rejection, null origin CORS, etc.)
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run services/gateway-api/src/ --reporter=verbose 2>&1 | tail -30</automated>
    <manual>All existing unit tests in services/gateway-api/src/*.test.ts pass without modification</manual>
  </verify>
  <done>All 7 source files rewritten from scratch. Every existing test file (config-loader.test.ts, config-store.test.ts, orchestrator.test.ts, server.test.ts, provider-rebuilder.test.ts, openclaw-rebuilder.test.ts) passes without any changes to test files. TypeScript compiles cleanly.</done>
</task>

<task type="auto">
  <name>Task 2: Verify full test suite and integration tests pass</name>
  <files>
    test/integration/text-turn.test.ts
  </files>
  <action>
Run the complete test suite (`npx vitest run`) to verify that ALL tests pass -- both the unit tests from Task 1 and the integration test at `test/integration/text-turn.test.ts`.

If any tests fail:
1. Read the failing test carefully
2. Identify which behavioral contract the rewritten code violates
3. Fix the source code (NOT the test) to match the expected behavior
4. Re-run until green

Also run TypeScript type checking: `npx tsc --noEmit` to ensure no type errors.

After all tests pass, run `npx vitest run --reporter=verbose` one final time and capture the output showing all tests green.

Do NOT modify any test files -- the tests define the behavioral contract that the rewrite must honor.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run --reporter=verbose 2>&1 | tail -50</automated>
    <manual>All tests pass (192+ tests), TypeScript compiles with no errors</manual>
  </verify>
  <done>Full test suite passes (all unit tests + integration tests). `npx tsc --noEmit` reports zero errors. The rewritten gateway-api service is behaviorally identical to the original.</done>
</task>

</tasks>

<verification>
1. `npx vitest run` -- all tests pass (unit + integration)
2. `npx tsc --noEmit` -- no TypeScript errors
3. No test files were modified -- the rewrite satisfies the existing behavioral contracts
4. All exported symbols from each file remain identical (function names, class names, type exports)
</verification>

<success_criteria>
- All 7 gateway-api source files rewritten from scratch with cleaner code
- All existing tests pass without modification (tests are the contract)
- TypeScript compiles cleanly in strict mode
- No behavioral regressions
</success_criteria>

<output>
After completion, create `.planning/quick/21-rebuild-g2-voice-gateway-clean-rewrite/21-SUMMARY.md`
</output>
