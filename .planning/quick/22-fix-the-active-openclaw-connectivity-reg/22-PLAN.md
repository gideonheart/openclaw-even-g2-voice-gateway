---
phase: quick-22
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - services/gateway-api/src/config-loader.ts
  - services/gateway-api/src/config-loader.test.ts
  - .env.example
autonomous: true
requirements: [CONN-FIX-01]

must_haves:
  truths:
    - "loadConfig() produces ws://127.0.0.1:3434 when OPENCLAW_GATEWAY_PORT=3434 is in process.env and OPENCLAW_GATEWAY_URL is unset"
    - "loadConfig() still honors explicit OPENCLAW_GATEWAY_URL if set, ignoring OPENCLAW_GATEWAY_PORT"
    - "loadConfig() warns clearly in defaults about the stale-shell-token hazard"
    - "Gateway startup connects to the real OpenClaw on port 3434, not port 3000"
    - "Tests prevent regression: default URL derivation, explicit URL override, port fallback"
  artifacts:
    - path: "services/gateway-api/src/config-loader.ts"
      provides: "Smart default for openclawGatewayUrl using OPENCLAW_GATEWAY_PORT"
      contains: "OPENCLAW_GATEWAY_PORT"
    - path: "services/gateway-api/src/config-loader.test.ts"
      provides: "Tests covering URL fallback chain and stale-token scenarios"
      contains: "OPENCLAW_GATEWAY_PORT"
    - path: ".env.example"
      provides: "Updated documentation about env precedence and shell override hazard"
      contains: "OPENCLAW_GATEWAY_PORT"
  key_links:
    - from: "services/gateway-api/src/config-loader.ts"
      to: "process.env.OPENCLAW_GATEWAY_PORT"
      via: "default URL derivation"
      pattern: "OPENCLAW_GATEWAY_PORT"
---

<objective>
Fix the OpenClaw connectivity regression: the gateway connects to ws://localhost:3000 (wrong -- an unrelated process) instead of ws://127.0.0.1:3434 (the real OpenClaw gateway).

Purpose: The root cause is a two-layer problem:
1. `loadConfig()` hardcodes default `ws://localhost:3000` but the actual OpenClaw gateway runs on port 3434 (set by systemd via `OPENCLAW_GATEWAY_PORT=3434`).
2. The shell env exports a stale `OPENCLAW_GATEWAY_TOKEN` that overrides the correct .env value.

The fix makes `loadConfig()` derive a smart default from `OPENCLAW_GATEWAY_PORT` when `OPENCLAW_GATEWAY_URL` is unset, updates .env.example with shell-override warnings, and adds regression tests.

Output: Patched config-loader.ts, expanded tests, updated .env.example, verified connectivity.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@services/gateway-api/src/config-loader.ts
@services/gateway-api/src/config-loader.test.ts
@.env.example
@.env
</context>

<tasks>

<task type="auto">
  <name>Task 1: Patch config-loader.ts to derive smart default URL from OPENCLAW_GATEWAY_PORT</name>
  <files>services/gateway-api/src/config-loader.ts, .env.example</files>
  <action>
In `services/gateway-api/src/config-loader.ts`, modify the `openclawGatewayUrl` default derivation:

**Current (broken):**
```ts
openclawGatewayUrl: strOrDefault(env["OPENCLAW_GATEWAY_URL"], "ws://localhost:3000"),
```

**New (smart fallback chain):**
1. If `OPENCLAW_GATEWAY_URL` is set and non-empty, use it (existing behavior, unchanged).
2. Else if `OPENCLAW_GATEWAY_PORT` is set and non-empty, derive `ws://127.0.0.1:${OPENCLAW_GATEWAY_PORT}`.
3. Else fall back to `ws://localhost:3000` (last resort, matches .env.example).

Implementation: Add a small helper or inline logic BEFORE the return statement:

```ts
function resolveOpenClawUrl(env: Record<string, string | undefined>): string {
  const explicit = env["OPENCLAW_GATEWAY_URL"];
  if (explicit !== undefined && explicit !== "") return explicit;
  const port = env["OPENCLAW_GATEWAY_PORT"];
  if (port !== undefined && port !== "") return `ws://127.0.0.1:${port}`;
  return "ws://localhost:3000";
}
```

Then use: `openclawGatewayUrl: resolveOpenClawUrl(env),`

Also update `.env.example`:
- Add a comment block above `OPENCLAW_GATEWAY_URL` explaining the fallback chain:
  - Explicit `OPENCLAW_GATEWAY_URL` wins
  - Then `OPENCLAW_GATEWAY_PORT` (set by OpenClaw systemd) derives ws://127.0.0.1:{port}
  - Last resort: ws://localhost:3000
- Add a WARNING comment about shell env overriding .env file values (the stale-token hazard): "If your shell exports OPENCLAW_GATEWAY_TOKEN, it will override the .env value. Run `unset OPENCLAW_GATEWAY_TOKEN` before starting, or use explicit env override."
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run services/gateway-api/src/config-loader.test.ts 2>&1 | tail -5</automated>
    <manual>Inspect config-loader.ts for the resolveOpenClawUrl helper and verify .env.example has warning comments</manual>
  </verify>
  <done>loadConfig({}) still returns ws://localhost:3000 (no env at all); loadConfig({ OPENCLAW_GATEWAY_PORT: "3434" }) returns ws://127.0.0.1:3434; loadConfig({ OPENCLAW_GATEWAY_URL: "ws://custom:9999" }) returns ws://custom:9999 regardless of OPENCLAW_GATEWAY_PORT. .env.example documents the fallback chain and shell override hazard.</done>
</task>

<task type="auto">
  <name>Task 2: Add regression tests for URL derivation and verify live connectivity</name>
  <files>services/gateway-api/src/config-loader.test.ts</files>
  <action>
Add the following test cases to `services/gateway-api/src/config-loader.test.ts` inside the existing `describe("loadConfig", ...)`:

1. **"derives URL from OPENCLAW_GATEWAY_PORT when OPENCLAW_GATEWAY_URL is unset":**
   - `loadConfig({ OPENCLAW_GATEWAY_PORT: "3434" })` => `openclawGatewayUrl === "ws://127.0.0.1:3434"`

2. **"explicit OPENCLAW_GATEWAY_URL takes precedence over OPENCLAW_GATEWAY_PORT":**
   - `loadConfig({ OPENCLAW_GATEWAY_URL: "ws://custom:5000", OPENCLAW_GATEWAY_PORT: "3434" })` => `openclawGatewayUrl === "ws://custom:5000"`

3. **"falls back to ws://localhost:3000 when neither URL nor PORT set":**
   - `loadConfig({})` => `openclawGatewayUrl === "ws://localhost:3000"` (already covered by existing test, but make it explicit with a descriptive name)

4. **"empty OPENCLAW_GATEWAY_URL falls through to PORT-based derivation":**
   - `loadConfig({ OPENCLAW_GATEWAY_URL: "", OPENCLAW_GATEWAY_PORT: "3434" })` => `openclawGatewayUrl === "ws://127.0.0.1:3434"`

5. **"stale shell token does not affect config when token is explicitly provided":**
   - `loadConfig({ OPENCLAW_GATEWAY_TOKEN: "correct-token" })` => `openclawGatewayToken === "correct-token"`
   (This test documents the hazard -- the real fix for stale shell tokens is operational, but the test makes the expected behavior explicit.)

After writing tests, run the full test suite to ensure nothing is broken.

Then verify live connectivity by running:
```bash
node -e "
  const net = require('net');
  const s = new net.Socket();
  s.connect(3434, '127.0.0.1', () => { console.log('OpenClaw port 3434: REACHABLE'); s.destroy(); });
  s.on('error', (e) => { console.log('OpenClaw port 3434: UNREACHABLE -', e.message); s.destroy(); });
  setTimeout(() => { console.log('TIMEOUT'); s.destroy(); process.exit(1); }, 3000);
"
```

And run `openclaw status` if available to confirm the gateway service is healthy.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run services/gateway-api/src/config-loader.test.ts 2>&1 | tail -20</automated>
    <manual>Verify all new tests pass, especially the OPENCLAW_GATEWAY_PORT derivation tests. Verify OpenClaw port 3434 is reachable.</manual>
  </verify>
  <done>All config-loader tests pass (original 12 + 4 new = 16+). Live connectivity to OpenClaw on port 3434 confirmed. The default URL derivation is now safe for this environment: when the gateway starts with the systemd-injected OPENCLAW_GATEWAY_PORT=3434, it will connect to ws://127.0.0.1:3434 even if .env is not loaded.</done>
</task>

</tasks>

<verification>
1. `npx vitest run services/gateway-api/src/config-loader.test.ts` -- all tests pass including new PORT-derivation tests
2. `npx vitest run` -- full suite still passes (210+ tests)
3. `node -e "..."` TCP check confirms port 3434 reachable
4. `loadConfig()` called with current process.env (which has OPENCLAW_GATEWAY_PORT=3434) produces ws://127.0.0.1:3434, not ws://localhost:3000
</verification>

<success_criteria>
- config-loader.ts resolves OPENCLAW_GATEWAY_URL via the 3-step fallback: explicit URL > derived from PORT > hardcoded default
- All existing tests still pass unchanged
- 4+ new tests lock down the URL derivation logic
- .env.example documents the fallback chain and shell-override warning
- Live OpenClaw connectivity on port 3434 verified
- Full test suite green (210+ tests)
</success_criteria>

<output>
After completion, create `.planning/quick/22-fix-the-active-openclaw-connectivity-reg/22-SUMMARY.md`
</output>
