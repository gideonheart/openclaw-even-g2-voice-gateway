---
phase: quick
plan: 14
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [QUICK-14]

must_haves:
  truths:
    - "Commits 4d1fb3e9f and 801fa7fe8 are confirmed present in /home/forge/openclaw with correct changed lines"
    - "The auth+scope focused test suite passes in /home/forge/openclaw"
    - "A concise factual status report with pass/fail evidence is written to STATE.md"
  artifacts:
    - path: "/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts"
      provides: "Scope retention fix at line 422 (!sharedAuthOk guard)"
    - path: "/home/forge/openclaw/src/gateway/server.auth.e2e.test.ts"
      provides: "Updated e2e tests for shared-secret scope retention"
  key_links:
    - from: "message-handler.ts line 422"
      to: "sharedAuthOk guard"
      via: "!sharedAuthOk condition prevents scope strip for shared-secret clients"
      pattern: "!sharedAuthOk"
---

<objective>
Ground truth verification of the scope retention fix (commits 4d1fb3e9f and 801fa7fe8) in /home/forge/openclaw. Inspect exact changed lines, run the focused auth+scope test suite, and produce a concise factual status report. If any gap is found, fix it immediately.

Purpose: State.md is stale — last recorded activity is quick-12 (nonce fix), but quick-13 (scope fix) commits exist in the openclaw repo. Confirm the fix is correct and tests pass before declaring the issue closed.
Output: Verified pass/fail evidence + updated STATE.md.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/debug/openclaw-scope-operator-write.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Verify commits and inspect changed lines</name>
  <files>/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts
/home/forge/openclaw/src/gateway/server.auth.e2e.test.ts</files>
  <action>
In /home/forge/openclaw:

1. Confirm both commits are present:
   git log --oneline | grep -E "4d1fb3e|801fa7fe"

2. Show the exact diff for the fix commit (4d1fb3e9f):
   git show 4d1fb3e9f -- src/gateway/server/ws-connection/message-handler.ts

   Verify the diff contains:
   - Line 422 changed from: `if (scopes.length > 0 && !allowControlUiBypass) {`
   - Line 422 changed to: `if (scopes.length > 0 && !allowControlUiBypass && !sharedAuthOk) {`

3. Show the exact diff for the test commit (801fa7fe8):
   git show 801fa7fe8 -- src/gateway/server.auth.e2e.test.ts

   Verify the diff contains:
   - Old test "ignores requested scopes when device identity is omitted" REMOVED
   - New test "retains requested scopes for shared-secret-authenticated connections without device identity" ADDED
   - New test "rejects unauthenticated connections without device identity" ADDED
   - Tailscale test updated to expect health.ok=true (scope retained)

4. Read the current state of message-handler.ts around the changed line to confirm it is on disk:
   grep -n "sharedAuthOk" src/gateway/server/ws-connection/message-handler.ts

Record: commit SHAs confirmed, line numbers of changes, whether grep finds !sharedAuthOk on disk.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw && git log --oneline | grep -E "4d1fb3e|801fa7fe" | wc -l | grep -q "2" && echo BOTH_COMMITS_PRESENT && grep -n "sharedAuthOk" src/gateway/server/ws-connection/message-handler.ts | grep -q "!sharedAuthOk" && echo FIX_ON_DISK</automated>
    <manual>Both commit SHAs appear in git log and !sharedAuthOk is present in message-handler.ts</manual>
  </verify>
  <done>Both commits confirmed present; !sharedAuthOk guard verified on disk at the scope-stripping condition in message-handler.ts</done>
</task>

<task type="auto">
  <name>Task 2: Run focused auth+scope test suite and report</name>
  <files>/home/forge/openclaw-even-g2-voice-gateway/.planning/STATE.md
/home/forge/openclaw-even-g2-voice-gateway/.planning/quick/14-ground-truth-check-confirm-scope-retenti/14-SUMMARY.md</files>
  <action>
In /home/forge/openclaw, run the focused auth and scope e2e test file:

  npx vitest run src/gateway/server.auth.e2e.test.ts 2>&1 | tail -40

Capture:
- Total tests, pass count, fail count
- Any failing test names and error messages

If tests pass: record evidence and proceed to status report.

If any tests FAIL:
  - Read the failing test and the relevant source section
  - Determine if it is a test bug or a code bug
  - Apply the minimal fix (test file or source file in /home/forge/openclaw)
  - Re-run until green
  - Document what was fixed

Then write the status report to STATE.md in the openclaw-even-g2-voice-gateway repo:

Update the "Current Position" section and "Last activity" line in .planning/STATE.md to reflect:
- Quick task 13 (scope retention) is COMPLETE
- Commits 4d1fb3e9f and 801fa7fe8 are in openclaw repo
- Auth e2e test suite result (X/Y tests passing)
- Whether any gap was found and fixed

Also add quick task 14 to the "Quick Tasks Completed" table in STATE.md.

Finally write the plan SUMMARY to .planning/quick/14-ground-truth-check-confirm-scope-retenti/14-SUMMARY.md with:
- What was verified
- Test results (pass count)
- Commit SHAs and what they change
- Any gaps found/fixed
  </action>
  <verify>
    <automated>cd /home/forge/openclaw && npx vitest run src/gateway/server.auth.e2e.test.ts 2>&1 | grep -E "passed|failed"</automated>
    <manual>All tests in server.auth.e2e.test.ts pass (0 failures). STATE.md updated with quick-14 entry.</manual>
  </verify>
  <done>
    - Auth e2e suite passes with 0 failures (includes "retains requested scopes for shared-secret-authenticated connections" and "rejects unauthenticated connections without device identity")
    - STATE.md updated with quick-13 completion status and quick-14 entry
    - 14-SUMMARY.md written with factual evidence
  </done>
</task>

</tasks>

<verification>
cd /home/forge/openclaw && git log --oneline | grep -E "4d1fb3e|801fa7fe" && grep -c "!sharedAuthOk" src/gateway/server/ws-connection/message-handler.ts && npx vitest run src/gateway/server.auth.e2e.test.ts 2>&1 | grep -E "Tests.*passed"
</verification>

<success_criteria>
- Both commits (4d1fb3e9f scope fix, 801fa7fe8 test update) confirmed present in /home/forge/openclaw
- !sharedAuthOk guard confirmed on disk in message-handler.ts at the scope-stripping condition
- server.auth.e2e.test.ts passes with 0 failures, including the 2 new scope retention tests
- STATE.md updated to reflect quick-13 complete and quick-14 verified
- 14-SUMMARY.md written with concise factual evidence
</success_criteria>

<output>
After completion, create `.planning/quick/14-ground-truth-check-confirm-scope-retenti/14-SUMMARY.md`
</output>
