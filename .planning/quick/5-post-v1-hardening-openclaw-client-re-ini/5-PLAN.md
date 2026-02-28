---
phase: quick-5
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - services/gateway-api/src/server.ts
  - services/gateway-api/src/index.ts
  - services/gateway-api/src/openclaw-rebuilder.ts
  - services/gateway-api/src/openclaw-rebuilder.test.ts
  - docs/runbook.md
autonomous: true
requirements: [CLAW-01, CLAW-02, CONF-03, PIPE-07]

must_haves:
  truths:
    - "Changing openclawGatewayUrl via POST /api/settings causes the OpenClaw client to reconnect with the new URL on the next voice turn"
    - "Changing openclawGatewayToken via POST /api/settings causes the OpenClaw client to use the new token on next connection"
    - "Pending turns on the old OpenClaw connection are rejected gracefully (not silently dropped)"
    - "Runbook accurately describes that STT provider config changes AND OpenClaw config changes take effect at runtime without restart"
  artifacts:
    - path: "services/gateway-api/src/openclaw-rebuilder.ts"
      provides: "OpenClaw client rebuild on config change"
      min_lines: 20
    - path: "services/gateway-api/src/openclaw-rebuilder.test.ts"
      provides: "Tests for OpenClaw rebuilder"
      min_lines: 40
  key_links:
    - from: "services/gateway-api/src/openclaw-rebuilder.ts"
      to: "services/gateway-api/src/config-store.ts"
      via: "configStore.onChange() listener"
      pattern: "configStore\\.onChange"
    - from: "services/gateway-api/src/index.ts"
      to: "services/gateway-api/src/openclaw-rebuilder.ts"
      via: "registerOpenClawRebuilder() call"
      pattern: "registerOpenClawRebuilder"
    - from: "services/gateway-api/src/server.ts"
      to: "ServerDeps.openclawClient"
      via: "mutable openclawClient property"
      pattern: "openclawClient"
---

<objective>
Implement OpenClaw client runtime re-initialization on config change and fix the stale runbook restart note.

Purpose: Close the config drift gap where changing openclawGatewayUrl or openclawGatewayToken via POST /api/settings silently has no effect until restart. Also correct the runbook which still claims provider-specific config changes require a restart.

Output: New openclaw-rebuilder.ts with tests, updated index.ts wiring, updated ServerDeps to allow mutable openclawClient, corrected runbook.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@services/gateway-api/src/index.ts
@services/gateway-api/src/server.ts
@services/gateway-api/src/provider-rebuilder.ts
@services/gateway-api/src/provider-rebuilder.test.ts
@services/gateway-api/src/config-store.ts
@services/gateway-api/src/orchestrator.ts
@packages/openclaw-client/src/openclaw-client.ts
@docs/runbook.md
@RELEASE_HANDOFF.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement OpenClaw client rebuilder and wire it up</name>
  <files>
    services/gateway-api/src/openclaw-rebuilder.ts
    services/gateway-api/src/server.ts
    services/gateway-api/src/index.ts
  </files>
  <action>
    1. Create `services/gateway-api/src/openclaw-rebuilder.ts` following the exact pattern of `provider-rebuilder.ts`:
       - Export a `registerOpenClawRebuilder(configStore, deps, logger)` function
       - Register a `configStore.onChange()` listener that checks if `patch.openclawGatewayUrl !== undefined || patch.openclawGatewayToken !== undefined`
       - When triggered: (a) call `deps.openclawClient.disconnect()` on the old client (this rejects pending turns via the existing disconnect() logic in OpenClawClient), (b) create a new `OpenClawClient` with `{ gatewayUrl: newConfig.openclawGatewayUrl, authToken: newConfig.openclawGatewayToken }` and the logger, (c) assign `deps.openclawClient = newClient` (mutating the deps object so all handlers see the new client on next request), (d) log the rebuild
       - Do NOT eagerly call `connect()` on the new client -- the existing `sendTranscript()` method already handles lazy connection ("Not connected, attempting to connect" path at line 125-128 of openclaw-client.ts)
       - Import OpenClawClient from `@voice-gateway/openclaw-client`
       - Import types: ConfigStore, ValidatedSettingsPatch from `./config-store.js`, Logger from `@voice-gateway/logging`, GatewayConfig from `@voice-gateway/shared-types`

    2. Update `services/gateway-api/src/server.ts` ServerDeps interface:
       - Change `readonly openclawClient: OpenClawClient` to `openclawClient: OpenClawClient` (remove readonly) so the rebuilder can swap the reference
       - All other fields remain readonly -- only openclawClient needs to be mutable

    3. Update `services/gateway-api/src/index.ts`:
       - Add import: `import { registerOpenClawRebuilder } from "./openclaw-rebuilder.js"`
       - After the `registerProviderRebuilder(configStore, sttProviders, rootLogger)` call (line 41), add: `registerOpenClawRebuilder(configStore, deps, rootLogger)`
       - IMPORTANT: The `registerOpenClawRebuilder` call must come AFTER `deps` is defined (after line 59), so move it there -- after `const deps: ServerDeps = { ... }` and before `const server = createGatewayServer(deps)`
       - Also move `registerProviderRebuilder` to the same location for consistency (after deps is created, before server is created), since it does not depend on deps but grouping the two rebuilder registrations together is cleaner
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npm run typecheck</automated>
    <manual>Verify openclaw-rebuilder.ts exists and follows the provider-rebuilder.ts pattern</manual>
  </verify>
  <done>
    - openclaw-rebuilder.ts exists with registerOpenClawRebuilder function
    - ServerDeps.openclawClient is mutable (no readonly)
    - index.ts calls registerOpenClawRebuilder after deps is created
    - TypeScript compiles without errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Add tests for OpenClaw rebuilder and fix runbook</name>
  <files>
    services/gateway-api/src/openclaw-rebuilder.test.ts
    docs/runbook.md
  </files>
  <action>
    1. Create `services/gateway-api/src/openclaw-rebuilder.test.ts` following the exact testing pattern of `provider-rebuilder.test.ts`:
       - Mock `@voice-gateway/openclaw-client` with `vi.mock()` -- the mock OpenClawClient constructor should return an object with `disconnect: vi.fn()` and any other needed stubs
       - Reuse the same `makeTestConfig()` fixture pattern from provider-rebuilder.test.ts
       - Create a mock deps object with a `openclawClient` property that has a `disconnect` spy
       - Tests to write (6 tests mirroring provider-rebuilder's structure):
         a. "rebuilds OpenClaw client when openclawGatewayUrl changes" -- update with `{ openclawGatewayUrl: "ws://new-url:3000" }`, assert old client's disconnect() was called, assert deps.openclawClient is the new mock instance, assert OpenClawClient constructor was called with the new URL
         b. "rebuilds OpenClaw client when openclawGatewayToken changes" -- update with `{ openclawGatewayToken: "new-token" }`, assert disconnect and rebuild
         c. "rebuilds OpenClaw client when both URL and token change" -- update with both fields, assert only ONE rebuild (not two), assert disconnect called once
         d. "does not rebuild when unrelated config changes" -- update with `{ sttProvider: createProviderId("openai") }`, assert OpenClawClient constructor NOT called, assert disconnect NOT called, assert deps.openclawClient is still the original
         e. "does not rebuild when only STT provider config changes" -- update with `{ whisperx: { baseUrl: "http://new" } }`, assert no rebuild
         f. "passes correct config to new OpenClawClient constructor" -- update URL, verify constructor received `{ gatewayUrl: "ws://new-url", authToken: "secret-token-123" }` (the merged config values)

    2. Update `docs/runbook.md` line 161:
       - Replace: `**Note:** Changing provider-specific config (URLs, API keys) currently requires a restart. Provider *selection* (which provider is active) works immediately.`
       - With: `**Note:** All config changes via the settings API take effect immediately without restart. STT provider config (URLs, API keys, model names) triggers provider re-initialization, and OpenClaw connection config (URL, auth token) triggers client reconnection. The next request after a config change will use the updated settings.`
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npm test</automated>
    <manual>Check that runbook line 161 no longer mentions "requires a restart"</manual>
  </verify>
  <done>
    - openclaw-rebuilder.test.ts has 6 passing tests covering rebuild triggers, no-op cases, and correct config passing
    - All existing tests still pass (provider-rebuilder, config-store, orchestrator, config-loader)
    - docs/runbook.md accurately states that all config changes take effect at runtime
    - Full test suite passes with `npm test`
  </done>
</task>

</tasks>

<verification>
1. `npm run typecheck` passes -- no type errors from ServerDeps change or new file
2. `npm test` passes -- all existing tests plus new openclaw-rebuilder tests
3. `grep -n "requires a restart" docs/runbook.md` returns no matches
4. `grep -n "registerOpenClawRebuilder" services/gateway-api/src/index.ts` confirms wiring
</verification>

<success_criteria>
- OpenClaw client is rebuilt when openclawGatewayUrl or openclawGatewayToken changes via POST /api/settings
- Old client is properly disconnected (pending turns rejected) before new client replaces it
- 6 new tests passing in openclaw-rebuilder.test.ts
- Runbook no longer contains stale "requires a restart" note
- Full test suite green: `npm test` exits 0
</success_criteria>

<output>
After completion, create `.planning/quick/5-post-v1-hardening-openclaw-client-re-ini/5-SUMMARY.md`
</output>
