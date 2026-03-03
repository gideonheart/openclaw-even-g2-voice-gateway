# Audit Findings: Code vs Documentation Alignment

**Date:** 2026-03-03
**Auditor:** quick-25
**Method:** Read every non-test source file and every documentation file; compared claims against code reality.

## Methodology

- Counted packages: `ls packages/` = 9 directories
- Counted services: `ls services/` = 1 directory (gateway-api)
- Source LOC (non-test .ts in packages/*/src + services/*/src): 3,712 lines
- All .ts files (including tests): 7,462 lines
- Test count: `npx vitest run` = 220 tests passing (20 test files)
- Runtime: CLAUDE.md says "Bun (not Node)" -- this is the authoritative source per project instructions

---

## Findings by File

### .planning/PROJECT.md

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 1 | STALE_STAT | "7,138 LOC TypeScript" (Context section) | "3,712 LOC TypeScript (source); 7,462 including tests" | medium |
| 2 | STALE_STAT | "177 tests passing" (Context section) | "220 tests passing" | high |
| 3 | WRONG_DETAIL | "production-ready Node.js gateway" (What This Is) | "production-ready Bun gateway" (Bun is the actual runtime per CLAUDE.md) | high |
| 4 | WRONG_DETAIL | "Shipped v1.0 with 7,138 LOC TypeScript across a monorepo (`apps/` + `packages/`)" (Context) | Monorepo is `packages/` + `services/`, not `apps/` + `packages/` | high |
| 5 | WRONG_DETAIL | "Tech stack: Node.js, TypeScript strict mode" (Context) | "Tech stack: Bun, TypeScript strict mode" | high |
| 6 | STALE_STAT | "7 packages with clear contracts" (Key Decisions table) | "9 packages with clear contracts" | medium |
| 7 | WRONG_DETAIL | "Monorepo with packages/" decision outcome | Should reference 9 packages + 1 service, not just "7 packages" | medium |
| 8 | WRONG_DETAIL | "Language/runtime: TypeScript + Node.js" (Constraints) | "Language/runtime: TypeScript + Bun" | high |
| 9 | WRONG_DETAIL | "Architecture: Monorepo with `apps/` and `packages/`" (Constraints) | "Architecture: Monorepo with `packages/` and `services/`" | high |
| 10 | STALE_CONTENT | "Blockers for next milestone" lists WebSocket protocol validation | RESOLVED in quick-18: protocol handshake validated | medium |
| 11 | STALE_CONTENT | "Two stale TODO comments in index.ts and orchestrator.ts" (Known issues) | orchestrator.ts TODO about model null was resolved in quick-21 rewrite (model is now threaded through properly) | low |

### .planning/MILESTONES.md

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 12 | STALE_STAT | "7,138 LOC TypeScript" | "3,712 LOC source; 7,462 total with tests" (at time of v1.0 ship; post-ship quick tasks refactored/reduced) | medium |
| 13 | STALE_STAT | "177 passing (unit + contract + integration)" | "220 passing (unit + contract + integration)" -- 220 as of quick-23 | high |
| 14 | STALE_STAT | "3 phases, 2 formal plans, 8 quick tasks" | "3 phases, 2 formal plans, 24 quick tasks" | medium |
| 15 | STALE_STAT | "Type-safe architecture: branded types, strict TS, structured logging, 177 tests" (Key accomplishments #6) | Should say "220 tests" | medium |

### README.md

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 16 | MISSING_FEATURE | API table has no entry for POST /api/text/turn | Add row: POST /api/text/turn - Send text, get AI response (no STT) | high |
| 17 | WRONG_DETAIL | "Prerequisites: Node.js >= 20" | "Prerequisites: Bun" (Bun is the runtime per CLAUDE.md) | high |
| 18 | WRONG_DETAIL | "npm install / npm run build / npm test" | "bun install / bun run build / bun test" | high |
| 19 | WRONG_DETAIL | "node services/gateway-api/dist/index.js" (Start) | "bun services/gateway-api/dist/index.js" or "bun run start" | medium |
| 20 | WRONG_DETAIL | Development section uses npm commands | Should use bun commands | medium |

### docs/architecture.md

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 21 | MISSING_FEATURE | API Endpoints table has no POST /api/text/turn | Add row: POST /api/text/turn - Execute a text turn | high |
| 22 | STALE_CONTENT | Monorepo structure shows only 8 packages + 1 service | Correct but verify: list shows 9 package dirs which matches (logging was not omitted) -- VERIFIED: structure listing is accurate with 9 packages | low |

### docs/runbook.md

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 23 | MISSING_FEATURE | Quick Reference and usage examples have no text turn entry | Add text turn curl example and table entry | high |
| 24 | MISSING_FEATURE | No OPENCLAW_GATEWAY_PORT in environment variable tables | Add to Required Variables or Server Variables: OPENCLAW_GATEWAY_PORT derives ws://127.0.0.1:{port} when OPENCLAW_GATEWAY_URL is unset | medium |
| 25 | WRONG_DETAIL | "Prerequisites: Node.js >= 20.0.0" | "Prerequisites: Bun" | high |
| 26 | WRONG_DETAIL | "npm install / npm run build" in Installation | "bun install" | medium |
| 27 | WRONG_DETAIL | "node services/gateway-api/dist/index.js" in Starting | "bun services/gateway-api/dist/index.js" | medium |

### docs/security.md

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 28 | WRONG_DETAIL | "automatically replaced with `\"[REDACTED]\"`" (Structured Logging section) | Code uses `"********"` as the mask value, not `"[REDACTED]"` | medium |

### ARCHITECTURE.md (root)

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 29 | WRONG_DETAIL | "Streaming response output (SSE/chunked)" in Gateway responsibilities | "Structured JSON response output (standard HTTP request/response)" -- no SSE/streaming is implemented | high |
| 30 | WRONG_DETAIL | "Gateway streams response chunks back" (End-to-End Flow step 4) | "Gateway returns structured JSON response" | medium |

### RELEASE_HANDOFF.md

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 31 | STALE_FINDING | Finding #2: "OpenClaw client not re-initialized on config change" | RESOLVED in quick-21 by openclaw-rebuilder.ts -- client is now rebuilt on config change | high |
| 32 | STALE_FINDING | Finding #3: "RateLimiter uses stale config" | RESOLVED in quick-21 -- RateLimiter now reads configStore.get() on every check() call | high |
| 33 | STALE_FINDING | Finding #4: "RateLimiter memory leak under diverse-IP load" | RESOLVED in quick-21 -- periodic prune every 60s + 10k hard cap + destroy() for cleanup | high |
| 34 | STALE_FINDING | Finding #6: "OpenClaw client uses constructor config, not ConfigStore" | RESOLVED in quick-21 by openclaw-rebuilder.ts (same as Finding #2) | high |
| 35 | STALE_FINDING | Finding #5: "model field hardcoded to null" -- TODO(phase-2) comment | Code in quick-21 rewrite threads sttResult.model through to GatewayReply.meta.model correctly | medium |
| 36 | STALE_CONTENT | "Top 3 Post-v1 Priorities" sections #1 and #2 | Both priorities (OpenClaw client re-init, RateLimiter hardening) were completed in quick-21 | medium |
| 37 | STALE_CONTENT | Tech Debt table rows for findings #2, #3, #4 | All marked as "Should fix in v1.1" / "Nice to have" but now resolved | medium |

### PRD.md

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 38 | WRONG_DETAIL | Section 11: "POST /api/voice/start" and "POST /api/voice/stop" | Actual API: POST /api/voice/turn and POST /api/text/turn | high |
| 39 | WRONG_DETAIL | Section 6.2: Lists "test/unit/" directory | test/unit/ exists but is empty -- tests are co-located in src/*.test.ts | medium |
| 40 | WRONG_DETAIL | Section 6.2: Lists "docs/integration-frontend.md" | File does not exist | medium |
| 41 | WRONG_DETAIL | Section 2: "TypeScript + Node.js" constraint | Runtime is Bun per CLAUDE.md | medium |

### .planning/STATE.md

| # | Type | Current Text | Correct Text | Severity |
|---|------|-------------|--------------|----------|
| 42 | STALE_STAT | "LOC: 7,138 TypeScript" (v1.0 Summary) | "LOC: 3,712 source / 7,462 total TypeScript" | medium |

---

## Summary

- **Total findings:** 42
- **High severity (actively misleading):** 17
- **Medium severity (inaccurate):** 20
- **Low severity (cosmetic):** 5

### By category:
- STALE_STAT: 9
- MISSING_FEATURE: 4
- STALE_FINDING: 5
- WRONG_DETAIL: 18
- STALE_CONTENT: 6

### Most impacted files:
1. .planning/PROJECT.md -- 11 findings
2. RELEASE_HANDOFF.md -- 7 findings
3. README.md -- 5 findings
4. PRD.md -- 4 findings
5. .planning/MILESTONES.md -- 4 findings
6. docs/runbook.md -- 5 findings
