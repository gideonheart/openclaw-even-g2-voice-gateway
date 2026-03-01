---
phase: quick-15
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - /home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts
  - /home/forge/openclaw/src/gateway/server.auth.e2e.test.ts
  - /home/forge/openclaw-even-g2-voice-gateway/packages/openclaw-client/src/openclaw-client.ts
autonomous: true
requirements: [QUICK-15]

must_haves:
  truths:
    - "The !sharedAuthOk guard cannot be true for connections that did not successfully authenticate via shared secret (no security regression)"
    - "All edge cases (password-auth, allowControlUiBypass interaction, empty scopes, tailscale mode) are covered by existing tests"
    - "The voice-gateway client sends the exact connect params that the fixed OpenClaw server expects (token auth, operator.admin scope, no device)"
    - "Any concrete code or test gaps found are fixed with passing tests"
  artifacts:
    - path: "/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts"
      provides: "Scope retention fix with !sharedAuthOk guard at line 422"
      contains: "!sharedAuthOk"
    - path: "/home/forge/openclaw/src/gateway/server.auth.e2e.test.ts"
      provides: "E2e tests for shared-secret scope retention + unauthenticated rejection"
      contains: "retains requested scopes"
  key_links:
    - from: "openclaw-client.ts sendConnectFrame"
      to: "message-handler.ts scope-stripping condition"
      via: "WebSocket connect frame with auth.token + scopes + no device"
      pattern: 'scopes.*operator.admin'
---

<objective>
Self-review the three commits that fix shared-secret scope retention (4d1fb3e9f, 801fa7fe8 in openclaw; 862148e in voice-gateway). Audit for security regressions, edge-case coverage, and client/server alignment. Fix any concrete gaps found with code + tests.

Purpose: The fix changes a security-relevant code path (scope-stripping for non-device connections). A thorough self-review ensures no privilege escalation is possible and that the voice-gateway client's connect params are compatible with the fixed server behavior.

Output: Review findings documented. Any code/test gaps fixed and committed. If no gaps found, explicit confirmation with evidence.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/home/forge/openclaw-even-g2-voice-gateway/.planning/STATE.md
@/home/forge/openclaw-even-g2-voice-gateway/.planning/quick/14-ground-truth-check-confirm-scope-retenti/14-SUMMARY.md
@/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts
@/home/forge/openclaw/src/gateway/server.auth.e2e.test.ts
@/home/forge/openclaw-even-g2-voice-gateway/packages/openclaw-client/src/openclaw-client.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Security audit of sharedAuthOk scope guard and edge cases</name>
  <files>
    /home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts
    /home/forge/openclaw/src/gateway/server.auth.e2e.test.ts
  </files>
  <action>
Perform a focused security review of commit 4d1fb3e9f (the !sharedAuthOk scope guard). Trace the full data flow to verify no privilege escalation is possible.

1. **Verify sharedAuthOk derivation is sound** (message-handler.ts lines 380-392):
   - Read the `authorizeGatewayConnect` call that produces `sharedAuthResult`
   - Confirm `sharedAuthOk` can ONLY be true when `sharedAuthResult.ok === true` AND `method` is `"token"` or `"password"`
   - Check: can a malicious client forge `sharedAuthOk = true` without presenting a valid credential? (e.g., by sending crafted connect params)
   - Check: what happens if `resolvedAuth` is configured without a shared secret? Does `sharedAuthResult` default to null?

2. **Verify the three-way exemption interaction** at line 422:
   ```
   if (scopes.length > 0 && !allowControlUiBypass && !sharedAuthOk)
   ```
   - Check: Can `allowControlUiBypass` AND `sharedAuthOk` both be true simultaneously? Is that a valid combination?
   - Check: At line 622 (`const skipPairing = allowControlUiBypass && sharedAuthOk`) -- does the scope fix interact with pairing skip logic?

3. **Verify the "rejects unauthenticated connections" test path** (commit 801fa7fe8):
   - Read the test at approximately line 370: `test("rejects unauthenticated connections without device identity", ...)`
   - Trace: when `skipDefaultAuth: true` is passed to `connectReq`, does the connect frame omit the auth token?
   - Trace: in message-handler.ts with no token and no device, does the connection reach the scope-stripping condition (line 422) or get rejected earlier at `!canSkipDevice` (line 437)?
   - The test asserts `res.error?.message` contains `"device identity required"` -- verify this matches the actual error at line 443: `sendHandshakeErrorResponse(ErrorCodes.NOT_PAIRED, "device identity required")`
   - If the connection is rejected BEFORE reaching line 422, scope stripping is moot -- but confirm this is the correct behavior (reject early, not silently strip)

4. **Check password-auth edge case**:
   - `sharedAuthOk` is true for `method === "password"` too
   - Are there any password-authenticated connections without device identity that should NOT retain scopes?
   - Check if there's a test for password-auth scope retention

5. **Document findings**: For each check above, note PASS/FAIL and the specific line numbers that confirm it.

If ANY security issue is found: fix the code in message-handler.ts and add/update a test in server.auth.e2e.test.ts. Run `npx vitest run --config vitest.e2e.config.ts src/gateway/server.auth.e2e.test.ts` to confirm.

If NO issues are found: proceed to Task 2 with documented evidence.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw && npx vitest run --config vitest.e2e.config.ts src/gateway/server.auth.e2e.test.ts 2>&1 | grep -E "Tests.*passed|failed"</automated>
    <manual>Security audit checklist: all 5 checks documented with PASS/FAIL and line references</manual>
  </verify>
  <done>
    - sharedAuthOk derivation traced: cannot be true without valid credential (with line refs)
    - Three-way exemption interaction verified safe
    - Unauthenticated connection rejection path traced (early reject at canSkipDevice, not scope strip)
    - Password-auth edge case assessed
    - Any gaps found are fixed with tests passing, OR explicit "no gaps found" with evidence
  </done>
</task>

<task type="auto">
  <name>Task 2: Verify voice-gateway client/server alignment and run full test suites</name>
  <files>
    /home/forge/openclaw-even-g2-voice-gateway/packages/openclaw-client/src/openclaw-client.ts
    /home/forge/openclaw-even-g2-voice-gateway/packages/openclaw-client/src/openclaw-client.test.ts
  </files>
  <action>
Verify the voice-gateway OpenClawClient sends connect params that the fixed OpenClaw server will handle correctly.

1. **Verify client connect params match server expectations**:
   - In `openclaw-client.ts` `sendConnectFrame` (line 376+), confirm:
     - `scopes: ["operator.admin"]` is sent (line 397)
     - `auth: { token: ... }` is sent when `authToken` is configured (line 398-401)
     - No `device` field is sent (no device key at all, or `device: undefined`)
     - No root-level `nonce` is sent (fixed in commit 862148e)
   - In message-handler.ts, trace what happens when the server receives this exact connect frame:
     - `device` will be undefined/null -> enters the `if (!device)` block (line 421)
     - `sharedAuthOk` will be true (token matches shared secret)
     - `scopes.length > 0 && !allowControlUiBypass && !sharedAuthOk` => `true && true && false` => false => scopes NOT stripped
     - `canSkipDevice = sharedAuthOk` => true => does NOT reject at line 437

2. **Verify the voice-gateway test mocks reflect reality**:
   - In `openclaw-client.test.ts`, check that the mock server protocol matches the real server behavior:
     - Does the mock validate auth tokens?
     - Does the mock enforce scope-related behavior?
   - In `test/integration/voice-turn.test.ts`, check the mock `attachOpenClawProtocol`:
     - Does it verify the connect frame has proper auth?
     - Is it a reasonable approximation of the real protocol?

3. **Run all test suites to confirm nothing is broken**:
   - Voice gateway tests: `cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run`
   - OpenClaw auth e2e: `cd /home/forge/openclaw && npx vitest run --config vitest.e2e.config.ts src/gateway/server.auth.e2e.test.ts`

4. **Write review summary**: Document the alignment analysis with specific line references from both repos. Note any mock/reality gaps that are acceptable vs. ones that should be fixed.

If any test fails or any client/server misalignment is found: fix it, commit, re-run tests.
If all checks pass: document findings as evidence for the SUMMARY.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run 2>&1 | grep -E "Tests.*passed|failed" && cd /home/forge/openclaw && npx vitest run --config vitest.e2e.config.ts src/gateway/server.auth.e2e.test.ts 2>&1 | grep -E "Tests.*passed|failed"</automated>
    <manual>Client connect params traced through server code path with line references. All test suites green.</manual>
  </verify>
  <done>
    - Voice-gateway client sends correct connect params for scope retention (token + operator.admin + no device)
    - Server code path traced: scopes retained, device skip allowed, connection succeeds
    - Voice-gateway: 192/192 tests pass
    - OpenClaw auth e2e: 31/31 tests pass
    - Any gaps fixed, OR explicit "no gaps" with evidence
  </done>
</task>

</tasks>

<verification>
1. Security audit: sharedAuthOk derivation cannot be spoofed — traced to authorizeGatewayConnect server-side credential verification
2. Edge cases: password-auth, allowControlUiBypass interaction, unauthenticated rejection path all verified
3. Client/server alignment: voice-gateway sends token + operator.admin scope + no device, server retains scopes via !sharedAuthOk guard
4. All tests pass: 192/192 voice-gateway + 31/31 OpenClaw auth e2e
5. Any code/test gaps found are fixed and committed
</verification>

<success_criteria>
- Security audit completed with 5+ specific checks documented (each with PASS/FAIL + line refs)
- Client/server connect param alignment traced with line references from both repos
- Voice-gateway tests: 192/192 pass
- OpenClaw auth e2e: 31/31 pass
- If gaps found: fixed with code + tests + commit
- If no gaps found: explicit documented evidence why the fix is correct and complete
</success_criteria>

<output>
After completion, create `.planning/quick/15-self-review-last-commits-for-shared-secr/15-SUMMARY.md`
</output>
