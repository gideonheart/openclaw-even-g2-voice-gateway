---
phase: quick-23
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - services/gateway-api/src/config-loader.ts
  - services/gateway-api/src/config-loader.test.ts
  - .planning/quick/23-self-review-quick-22-openclaw-url-fallba/23-SUMMARY.md
autonomous: true
requirements: [REVIEW-22]

must_haves:
  truths:
    - "resolveOpenClawUrl rejects non-numeric OPENCLAW_GATEWAY_PORT with an OperatorError instead of producing an invalid URL"
    - "resolveOpenClawUrl rejects out-of-range ports (0, negative, >65535) with an OperatorError"
    - "All existing quick-22 fallback behavior is preserved (no regressions)"
    - "A self-review summary documents what quick-22 did well, what risks remain, and what was hardened"
  artifacts:
    - path: "services/gateway-api/src/config-loader.ts"
      provides: "Port validation in resolveOpenClawUrl"
      contains: "OPENCLAW_GATEWAY_PORT"
    - path: "services/gateway-api/src/config-loader.test.ts"
      provides: "Tests for invalid PORT values"
      contains: "non-numeric OPENCLAW_GATEWAY_PORT"
  key_links:
    - from: "services/gateway-api/src/config-loader.ts"
      to: "resolveOpenClawUrl"
      via: "port validation before URL interpolation"
      pattern: "parseInt.*OPENCLAW_GATEWAY_PORT"
---

<objective>
Self-review the quick-22 OpenClaw URL fallback changes: assess what was done well, identify remaining risks, and fix the one concrete gap -- OPENCLAW_GATEWAY_PORT is interpolated into a URL without any validation (non-numeric or out-of-range values produce an invalid WebSocket URL that fails at connection time with an unhelpful error).

Purpose: Harden the config-loader so invalid PORT values fail fast with a clear OperatorError at config load time, not silently at WebSocket connection time.
Output: Patched config-loader.ts with port validation, new tests for invalid PORT edge cases, and a self-review summary.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/22-fix-the-active-openclaw-connectivity-reg/22-SUMMARY.md
@services/gateway-api/src/config-loader.ts
@services/gateway-api/src/config-loader.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add PORT validation to resolveOpenClawUrl and regression tests</name>
  <files>services/gateway-api/src/config-loader.ts, services/gateway-api/src/config-loader.test.ts</files>
  <action>
In `services/gateway-api/src/config-loader.ts`, modify `resolveOpenClawUrl()` to validate the port value before interpolation.

**Current (no validation):**
```ts
const port = env["OPENCLAW_GATEWAY_PORT"];
if (port !== undefined && port !== "") return `ws://127.0.0.1:${port}`;
```

**New (with validation):**
```ts
const port = env["OPENCLAW_GATEWAY_PORT"];
if (port !== undefined && port !== "") {
  const n = parseInt(port, 10);
  if (Number.isNaN(n) || n <= 0 || n > 65535) {
    throw new OperatorError(
      ErrorCodes.INVALID_CONFIG,
      "Invalid OPENCLAW_GATEWAY_PORT",
      `Expected a port number (1-65535), got "${port}"`,
    );
  }
  return `ws://127.0.0.1:${n}`;
}
```

Note: Use `n` (the parsed int) in the URL, not the raw string, to normalize values like "03434" to "3434".

Then add the following test cases to `services/gateway-api/src/config-loader.test.ts` after the existing quick-22 regression tests:

1. **"throws on non-numeric OPENCLAW_GATEWAY_PORT":**
   - `loadConfig({ OPENCLAW_GATEWAY_PORT: "abc" })` throws OperatorError with code INVALID_CONFIG

2. **"throws on zero OPENCLAW_GATEWAY_PORT":**
   - `loadConfig({ OPENCLAW_GATEWAY_PORT: "0" })` throws OperatorError

3. **"throws on negative OPENCLAW_GATEWAY_PORT":**
   - `loadConfig({ OPENCLAW_GATEWAY_PORT: "-1" })` throws OperatorError

4. **"throws on out-of-range OPENCLAW_GATEWAY_PORT":**
   - `loadConfig({ OPENCLAW_GATEWAY_PORT: "99999" })` throws OperatorError

5. **"normalizes leading-zero OPENCLAW_GATEWAY_PORT":**
   - `loadConfig({ OPENCLAW_GATEWAY_PORT: "03434" })` returns `ws://127.0.0.1:3434` (parseInt strips the leading zero)

After writing the code and tests, run `bun test` to verify all 215+ existing tests still pass plus the new ones.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && bun test 2>&1 | tail -10</automated>
    <manual>Verify resolveOpenClawUrl now validates PORT before interpolation and all new edge-case tests pass</manual>
  </verify>
  <done>resolveOpenClawUrl rejects non-numeric, zero, negative, and >65535 PORT values with OperatorError INVALID_CONFIG. Normalizes leading zeros via parseInt. All existing tests pass unchanged. 5 new tests cover PORT validation edge cases. Total test count: 220+.</done>
</task>

<task type="auto">
  <name>Task 2: Write self-review summary documenting findings and hardening</name>
  <files>.planning/quick/23-self-review-quick-22-openclaw-url-fallba/23-SUMMARY.md</files>
  <action>
Create the summary file documenting the self-review of quick-22. Structure it with these sections:

**What quick-22 did well:**
- Clean 3-step fallback chain (explicit URL > PORT-derived > hardcoded default) -- easy to understand, well-documented in code comments
- Good decision to use 127.0.0.1 instead of localhost in PORT-derived URLs -- avoids IPv4/IPv6 DNS ambiguity
- Empty string OPENCLAW_GATEWAY_URL treated as unset -- handles .env edge case gracefully
- 5 regression tests covering all fallback paths: PORT derivation, URL precedence, neither-set fallback, empty-URL fallthrough, explicit token
- .env.example updated with clear fallback chain docs and shell-override hazard warning
- Atomic commits (fix, then tests) with descriptive messages

**Risks identified (and their status):**
1. PORT validation gap (FIXED in this task): OPENCLAW_GATEWAY_PORT was interpolated without validation -- non-numeric or out-of-range values produced invalid URLs that failed at connection time with unhelpful errors. Now throws OperatorError at config load time.
2. localhost vs 127.0.0.1 inconsistency (ACCEPTED): Last-resort default is ws://localhost:3000, PORT-derived uses ws://127.0.0.1:{port}. Deliberate decision documented in quick-22 -- 127.0.0.1 avoids DNS ambiguity for the common case.
3. Stale shell token hazard (OPERATIONAL): The config-loader cannot detect or prevent shell env overriding .env file values -- this is a Bun/.env runtime behavior. Documented in .env.example with mitigation steps. No code fix possible.
4. PORT used as string for URL but not validated as integer (FIXED): parseInt + range check now ensures the derived URL is always valid.

**Hardening applied:**
- Added port validation (parseInt, range 1-65535) to resolveOpenClawUrl
- Added 5 new edge-case tests for invalid PORT values
- Used parsed integer in URL (normalizes "03434" to "3434")

Use the standard SUMMARY.md template format with frontmatter (phase, plan, subsystem, tags, requires, provides, affects, tech-stack, key-files, key-decisions, patterns-established, requirements-completed, duration, completed).
  </action>
  <verify>
    <automated>test -f /home/forge/openclaw-even-g2-voice-gateway/.planning/quick/23-self-review-quick-22-openclaw-url-fallba/23-SUMMARY.md && echo "SUMMARY exists"</automated>
    <manual>Read the summary and confirm it accurately documents the review findings, risks, and hardening applied</manual>
  </verify>
  <done>Self-review summary exists with: (1) assessment of what quick-22 did well, (2) risks identified with status (fixed/accepted/operational), (3) hardening applied in this task, (4) test evidence.</done>
</task>

</tasks>

<verification>
1. `bun test` -- full suite passes (220+ tests, up from 215)
2. `loadConfig({ OPENCLAW_GATEWAY_PORT: "abc" })` throws OperatorError (not a silent invalid URL)
3. `loadConfig({ OPENCLAW_GATEWAY_PORT: "3434" })` still returns `ws://127.0.0.1:3434` (existing behavior preserved)
4. All 5 original quick-22 regression tests still pass
5. Summary file documents review findings
</verification>

<success_criteria>
- resolveOpenClawUrl validates PORT: non-numeric, zero, negative, >65535 all throw OperatorError
- All existing 215 tests pass (zero regressions)
- 5+ new tests for PORT validation edge cases
- Self-review summary documents what was done well, risks identified, and hardening applied
- Full test suite green
</success_criteria>

<output>
After completion, the summary at `.planning/quick/23-self-review-quick-22-openclaw-url-fallba/23-SUMMARY.md` serves as the deliverable.
</output>
