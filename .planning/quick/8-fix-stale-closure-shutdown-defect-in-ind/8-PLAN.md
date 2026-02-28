---
phase: quick-8
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - services/gateway-api/src/index.ts
  - services/gateway-api/src/server.test.ts
autonomous: true
requirements: [OPS-01]
must_haves:
  truths:
    - "Graceful shutdown disconnects the CURRENT OpenClaw client, not the original one"
    - "After hot-reload replaces the OpenClaw client, SIGTERM disconnects the replacement"
    - "All 177+ existing tests continue to pass"
  artifacts:
    - path: "services/gateway-api/src/index.ts"
      provides: "Shutdown handler using deps.openclawClient instead of stale closure"
      contains: "deps.openclawClient.disconnect()"
  key_links:
    - from: "services/gateway-api/src/index.ts shutdown handler"
      to: "deps.openclawClient"
      via: "property access on deps object (not closed-over local variable)"
      pattern: "deps\\.openclawClient\\.disconnect"
---

<objective>
Fix the stale closure shutdown defect in services/gateway-api/src/index.ts.

Purpose: The `shutdown` handler on line 100-113 closes over the local `openclawClient` variable
captured at startup. After a config hot-reload, `registerOpenClawRebuilder` swaps
`deps.openclawClient` to a new instance, but the shutdown handler still calls `.disconnect()`
on the original (now stale, already-disconnected) client. This means the active client leaks
without a clean disconnect on SIGTERM/SIGINT.

Output: Corrected index.ts where shutdown reads from `deps.openclawClient` (the live reference)
instead of the closed-over local variable.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@services/gateway-api/src/index.ts
@services/gateway-api/src/openclaw-rebuilder.ts
@services/gateway-api/src/server.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix stale closure in shutdown handler</name>
  <files>services/gateway-api/src/index.ts</files>
  <action>
In the `shutdown` function (line ~100-113 of index.ts), change line 103 from:

    openclawClient.disconnect();

to:

    deps.openclawClient.disconnect();

This is the only change needed. The `deps` object is already in scope (defined on line 51)
and is the same object passed to `registerOpenClawRebuilder` which mutates
`deps.openclawClient` on hot-reload. By reading from `deps` at shutdown time instead of the
closed-over local `openclawClient`, the handler always disconnects whichever client is
currently active.

Do NOT change any other code. The local `openclawClient` variable is still used correctly
for the startup health check (line 74-78) -- that runs once before any hot-reload can occur,
so there is no stale closure risk there.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && grep -n "deps\.openclawClient\.disconnect" services/gateway-api/src/index.ts && ! grep -n "^[[:space:]]*openclawClient\.disconnect" services/gateway-api/src/index.ts</automated>
    <manual>Confirm the shutdown handler references deps.openclawClient, not the local variable</manual>
  </verify>
  <done>The shutdown handler calls deps.openclawClient.disconnect() so it always disconnects the current (possibly hot-reloaded) client instance.</done>
</task>

<task type="auto">
  <name>Task 2: Run full test suite and verify no regressions</name>
  <files>services/gateway-api/src/server.test.ts</files>
  <action>
Run the full Vitest suite (`npx vitest --run`) and confirm all 177+ tests pass with zero
failures. The change in Task 1 is a one-line fix that does not alter any public API or
behavior observable by existing tests, so this is a regression check only.

If any test fails, diagnose and fix. No new tests are needed for this specific fix because:
1. The index.ts `main()` function is the process entry point and is not unit-tested directly
   (it calls process.exit, binds signals, etc.)
2. The openclaw-rebuilder.test.ts already verifies that deps.openclawClient is swapped
   correctly on hot-reload
3. The defect was in the gap between those two units (shutdown reading stale local vs deps)

If the runner reports exactly 177 tests passing, the task is done.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest --run 2>&1 | tail -5</automated>
  </verify>
  <done>All 177+ tests pass. Zero failures, zero skipped.</done>
</task>

</tasks>

<verification>
1. `grep "deps.openclawClient.disconnect" services/gateway-api/src/index.ts` returns a match
2. `grep "^\s*openclawClient.disconnect" services/gateway-api/src/index.ts` returns NO match (no bare local-variable disconnect calls)
3. Full test suite passes (177+ tests, 0 failures)
</verification>

<success_criteria>
- The shutdown handler in index.ts uses `deps.openclawClient.disconnect()` instead of the stale `openclawClient.disconnect()`
- All existing tests pass without modification
- The fix is committed and pushed to master
</success_criteria>

<output>
After completion, create `.planning/quick/8-fix-stale-closure-shutdown-defect-in-ind/8-SUMMARY.md`
</output>
