---
phase: quick-25
plan: 25
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/quick/25-audit-code-vs-docs-alignment-update-plan/25-AUDIT-FINDINGS.md
  - .planning/PROJECT.md
  - .planning/STATE.md
  - .planning/MILESTONES.md
  - ARCHITECTURE.md
  - README.md
  - docs/architecture.md
  - docs/runbook.md
  - docs/security.md
  - RELEASE_HANDOFF.md
  - PRD.md
autonomous: true
requirements: []
must_haves:
  truths:
    - "Every documentation file accurately reflects the current codebase state"
    - "Test counts, LOC counts, package counts match reality"
    - "All API endpoints in code are documented"
    - "Stale findings/tech-debt items marked as resolved where code has fixed them"
    - "Runtime description (Bun vs Node) is consistent across all docs"
  artifacts:
    - path: ".planning/quick/25-audit-code-vs-docs-alignment-update-plan/25-AUDIT-FINDINGS.md"
      provides: "Comprehensive audit findings report"
    - path: ".planning/PROJECT.md"
      provides: "Updated project documentation matching code reality"
    - path: "README.md"
      provides: "Updated README with all current endpoints and accurate stats"
  key_links:
    - from: "25-AUDIT-FINDINGS.md"
      to: "all doc files"
      via: "findings drive specific doc edits"
      pattern: "each finding maps to a file edit"
---

<objective>
Audit all documentation files against the actual TypeScript codebase and fix every
discrepancy found. The code is the source of truth -- docs must match code, not the
other way around.

Purpose: After 24 quick tasks of iterative development, documentation has drifted from
reality. Multiple files contain stale counts, missing endpoints, resolved tech debt
still listed as open, and inconsistent runtime references.

Output: A findings report (25-AUDIT-FINDINGS.md) and corrected documentation files.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/MILESTONES.md
@ARCHITECTURE.md
@README.md
@docs/architecture.md
@docs/runbook.md
@docs/security.md
@RELEASE_HANDOFF.md
@PRD.md
@CLAUDE.md
@.env.example
@package.json
@vitest.config.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Deep code-vs-docs audit producing findings report</name>
  <files>.planning/quick/25-audit-code-vs-docs-alignment-update-plan/25-AUDIT-FINDINGS.md</files>
  <action>
Read EVERY source file (not test files) to understand current code reality:
- All packages/*/src/*.ts (non-test)
- All services/*/src/*.ts (non-test)
- package.json, tsconfig.json, vitest.config.ts, .env.example

Then read EVERY documentation file:
- .planning/PROJECT.md, .planning/STATE.md, .planning/ROADMAP.md, .planning/MILESTONES.md
- CLAUDE.md, ARCHITECTURE.md, README.md, PRD.md, RELEASE_HANDOFF.md, OVERNIGHT_TODO.md
- docs/architecture.md, docs/runbook.md, docs/security.md

For each doc file, compare against code and record EVERY discrepancy. Categorize findings as:
- **STALE_STAT**: Wrong number (LOC, test count, package count, file count)
- **MISSING_FEATURE**: Feature exists in code but not documented
- **STALE_FINDING**: Tech debt/issue listed as open but code shows it is resolved
- **WRONG_DETAIL**: Incorrect technical detail (wrong default, wrong runtime, wrong API surface)
- **STALE_CONTENT**: Content that no longer applies or is superseded

Known discrepancies to verify and expand upon (do NOT limit to these -- find ALL):

1. Package count: PROJECT.md says "7 packages" -- actual is 9 packages/ dirs + 1 services/ dir
2. LOC: PROJECT.md and MILESTONES.md say "7,138" -- run `wc -l` on all source to get actual
3. Test count: MILESTONES.md says "177", PROJECT.md says "177" -- actual is 220 (run `npx vitest run`)
4. Runtime: CLAUDE.md says "Bun (not Node)" but package.json says engines node>=20, README says Node.js -- determine which is actually used and flag the inconsistent one
5. POST /api/text/turn: Added in quick-21 rewrite, NOT in README API table, NOT in docs/architecture.md, NOT in docs/runbook.md
6. RELEASE_HANDOFF.md Finding #2/#6: OpenClaw client re-init -- NOW FIXED by openclaw-rebuilder.ts (quick-21)
7. RELEASE_HANDOFF.md Finding #3: RateLimiter stale config -- NOW FIXED, reads configStore.get() on every check()
8. RELEASE_HANDOFF.md Finding #4: RateLimiter memory leak -- NOW FIXED with periodic prune + 10k hard cap
9. ARCHITECTURE.md (root): Says gateway owns "Streaming response output (SSE/chunked)" -- actual implementation uses standard HTTP request/response, no SSE/streaming
10. PRD.md Section 11: Lists POST /api/voice/start and POST /api/voice/stop -- actual API is POST /api/voice/turn (and POST /api/text/turn)
11. PRD.md Section 6.2: Lists test/unit/ directory -- does not exist (tests are co-located in src/). Lists docs/integration-frontend.md -- does not exist
12. docs/runbook.md: May still have stale note about provider config requiring restart (RELEASE_HANDOFF finding #1) -- verify current text
13. OPENCLAW_GATEWAY_PORT fallback: Added in quick-22/23, documented in .env.example but may be missing from docs/runbook.md env var tables

Write the findings report to 25-AUDIT-FINDINGS.md with a structured table per file listing:
- File path
- Finding type (STALE_STAT, MISSING_FEATURE, etc.)
- Current text (brief quote)
- Correct text (what it should say)
- Severity (high = actively misleading, medium = inaccurate, low = cosmetic)
  </action>
  <verify>
    <automated>test -f .planning/quick/25-audit-code-vs-docs-alignment-update-plan/25-AUDIT-FINDINGS.md && grep -c "STALE_STAT\|MISSING_FEATURE\|STALE_FINDING\|WRONG_DETAIL\|STALE_CONTENT" .planning/quick/25-audit-code-vs-docs-alignment-update-plan/25-AUDIT-FINDINGS.md</automated>
    <manual>Review findings report for completeness -- should have 10+ findings across multiple files</manual>
  </verify>
  <done>25-AUDIT-FINDINGS.md exists with categorized, actionable findings covering all documentation files. Each finding specifies the file, current text, and correct text.</done>
</task>

<task type="auto">
  <name>Task 2: Apply documentation fixes based on audit findings</name>
  <files>
    .planning/PROJECT.md
    .planning/STATE.md
    .planning/MILESTONES.md
    ARCHITECTURE.md
    README.md
    docs/architecture.md
    docs/runbook.md
    docs/security.md
    RELEASE_HANDOFF.md
    PRD.md
  </files>
  <action>
Using 25-AUDIT-FINDINGS.md as the fix list, update every documentation file to match
code reality. ABSOLUTELY NO SOURCE CODE CHANGES -- only .md files.

Specific fixes to apply (plus any additional findings from Task 1):

**README.md:**
- Add POST /api/text/turn to the API table (Method: POST, Endpoint: /api/text/turn, Description: Send text, get AI response (no STT))
- Verify all other endpoint descriptions match current code

**docs/architecture.md:**
- Add POST /api/text/turn to API Endpoints table
- Update any stale pipeline description to mention text turn path
- Verify monorepo structure listing matches actual 9 packages

**docs/runbook.md:**
- Add POST /api/text/turn to Quick Reference and usage examples
- Add OPENCLAW_GATEWAY_PORT to environment variable tables (the fallback chain from .env.example)
- Fix any stale note about provider config requiring restart (it now works at runtime)
- Update any stale information about RateLimiter behavior

**docs/security.md:**
- Verify all security claims still accurate. Update if rate limiter section is stale (it now has auto-prune and reads live config)

**.planning/PROJECT.md:**
- Fix package count from "7 packages" to correct number (9 packages + 1 service = "9 packages")
- Fix LOC count to match actual `wc -l` total
- Fix test count to 220
- Fix runtime reference if it says "Node.js" but Bun is actually used (or vice versa -- be accurate)
- Update Context section with current accurate stats
- Mark resolved blockers/known issues appropriately

**.planning/MILESTONES.md:**
- Fix test count from "177" to "220"
- Fix LOC from "7,138" to actual
- Note: These are v1.0 snapshot stats -- add a note like "(at time of v1.0 ship; post-ship quick tasks added more)" OR update to current numbers with a date annotation

**ARCHITECTURE.md (root):**
- Fix "Streaming response output (SSE/chunked)" to "Structured JSON response output (HTTP request/response)" or similar accurate description
- Verify all other claims match code

**RELEASE_HANDOFF.md:**
- Add a "Post-Release Fixes" section (or update existing findings) marking which findings were resolved:
  - Finding #1 (stale runbook note): Check if already fixed, mark status
  - Finding #2/#6 (OpenClaw client re-init): RESOLVED in quick-21 by openclaw-rebuilder.ts
  - Finding #3 (RateLimiter stale config): RESOLVED in quick-21 -- reads configStore.get() per check()
  - Finding #4 (RateLimiter memory leak): RESOLVED in quick-21 -- periodic prune + 10k hard cap
  - Finding #5 (model field null): Check current status, update
- Do NOT delete the original findings -- annotate them with resolution status and date

**PRD.md:**
- Add a note at the top that this is the original PRD and the actual shipped implementation differs in specifics. OR update Section 11 API Surface to match reality (POST /api/voice/turn, POST /api/text/turn, etc.)
- Update Section 6.2 structure to match reality (no test/unit/, no docs/integration-frontend.md)
- This is a historical document so changes should be minimal -- add annotations rather than rewriting

**.planning/STATE.md:**
- Update test count reference if present
- Ensure "Last activity" and quick task list are current through quick-24
  </action>
  <verify>
    <automated>npx vitest run 2>&1 | tail -5</automated>
    <manual>Verify no source code was changed: `git diff --name-only -- '*.ts'` should show no changes beyond any pre-existing uncommitted WIP</manual>
  </verify>
  <done>All documentation files updated to match code reality. No source code files modified. Test suite still passes (220 tests).</done>
</task>

<task type="auto">
  <name>Task 3: Commit to branch and push to remote</name>
  <files></files>
  <action>
1. Create and switch to branch `quick-25/audit-code-vs-docs` from current HEAD
2. Stage ONLY documentation files (*.md files) -- explicitly do NOT stage any .ts files or .env files
3. Verify staged files are all .md files: `git diff --cached --name-only` should show only .md paths
4. Commit with message: "docs(quick-25): audit and fix code-vs-documentation alignment"
   Include a brief body listing the categories of fixes (stale stats, missing endpoints, resolved tech debt, etc.)
5. Push branch to origin: `git push -u origin quick-25/audit-code-vs-docs`
6. Report the push result and branch name
  </action>
  <verify>
    <automated>git log --oneline -1 && git status --short</automated>
    <manual>Confirm branch pushed successfully and only .md files were committed</manual>
  </verify>
  <done>All documentation fixes committed on branch quick-25/audit-code-vs-docs and pushed to origin. No source code in the commit.</done>
</task>

</tasks>

<verification>
- `npx vitest run` passes with 220 tests (no code was changed)
- `git diff --name-only HEAD~1` shows only .md files
- `git log --oneline -1` shows the docs commit on the correct branch
- 25-AUDIT-FINDINGS.md exists with 10+ categorized findings
- All high-severity findings from the audit have corresponding fixes in the doc files
</verification>

<success_criteria>
- Every documentation file accurately reflects the current codebase
- POST /api/text/turn is documented in README, docs/architecture.md, and docs/runbook.md
- Test count (220), LOC count, and package count (9) are accurate across all docs
- RELEASE_HANDOFF.md findings #2-4 annotated as resolved with quick-21 reference
- Runtime reference (Bun vs Node) is consistent and correct across all docs
- All changes committed on quick-25/audit-code-vs-docs branch and pushed to origin
- Zero source code changes
</success_criteria>

<output>
After completion, create `.planning/quick/25-audit-code-vs-docs-alignment-update-plan/25-SUMMARY.md`
</output>
