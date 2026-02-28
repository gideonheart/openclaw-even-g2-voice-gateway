---
phase: quick-1
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - services/gateway-api/src/server.ts
  - services/gateway-api/src/orchestrator.ts
  - services/gateway-api/src/config-loader.ts
  - services/gateway-api/src/config-loader.test.ts
  - services/gateway-api/src/orchestrator.test.ts
  - services/gateway-api/src/index.ts
  - test/integration/voice-turn.test.ts
autonomous: true
requirements: [PIPE-01, OPS-01, OPS-05, SAFE-03, SAFE-04]
must_haves:
  truths:
    - "Invalid env var values (non-numeric PORT, NaN poll intervals) are caught at startup, not silently propagated"
    - "Missing STT provider returns a typed OperatorError with code, not a bare Error"
    - "Rate limiting rejects requests exceeding the configured per-minute threshold with 429"
    - "Graceful shutdown completes within a bounded timeout even if connections hang"
    - "Double-reject in readBody on oversized payloads cannot crash the process"
  artifacts:
    - path: "services/gateway-api/src/server.ts"
      provides: "Rate limiter, safe readBody, bounded shutdown"
    - path: "services/gateway-api/src/orchestrator.ts"
      provides: "Typed error for missing provider, model metadata passthrough"
    - path: "services/gateway-api/src/config-loader.ts"
      provides: "NaN-safe parseInt with validation"
  key_links:
    - from: "services/gateway-api/src/server.ts"
      to: "services/gateway-api/src/orchestrator.ts"
      via: "handleVoiceTurn calls executeVoiceTurn"
      pattern: "executeVoiceTurn"
    - from: "services/gateway-api/src/config-loader.ts"
      to: "services/gateway-api/src/index.ts"
      via: "loadConfig at startup"
      pattern: "loadConfig"
---

<objective>
Harden the Phase 1 implementation: fix edge cases, add missing rate limiting, make config parsing NaN-safe, use typed errors consistently, and add bounded graceful shutdown. These are concrete defects and gaps found by reviewing the 4 overnight commits against the OVERNIGHT_TODO checklist.

Purpose: Ship a Phase 1 that is actually production-safe before layering Phase 2 on top. Untyped errors, missing rate limiting, and NaN config propagation are landmines.
Output: Hardened server, orchestrator, and config-loader with passing tests.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@services/gateway-api/src/server.ts
@services/gateway-api/src/orchestrator.ts
@services/gateway-api/src/config-loader.ts
@services/gateway-api/src/index.ts
@packages/shared-types/src/errors.ts
@packages/shared-types/src/config.ts
@packages/validation/src/guards.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix config-loader NaN propagation and orchestrator error typing</name>
  <files>
    services/gateway-api/src/config-loader.ts
    services/gateway-api/src/config-loader.test.ts
    services/gateway-api/src/orchestrator.ts
    services/gateway-api/src/orchestrator.test.ts
  </files>
  <action>
**config-loader.ts** -- replace all bare `parseInt(...)` calls with a safe helper that throws `OperatorError(ErrorCodes.INVALID_CONFIG, ...)` when the result is `NaN` or non-positive where a positive int is expected. Specifically:
- `pollIntervalMs`, `timeoutMs` (line 21-22): must be positive integers
- `port` (line 40): must be 1-65535
- `maxAudioBytes` (line 46-47): must be positive
- `rateLimitPerMinute` (line 50-51): must be positive

Add a local `safeParseInt(raw: string | undefined, defaultVal: number, fieldName: string): number` helper at the top of the file that:
1. Returns `defaultVal` if `raw` is undefined or empty
2. Calls `parseInt(raw, 10)` and throws `OperatorError(ErrorCodes.INVALID_CONFIG, ...)` if result is `NaN`
3. Returns the parsed number

Import `OperatorError` and `ErrorCodes` from `@voice-gateway/shared-types`.

**config-loader.test.ts** -- add 2 tests:
1. "throws on non-numeric PORT" -- `loadConfig({ PORT: "abc" })` throws with `INVALID_CONFIG`
2. "throws on non-numeric WHISPERX_POLL_INTERVAL_MS" -- same pattern

**orchestrator.ts** -- change line 53 from:
```ts
throw new Error(`No STT provider registered for: ${deps.activeProviderId}`);
```
to:
```ts
throw new OperatorError(
  ErrorCodes.MISSING_CONFIG,
  "STT provider not available",
  `No STT provider registered for: ${deps.activeProviderId}`,
);
```

Import `OperatorError` and `ErrorCodes` from `@voice-gateway/shared-types` (they are already partially imported -- add OperatorError to the existing import).

Also update orchestrator to thread `sttResult.providerId` string into `meta.model` if the STT result carries it. Currently `meta.model` is hardcoded to `null`. Change line 106 to: `model: null` stays as-is for now (model info isn't in SttResult yet -- this is a Phase 2 concern). But DO add a comment: `// TODO(phase-2): thread SttResult.model when available`.

**orchestrator.test.ts** -- update the "throws when provider not found" test to expect `OperatorError` instead of bare `Error`:
```ts
import { OperatorError } from "@voice-gateway/shared-types";
// ...
).rejects.toThrow(OperatorError);
```
Keep the existing message check as a second assertion or use `toThrowError` with a regex.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run services/gateway-api/src/config-loader.test.ts services/gateway-api/src/orchestrator.test.ts --reporter=verbose 2>&1 | tail -30</automated>
    <manual>Confirm no bare `parseInt` calls remain in config-loader.ts and no bare `throw new Error` in orchestrator.ts</manual>
  </verify>
  <done>
    - `loadConfig({ PORT: "abc" })` throws OperatorError with INVALID_CONFIG
    - `loadConfig({ WHISPERX_POLL_INTERVAL_MS: "not-a-number" })` throws OperatorError
    - `loadConfig({})` still works (defaults are valid)
    - Missing provider throws OperatorError, not Error
    - All existing config-loader and orchestrator tests still pass
  </done>
</task>

<task type="auto">
  <name>Task 2: Add in-memory rate limiter and fix server edge cases</name>
  <files>
    services/gateway-api/src/server.ts
    services/gateway-api/src/index.ts
    test/integration/voice-turn.test.ts
  </files>
  <action>
**server.ts** -- Add three fixes:

1. **Rate limiter**: Add a simple in-memory sliding-window rate limiter at the top of the file. Use IP-based keying from `req.socket.remoteAddress`. Implementation:
```ts
class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly maxPerMinute: number;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  check(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    window.count++;
    return window.count <= this.maxPerMinute;
  }
}
```

Instantiate it in `createGatewayServer` using `deps.config.server.rateLimitPerMinute`. Apply it ONLY to `POST /api/voice/turn` (the expensive endpoint). If `check()` returns false, return 429 with `{ error: "Too many requests. Please wait.", code: "RATE_LIMITED" }`.

2. **Safe readBody double-reject**: In the `readBody` function, add a `let rejected = false;` guard. Set it to true before calling `reject()` in the `data` handler (oversized payload). In the `error` handler, check `if (rejected) return;` before calling reject. This prevents the promise from being rejected twice when `req.destroy()` triggers an error event.

3. **Bounded graceful shutdown**: In `index.ts`, change the `shutdown` function to add a force-kill timeout:
```ts
const shutdown = (): void => {
  log.info("Shutting down");
  openclawClient.disconnect();
  server.close(() => {
    log.info("Server closed");
    process.exit(0);
  });
  // Force exit after 10 seconds if connections hang
  setTimeout(() => {
    log.warn("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
};
```

**test/integration/voice-turn.test.ts** -- Add one rate limiting test:
```ts
it("returns 429 when rate limit exceeded", async () => {
  // Set up server with rateLimitPerMinute: 2
  const config = makeConfig({
    server: { ...makeConfig().server, rateLimitPerMinute: 2 },
  });
  // ... (setup server as in other tests)
  // Send 3 requests to /api/voice/turn -- third should get 429
  // Use text/plain to trigger 400 but that's fine -- rate limiter runs first
  // Actually: send with audio/wav content-type, mock STT, but just check the status
  // Simplest: send 3 POST requests with audio/wav, the first 2 get through (400 because no provider, that's fine), the 3rd gets 429
});
```

Actually, the rate limiter should run before route handling, so even a request that would 400 should still count. Send 3 POSTs with `Content-Type: audio/wav` to `/api/voice/turn`. With `rateLimitPerMinute: 2`, requests 1-2 pass through (may fail with provider error, that's fine), request 3 gets 429. Assert `response3.status === 429`.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run test/integration/voice-turn.test.ts --reporter=verbose 2>&1 | tail -30</automated>
    <manual>Verify rate limiter class exists in server.ts, readBody has double-reject guard, index.ts has shutdown timeout</manual>
  </verify>
  <done>
    - Rate limiter rejects 3rd request in a minute when limit is 2 with HTTP 429
    - readBody cannot double-reject (guard variable prevents it)
    - Shutdown has 10-second force-exit timeout with `.unref()` so it doesn't keep process alive
    - All existing integration tests still pass
    - `npm test` passes all 124+ tests
  </done>
</task>

<task type="auto">
  <name>Task 3: Final validation -- full test suite and typecheck</name>
  <files></files>
  <action>
Run the full test suite and TypeScript type checking to confirm no regressions. This is a validation-only task -- no code changes.

1. Run `npm test` -- all tests must pass
2. Run `npx tsc --noEmit` -- no type errors
3. If any failures, fix them in the affected files from Tasks 1-2

This task exists to catch any cross-package type breakage from the changes in Tasks 1-2.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npm test 2>&1 | tail -5 && npx tsc --noEmit 2>&1; echo "Exit: $?"</automated>
  </verify>
  <done>
    - `npm test` shows all tests passing (124+ tests, 0 failures)
    - `npx tsc --noEmit` exits with code 0
    - No regressions from the hardening changes
  </done>
</task>

</tasks>

<verification>
Run full test suite: `npm test` -- expect 126+ tests passing (124 existing + 2-3 new).
Run type check: `npx tsc --noEmit` -- expect clean exit.
Manual spot check: `grep -r "throw new Error" services/` should return zero hits (all errors should be typed).
Manual spot check: `grep -c "parseInt" services/gateway-api/src/config-loader.ts` should show parseInt only inside the safe helper, not called raw.
</verification>

<success_criteria>
1. No bare `parseInt` calls remain in config-loader -- all go through NaN-safe helper
2. No bare `throw new Error` in orchestrator or server -- all use GatewayError subclasses
3. Rate limiter exists and is tested (429 on exceeded limit)
4. readBody has double-reject protection
5. Graceful shutdown has bounded timeout
6. All tests pass, TypeScript compiles clean
</success_criteria>

<output>
After completion, create `.planning/quick/1-continue-execution-from-overnight-todo-m/1-SUMMARY.md`
</output>
