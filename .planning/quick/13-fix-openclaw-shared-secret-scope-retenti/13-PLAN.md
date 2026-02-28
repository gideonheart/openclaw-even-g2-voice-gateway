---
phase: quick-13
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - /home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts
  - /home/forge/openclaw/src/gateway/server.auth.e2e.test.ts
autonomous: true
requirements: [QUICK-13]

must_haves:
  truths:
    - "Shared-secret-authenticated backend connections without device identity retain their requested scopes"
    - "chat.send succeeds for a shared-secret-authenticated connection requesting operator.admin or operator.write"
    - "Unauthenticated connections without device identity still get scopes stripped (security preserved)"
  artifacts:
    - path: "/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts"
      provides: "Fixed scope retention for sharedAuthOk connections"
      contains: "!sharedAuthOk"
    - path: "/home/forge/openclaw/src/gateway/server.auth.e2e.test.ts"
      provides: "E2E tests confirming shared-secret scope retention and no-auth scope stripping"
      contains: "retains requested scopes"
  key_links:
    - from: "message-handler.ts line 422"
      to: "sharedAuthOk (line 390)"
      via: "conditional scope retention"
      pattern: "sharedAuthOk"
---

<objective>
Fix OpenClaw server to retain scopes for shared-secret-authenticated WebSocket connections that lack device identity.

Purpose: The voice gateway connects to OpenClaw via shared secret (token auth) without device identity. OpenClaw unconditionally strips all scopes for non-device connections (message-handler.ts lines 421-425), causing chat.send to fail with "missing scope: operator.write". After this fix, shared-secret-authenticated backend clients will retain their requested scopes, unblocking the full voice turn pipeline.

Output: Patched message-handler.ts + updated/new e2e tests in the /home/forge/openclaw repo.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/home/forge/openclaw-even-g2-voice-gateway/.planning/STATE.md
@/home/forge/openclaw-even-g2-voice-gateway/.planning/debug/openclaw-scope-operator-write.md
@/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts
@/home/forge/openclaw/src/gateway/server.auth.e2e.test.ts
@/home/forge/openclaw/src/gateway/method-scopes.ts
@/home/forge/openclaw/src/gateway/test-helpers.server.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix scope retention for shared-secret-authenticated connections</name>
  <files>/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts</files>
  <action>
In message-handler.ts, modify the scope-stripping condition at line 422.

Current code (lines 421-425):
```typescript
if (!device) {
  if (scopes.length > 0 && !allowControlUiBypass) {
    scopes = [];
    connectParams.scopes = scopes;
  }
```

Change line 422 to also exempt `sharedAuthOk` connections:
```typescript
if (!device) {
  if (scopes.length > 0 && !allowControlUiBypass && !sharedAuthOk) {
    scopes = [];
    connectParams.scopes = scopes;
  }
```

This is safe because:
- `sharedAuthOk` (line 390-392) is only true when the connection successfully authenticated via shared secret (token or password) — the server already verified the credential.
- The existing `canSkipDevice = sharedAuthOk` check at line 426 already trusts shared-secret connections to proceed without device identity. It is inconsistent to trust them to skip device but strip their scopes.
- Unauthenticated connections (sharedAuthOk=false) still get scopes stripped — no security regression.

Also update the comment at lines 305-307 to reflect the new behavior:
```typescript
// Default-deny: scopes must be explicit. Empty/missing scopes means no permissions.
// Note: If the client does not present a device identity and is NOT authenticated via
// shared secret, we clear scopes after auth to avoid self-declared permissions.
```
  </action>
  <verify>
    <automated>cd /home/forge/openclaw && npx tsc --noEmit --project tsconfig.json 2>&1 | tail -5</automated>
    <manual>Verify the one-line change compiles without type errors</manual>
  </verify>
  <done>message-handler.ts line 422 includes `&& !sharedAuthOk`, TypeScript compiles cleanly</done>
</task>

<task type="auto">
  <name>Task 2: Update e2e tests for shared-secret scope retention</name>
  <files>/home/forge/openclaw/src/gateway/server.auth.e2e.test.ts</files>
  <action>
In server.auth.e2e.test.ts, update the existing test at line 362 and add a new companion test. The existing test "ignores requested scopes when device identity is omitted" currently passes `{ device: null }` which STILL includes the default shared secret token (from `connectReq` defaults). After the fix, this connection WILL retain scopes because it authenticates via token.

Find the existing test block (around line 362):
```typescript
test("ignores requested scopes when device identity is omitted", async () => {
  await expectMissingScopeAfterConnect(port, { device: null });
});
```

Replace it with TWO tests:

1. **Rename/rewrite the existing test** to verify that shared-secret-authenticated connections WITHOUT device identity DO retain scopes:
```typescript
test("retains requested scopes for shared-secret-authenticated connections without device identity", async () => {
  const ws = await openWs(port);
  try {
    const res = await connectReq(ws, { device: null, scopes: ["operator.admin"] });
    expect(res.ok).toBe(true);
    // health requires operator.read; operator.admin grants all scopes
    const health = await rpcReq(ws, "health");
    expect(health.ok).toBe(true);
  } finally {
    ws.close();
  }
});
```

2. **Add a new test** to verify that unauthenticated connections without device identity still get scopes stripped (preserve the security invariant):
```typescript
test("strips scopes for unauthenticated connections without device identity", async () => {
  await expectMissingScopeAfterConnect(port, { device: null, skipDefaultAuth: true, token: undefined });
});
```

NOTE: Check whether `expectMissingScopeAfterConnect` with `skipDefaultAuth: true` causes a connection rejection rather than scope stripping. If the server rejects unauthenticated connections entirely (which is the default for token-auth mode), then the second test should instead verify the connection is rejected:
```typescript
test("rejects unauthenticated connections without device identity", async () => {
  const ws = await openWs(port);
  try {
    const res = await connectReq(ws, { device: null, skipDefaultAuth: true });
    expect(res.ok).toBe(false);
  } finally {
    ws.close();
  }
});
```

Look at how the test server is configured (the `describe` block around line 362 — check the `beforeAll` for what auth mode and token are set). Adapt the second test accordingly.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw && npx vitest run src/gateway/server.auth.e2e.test.ts --config vitest.e2e.config.ts 2>&1 | tail -20</automated>
    <manual>All auth e2e tests pass, including both the new scope-retention test and the scope-stripping/rejection test</manual>
  </verify>
  <done>E2E auth tests pass: shared-secret connections without device retain scopes, unauthenticated connections without device do not</done>
</task>

<task type="auto">
  <name>Task 3: Run focused gateway tests and commit with evidence</name>
  <files>/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts, /home/forge/openclaw/src/gateway/server.auth.e2e.test.ts</files>
  <action>
Run the broader gateway test suites to confirm no regressions:

1. Run gateway unit tests:
   ```bash
   cd /home/forge/openclaw && npx vitest run --config vitest.gateway.config.ts 2>&1 | tail -30
   ```

2. Run the method-scopes unit tests specifically (should be unchanged, just confirming):
   ```bash
   cd /home/forge/openclaw && npx vitest run src/gateway/method-scopes.test.ts 2>&1 | tail -10
   ```

3. Run ALL gateway e2e tests (not just auth):
   ```bash
   cd /home/forge/openclaw && npx vitest run --config vitest.e2e.config.ts 2>&1 | tail -30
   ```

4. If all tests pass, commit the changes in the /home/forge/openclaw repo:
   ```bash
   cd /home/forge/openclaw && git add src/gateway/server/ws-connection/message-handler.ts src/gateway/server.auth.e2e.test.ts && git commit -m "fix(gateway): retain scopes for shared-secret-authenticated connections without device identity

   Backend clients authenticating via shared secret (token/password) but
   without device identity were having all scopes stripped unconditionally
   (message-handler.ts lines 421-425). This caused chat.send to fail with
   'missing scope: operator.write' for clients like the voice gateway.

   The scope-stripping guard now exempts sharedAuthOk connections, matching
   the existing trust model where canSkipDevice = sharedAuthOk.

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
   ```

5. Report: list files changed, test counts (pass/fail), and the commit hash.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw && git log --oneline -1 && git diff HEAD~1 --stat</automated>
    <manual>Commit exists with the fix, gateway tests pass, e2e tests pass</manual>
  </verify>
  <done>Fix committed in /home/forge/openclaw with passing gateway unit tests + e2e tests, concrete evidence reported (commit hash, files changed, test counts)</done>
</task>

</tasks>

<verification>
1. TypeScript compiles: `cd /home/forge/openclaw && npx tsc --noEmit` passes
2. Gateway unit tests: `npx vitest run --config vitest.gateway.config.ts` passes
3. Gateway e2e tests: `npx vitest run --config vitest.e2e.config.ts` passes
4. Specific auth test: the new "retains requested scopes for shared-secret-authenticated connections without device identity" test passes
5. Security invariant: unauthenticated/non-shared-secret connections without device still have scopes stripped or connection rejected
</verification>

<success_criteria>
- message-handler.ts patched: line 422 includes `&& !sharedAuthOk`
- E2E test confirms shared-secret + no-device retains scopes (health call succeeds)
- E2E test confirms security invariant preserved for non-authenticated connections
- All gateway tests (unit + e2e) pass with 0 failures
- Changes committed in /home/forge/openclaw with descriptive commit message
</success_criteria>

<output>
After completion, create `.planning/quick/13-fix-openclaw-shared-secret-scope-retenti/13-SUMMARY.md`
</output>
