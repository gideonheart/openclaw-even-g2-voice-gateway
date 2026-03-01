---
phase: quick-17
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - CLAUDE.md
  - .planning/STATE.md
autonomous: true
requirements: [PARK-01]
must_haves:
  truths:
    - "When Claude is resumed without an explicit engineering task, it replies exactly: PARKED_NOOP -- awaiting explicit assignment. Then stops."
    - "The parked-idle directive is encoded in CLAUDE.md so every new session inherits it"
    - "STATE.md reflects parked-idle mode as current status"
  artifacts:
    - path: "CLAUDE.md"
      provides: "Project instructions including parked-idle behavioral directive"
      contains: "PARKED_NOOP"
    - path: ".planning/STATE.md"
      provides: "Project state reflecting parked-idle mode"
      contains: "parked-idle"
  key_links:
    - from: "CLAUDE.md"
      to: "Claude session behavior"
      via: "Project instructions auto-loaded at session start"
      pattern: "PARKED_NOOP"
---

<objective>
Enter parked-idle mode by encoding a behavioral directive in CLAUDE.md: when resumed without an explicit engineering task, Claude must reply exactly "PARKED_NOOP -- awaiting explicit assignment." and stop. No project status recaps, no milestone suggestions.

Purpose: Prevent chatty re-engagement when the user resumes a parked project without a specific task. The user wants silence unless there is real work to do.
Output: CLAUDE.md with parked-idle directive, updated STATE.md
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
  <name>Task 1: Create CLAUDE.md with parked-idle directive</name>
  <files>CLAUDE.md</files>
  <action>
Create CLAUDE.md at project root with the following content:

1. A "# Project: OpenClaw Even G2 Voice Gateway" header with a one-line description referencing .planning/PROJECT.md for details.

2. A "## Parked-Idle Mode" section (prominently placed, before any other behavioral rules) containing:
   - Clear directive: This project is in PARKED-IDLE mode. When resumed without an explicit engineering task, respond exactly: `PARKED_NOOP -- awaiting explicit assignment.` Then stop. Do NOT restate project status, suggest milestones, summarize past work, or offer next steps.
   - Note that an "explicit engineering task" means a concrete instruction like "fix bug X", "add feature Y", "run tests", etc. Greetings, "what's up", "where were we", or vague check-ins are NOT explicit tasks.
   - Directive to exit parked-idle: To leave parked-idle mode, the user will give an explicit task or say "unpark".

3. A "## Development" section with essential project conventions:
   - Runtime: Bun (not Node)
   - Language: TypeScript (strict)
   - Test runner: bun test
   - Planning docs: .planning/ directory

Keep the file concise -- under 40 lines total. This is a behavioral contract, not documentation.
  </action>
  <verify>
    <automated>test -f /home/forge/openclaw-even-g2-voice-gateway/CLAUDE.md && grep -q "PARKED_NOOP" /home/forge/openclaw-even-g2-voice-gateway/CLAUDE.md && grep -q "parked-idle" /home/forge/openclaw-even-g2-voice-gateway/CLAUDE.md && echo "PASS" || echo "FAIL"</automated>
  </verify>
  <done>CLAUDE.md exists at project root, contains PARKED_NOOP directive, parked-idle behavioral rules, and basic project conventions</done>
</task>

<task type="auto">
  <name>Task 2: Update STATE.md to reflect parked-idle mode</name>
  <files>.planning/STATE.md</files>
  <action>
Update .planning/STATE.md with the following changes:

1. In "Current focus" line: change to "v1.0 shipped -- PARKED-IDLE mode active (see CLAUDE.md)"
2. In "Status" line: change to "PARKED-IDLE -- responds only to explicit engineering tasks"
3. In "Last activity": update to today's date and "Entered parked-idle mode (quick-17)"
4. Add quick task 17 to the Quick Tasks Completed table:
   - #: 17
   - Description: Enter parked-idle mode: CLAUDE.md directive to respond PARKED_NOOP when no explicit task given
   - Date: 2026-03-01
   - Commit: (will be filled by commit step)
   - Directory: link to this quick task directory
5. In "Session Continuity" section: update "Stopped at" to "Parked-idle mode active. CLAUDE.md governs resume behavior."
  </action>
  <verify>
    <automated>grep -q "PARKED-IDLE" /home/forge/openclaw-even-g2-voice-gateway/.planning/STATE.md && grep -q "quick-17" /home/forge/openclaw-even-g2-voice-gateway/.planning/STATE.md && echo "PASS" || echo "FAIL"</automated>
  </verify>
  <done>STATE.md reflects parked-idle mode status with quick-17 logged in task history</done>
</task>

</tasks>

<verification>
1. CLAUDE.md exists and contains the PARKED_NOOP directive
2. STATE.md updated with parked-idle status and quick-17 entry
3. Both files committed to git
</verification>

<success_criteria>
- CLAUDE.md at project root encodes the parked-idle behavioral rule
- Any new Claude session on this project will auto-load CLAUDE.md and follow the PARKED_NOOP directive when no explicit task is given
- STATE.md accurately reflects the parked-idle state
</success_criteria>

<output>
After completion, create `.planning/quick/17-enter-parked-idle-mode-when-resumed-with/17-SUMMARY.md`
</output>
