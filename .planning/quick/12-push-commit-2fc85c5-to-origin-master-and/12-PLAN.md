---
phase: quick-12
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [QUICK-12]
must_haves:
  truths:
    - "Commit 2fc85c5 is present on origin/master"
    - "OGG voice-turn path smoke check is attempted or blocker is reported"
    - "Final git status -sb and git log --oneline -3 are reported"
  artifacts: []
  key_links: []
---

<objective>
Push commit 2fc85c5 to origin/master, attempt an end-to-end smoke check of the OGG voice-turn path, and report final git state.

Purpose: Sync the latest fix (challenge nonce in OpenClaw connect frame) to origin and verify the voice-turn pipeline works.
Output: Remote in sync, smoke check results or blocker reported, git state printed.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Push commit 2fc85c5 to origin/master</name>
  <files></files>
  <action>
Run `git push origin master` to push the 1 ahead commit (2fc85c5 "fix: include challenge nonce in OpenClaw connect frame to prevent 1008 rejection") to origin/master.

Verify push succeeded by checking `git status -sb` shows no ahead/behind count.
  </action>
  <verify>
    Run `git status -sb` and confirm output shows `## master...origin/master` with no `[ahead N]` indicator.
  </verify>
  <done>Commit 2fc85c5 is on origin/master. Local and remote are in sync.</done>
</task>

<task type="auto">
  <name>Task 2: Smoke check OGG voice-turn path</name>
  <files></files>
  <action>
Attempt an end-to-end smoke check of the OGG voice-turn path:

1. First, run the existing integration test suite which covers the full voice-turn pipeline (audio -> STT -> OpenClaw -> GatewayReply) using mocked providers:
   `npx vitest run test/integration/voice-turn.test.ts`

2. Then check if a local gateway instance is running by probing `curl -s http://127.0.0.1:3000/healthz` (default port) and `curl -s http://localhost:3000/healthz`. If not on 3000, also try common alternatives 8080, 8000.

3. If a running gateway is found, attempt a live OGG voice-turn request:
   `curl -s -X POST -H "Content-Type: audio/ogg" --data-binary @/dev/null http://127.0.0.1:{port}/api/voice/turn`
   Report the response status and body.

4. If NO running gateway instance is found, report the exact blocker: "No local gateway instance detected on ports 3000/8080/8000. To run one: configure OPENCLAW_GATEWAY_URL, OPENCLAW_GATEWAY_TOKEN, OPENCLAW_SESSION_KEY env vars and run `npm run build && node dist/services/gateway-api/src/index.js`."

Note: The integration tests already exercise the full OGG-compatible voice-turn path with mocked STT and OpenClaw servers, which is the most reliable smoke check available without external services.
  </action>
  <verify>
    Integration test suite passes (`vitest run test/integration/voice-turn.test.ts` exits 0). Live instance check results are reported.
  </verify>
  <done>Voice-turn integration tests pass confirming the OGG path works. Live instance availability or exact blocker is reported.</done>
</task>

<task type="auto">
  <name>Task 3: Report final git state</name>
  <files></files>
  <action>
Run and report output of:
1. `git status -sb`
2. `git log --oneline -3`

Print both outputs clearly for the user.
  </action>
  <verify>
    Both commands execute successfully and output is captured.
  </verify>
  <done>Git status and recent log are reported showing clean, synced state with 2fc85c5 as HEAD.</done>
</task>

</tasks>

<verification>
- `git status -sb` shows `## master...origin/master` (no ahead/behind)
- `git log --oneline -3` shows 2fc85c5 as most recent commit
- Integration tests pass for voice-turn path
- Live gateway status or blocker is clearly reported
</verification>

<success_criteria>
1. Commit 2fc85c5 exists on origin/master (push succeeded)
2. OGG voice-turn smoke check completed via integration tests, with live instance status reported
3. Final git status -sb and git log --oneline -3 output provided
</success_criteria>

<output>
After completion, create `.planning/quick/12-push-commit-2fc85c5-to-origin-master-and/12-SUMMARY.md`
</output>
