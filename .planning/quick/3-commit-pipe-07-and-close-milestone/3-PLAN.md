---
phase: quick-3
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - services/gateway-api/src/provider-rebuilder.ts
  - services/gateway-api/src/provider-rebuilder.test.ts
  - services/gateway-api/src/config-store.ts
  - services/gateway-api/src/config-store.test.ts
  - services/gateway-api/src/index.ts
  - .planning/ROADMAP.md
  - .planning/STATE.md
autonomous: true
requirements: [PIPE-07]
must_haves:
  truths:
    - "PIPE-07 provider-rebuilder code and tests are committed with a clean, descriptive commit"
    - "ROADMAP.md reflects all 31/31 requirements delivered and Phase 3 complete"
    - "STATE.md reflects milestone closure with no remaining pending todos for v1"
    - "All changes are pushed to origin/master"
    - "Section 7 docs artifacts (architecture.md, security.md, runbook.md, .env.example, README quickstart) are confirmed present in the repo"
  artifacts:
    - path: "services/gateway-api/src/provider-rebuilder.ts"
      provides: "Runtime STT provider re-initialization on config change"
    - path: "services/gateway-api/src/provider-rebuilder.test.ts"
      provides: "6 tests covering provider rebuild behavior"
    - path: ".planning/ROADMAP.md"
      provides: "Final roadmap with all phases marked complete"
    - path: ".planning/STATE.md"
      provides: "Updated state reflecting milestone closure"
  key_links:
    - from: "services/gateway-api/src/index.ts"
      to: "services/gateway-api/src/provider-rebuilder.ts"
      via: "registerProviderRebuilder() call"
      pattern: "registerProviderRebuilder"
    - from: "services/gateway-api/src/provider-rebuilder.ts"
      to: "services/gateway-api/src/config-store.ts"
      via: "configStore.onChange() listener"
      pattern: "configStore\\.onChange"
---

<objective>
Commit the completed PIPE-07 (runtime provider re-initialization) code and tests, update planning state to reflect v1 milestone closure, verify Section 7 docs are present, and push everything to origin.

Purpose: Close out the v1 milestone -- all 31/31 requirements delivered, all docs in place, clean git history.
Output: Two clean commits (PIPE-07 feat + planning state update) pushed to origin/master.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Run PIPE-07 tests and commit code</name>
  <files>
    services/gateway-api/src/provider-rebuilder.ts
    services/gateway-api/src/provider-rebuilder.test.ts
    services/gateway-api/src/config-store.ts
    services/gateway-api/src/config-store.test.ts
    services/gateway-api/src/index.ts
  </files>
  <action>
1. Run the provider-rebuilder tests to confirm they pass:
   `cd services/gateway-api && npx vitest run src/provider-rebuilder.test.ts`
2. Also run config-store tests to confirm the onChange additions work:
   `cd services/gateway-api && npx vitest run src/config-store.test.ts`
3. Stage ONLY the PIPE-07 files (no planning files in this commit):
   `git add services/gateway-api/src/provider-rebuilder.ts services/gateway-api/src/provider-rebuilder.test.ts services/gateway-api/src/config-store.ts services/gateway-api/src/config-store.test.ts services/gateway-api/src/index.ts`
4. Create commit with message:
   ```
   feat(PIPE-07): runtime STT provider re-initialization on config change

   Adds ConfigStore.onChange() listener pattern and registerProviderRebuilder()
   that rebuilds STT provider instances when their config section changes via
   the settings API. Providers are replaced in the shared Map so handlers see
   updated instances on the next request without restart.

   - ConfigStore gains onChange(cb) for registering change listeners
   - provider-rebuilder.ts registers listener to rebuild WhisperX/OpenAI/Custom
   - 6 tests covering single, multi, and no-op rebuild scenarios
   - index.ts wires registerProviderRebuilder at startup

   Closes PIPE-07. All 31/31 v1 requirements now delivered.
   ```
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api && npx vitest run src/provider-rebuilder.test.ts src/config-store.test.ts 2>&1 | tail -20</automated>
    <manual>git log --oneline -1 shows the PIPE-07 feat commit with only the 5 expected files</manual>
  </verify>
  <done>PIPE-07 code committed with all 6 provider-rebuilder tests and all config-store tests passing. Commit contains exactly 5 files: provider-rebuilder.ts, provider-rebuilder.test.ts, config-store.ts, config-store.test.ts, index.ts.</done>
</task>

<task type="auto">
  <name>Task 2: Update planning state, verify docs, and push</name>
  <files>
    .planning/ROADMAP.md
    .planning/STATE.md
  </files>
  <action>
1. Verify Section 7 docs artifacts are present and committed by running:
   `git ls-files docs/architecture.md docs/security.md docs/runbook.md .env.example README.md`
   All 5 files must appear. They were committed at 9f80650 -- no further action needed unless any are missing.

2. Update .planning/STATE.md:
   - Change "Current focus" to: "v1 milestone complete -- all 31/31 requirements delivered"
   - Change Status to: "Complete -- all 31/31 requirements delivered, all docs in place"
   - Clear "Pending Todos" section (PIPE-07 is done, docs are done)
   - Add quick task #3 to the table: "Commit PIPE-07 and close v1 milestone"
   - Update "Stopped at" to reflect milestone closure

3. Stage planning files:
   `git add .planning/ROADMAP.md .planning/STATE.md`

4. Create commit:
   ```
   docs(quick-3): close v1 milestone -- 31/31 requirements delivered

   Updates ROADMAP.md to mark Phase 3 and PIPE-07 complete.
   Updates STATE.md to reflect v1 milestone closure with no remaining gaps.
   Section 7 docs (architecture, security, runbook, .env.example, README)
   confirmed present from commit 9f80650.
   ```

5. Push to origin:
   `git push origin master`
  </action>
  <verify>
    <automated>git ls-files docs/architecture.md docs/security.md docs/runbook.md .env.example README.md | wc -l</automated>
    <manual>Output should be 5 (all docs present). `git log --oneline -2` shows both new commits. `git status` shows clean working tree. Remote is up to date.</manual>
  </verify>
  <done>ROADMAP.md shows all phases [x] complete with 31/31 requirements. STATE.md reflects v1 closure with empty pending todos. All 5 Section 7 doc artifacts confirmed in repo. Both commits pushed to origin/master. Working tree is clean.</done>
</task>

</tasks>

<verification>
- `git log --oneline -3` shows: docs(quick-3) close milestone, feat(PIPE-07) commit, then docs commit (9f80650)
- `git status` shows clean working tree
- `git ls-files docs/ .env.example README.md` confirms all doc artifacts
- `npx vitest run src/provider-rebuilder.test.ts` in gateway-api passes 6 tests
- `git diff origin/master..master` is empty (pushed)
</verification>

<success_criteria>
- PIPE-07 code committed with passing tests (6 provider-rebuilder + config-store tests)
- Planning state updated to reflect complete v1 milestone (31/31 requirements)
- Section 7 docs confirmed present: architecture.md, security.md, runbook.md, .env.example, README quickstart
- All commits pushed to origin/master
- Working tree clean
</success_criteria>

<output>
After completion, create `.planning/quick/3-commit-pipe-07-and-close-milestone/3-SUMMARY.md`
</output>
