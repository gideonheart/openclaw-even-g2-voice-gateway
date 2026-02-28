---
phase: quick-4
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - RELEASE_HANDOFF.md
autonomous: true
requirements: []

must_haves:
  truths:
    - "Release handoff document captures shipped scope, known limitations, and next priorities"
    - "Hidden risks and edge cases from last 3 commits are documented"
    - "Stale documentation is identified with exact locations"
  artifacts:
    - path: "RELEASE_HANDOFF.md"
      provides: "v1 release handoff with shipped scope, limitations, priorities"
      min_lines: 80
  key_links: []
---

<objective>
Review the last 3 substantive commits (9f80650, d5df520, f6b8c38) for hidden risks, edge cases, and tech debt. Produce a release handoff document with shipped scope, known limitations, and top 3 post-v1 priorities.

Purpose: Close the v1 milestone with a clear-eyed assessment of what shipped, what the known gaps are, and where to invest next.
Output: RELEASE_HANDOFF.md at repo root.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@docs/architecture.md
@docs/security.md
@docs/runbook.md
@services/gateway-api/src/server.ts
@services/gateway-api/src/index.ts
@services/gateway-api/src/orchestrator.ts
@services/gateway-api/src/config-store.ts
@services/gateway-api/src/provider-rebuilder.ts
@packages/openclaw-client/src/openclaw-client.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create RELEASE_HANDOFF.md with audit findings and release summary</name>
  <files>RELEASE_HANDOFF.md</files>
  <action>
Create RELEASE_HANDOFF.md at the repo root with the following sections. This is a code review + release handoff, not a marketing document. Be precise and technical.

## Shipped Scope (v1)
Summarize all 31 requirements delivered across 3 phases. Group by phase with brief descriptions. Reference commit range (3dde320..82b1ce6).

## Review: Last 3 Commits
For each of commits 9f80650 (docs), d5df520 (PIPE-07 provider re-init), f6b8c38 (milestone close):
- What was shipped
- Code quality assessment (test coverage, typing, error handling)

## Hidden Risks and Edge Cases Found

Document these specific findings from the code review:

1. **Stale runbook note (docs/runbook.md line 161)**: States "Changing provider-specific config (URLs, API keys) currently requires a restart" -- this is now incorrect because PIPE-07 (commit d5df520) added runtime provider re-initialization via ConfigStore.onChange(). The note should be updated to reflect that provider config changes take effect on the next request without restart.

2. **OpenClaw client not re-initialized on config change**: When `openclawGatewayUrl` or `openclawGatewayToken` are changed via POST /api/settings, the OpenClawClient instance keeps its original WebSocket connection with the old URL and token. The provider-rebuilder only covers STT providers. Changing OpenClaw connection settings via the API silently has no effect until the next restart. This is a functional gap -- either document this limitation or add an OpenClaw client rebuilder.

3. **RateLimiter uses stale config**: In server.ts, the RateLimiter is constructed once at server creation with `configStore.get().server.rateLimitPerMinute`. If `server.rateLimitPerMinute` is later changed via POST /api/settings, the rate limiter still enforces the original value. Low severity since rate limit tuning at runtime is uncommon, but worth noting.

4. **RateLimiter memory leak under diverse-IP load**: The RateLimiter's `windows` Map never prunes expired entries. Each unique IP address creates an entry that persists forever. Under sustained load from many distinct IPs (e.g., behind a load balancer with X-Forwarded-For), memory grows without bound. Mitigation: periodic cleanup of entries past their `resetAt` timestamp, or use a bounded LRU cache.

5. **orchestrator.ts:114 TODO**: `model: null` is hardcoded in GatewayReply.meta. The SttResult type likely carries model info from provider responses, but it is not threaded through to the response envelope. Low severity -- the field exists for forward compatibility.

6. **OpenClaw client uses constructor config, not ConfigStore**: The OpenClawClient is created once in index.ts with `config.openclawGatewayUrl` and `config.openclawGatewayToken` from the initial loadConfig(). It does not read from ConfigStore on each request. This is related to finding #2 but worth calling out as a design pattern difference from how STT providers now work post-PIPE-07.

## Tech Debt Summary

Categorize findings by severity:
- **Should fix before production**: Stale runbook note (#1)
- **Should fix in v1.1**: OpenClaw client re-init gap (#2), RateLimiter memory (#4)
- **Nice to have**: RateLimiter stale config (#3), model threading (#5)

## Known Limitations
- In-memory rate limiter (single-instance only, no persistence across restarts)
- No authentication on settings/voice endpoints (relies on CORS + network trust)
- OpenClaw WebSocket protocol details need validation against a running instance
- Even Hub audio format (WebM/Opus vs CAF/AAC) needs confirmation
- No Docker/container support (by design -- direct install alongside OpenClaw)
- No TLS termination (expects reverse proxy)

## Top 3 Post-v1 Priorities

1. **OpenClaw client runtime re-initialization** -- Extend the ConfigStore.onChange() pattern to rebuild the OpenClawClient when connection config changes, matching the STT provider behavior from PIPE-07. This closes the asymmetry where STT providers are runtime-configurable but the OpenClaw connection is not.

2. **RateLimiter hardening** -- Add periodic pruning of expired windows (setInterval with .unref()) and consider making the rate limit reactive to config changes. This prevents the memory leak under sustained diverse-IP load.

3. **Integration testing against live services** -- Validate the OpenClaw WebSocket protocol and Even Hub audio format against running instances. The current test suite uses mocks for external services. A smoke test script that exercises POST /api/voice/turn against real WhisperX and OpenClaw would catch protocol mismatches before user deployment.
  </action>
  <verify>
    <automated>test -f RELEASE_HANDOFF.md && wc -l RELEASE_HANDOFF.md | awk '{if ($1 >= 80) print "PASS: "$1" lines"; else print "FAIL: only "$1" lines"}'</automated>
    <manual>Read RELEASE_HANDOFF.md and confirm all 6 findings are documented, scope summary is accurate, and priorities are actionable</manual>
  </verify>
  <done>RELEASE_HANDOFF.md exists at repo root with shipped scope (31 requirements across 3 phases), 6 documented hidden risks/edge cases with exact file/line references, tech debt categorized by severity, known limitations listed, and top 3 post-v1 priorities with rationale</done>
</task>

</tasks>

<verification>
- RELEASE_HANDOFF.md exists and has >= 80 lines of substantive content
- All 6 hidden risk findings are documented with code references
- Shipped scope covers all 3 phases and 31 requirements
- Top 3 priorities are specific and actionable (not vague)
- No secrets or sensitive values appear in the document
</verification>

<success_criteria>
A developer picking up this project post-v1 can read RELEASE_HANDOFF.md and understand:
1. What was shipped and the commit range
2. Where the bodies are buried (hidden risks, stale docs, edge cases)
3. What to work on next and why
</success_criteria>

<output>
After completion, create `.planning/quick/4-final-wrap-up-review-last-3-commits-for-/4-SUMMARY.md`
</output>
