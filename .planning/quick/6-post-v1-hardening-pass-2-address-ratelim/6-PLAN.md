---
phase: quick-6
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - services/gateway-api/src/server.ts
  - services/gateway-api/src/server.test.ts
  - docs/security.md
autonomous: true
requirements: [SAFE-06]

must_haves:
  truths:
    - "RateLimiter reads configStore.get().server.rateLimitPerMinute on every check() call so config changes take effect immediately"
    - "RateLimiter prunes expired entries to prevent unbounded memory growth"
    - "Map size is bounded -- stale IPs that stop making requests are eventually evicted"
    - "Tests prove config refresh behavior and map growth bounds"
  artifacts:
    - path: "services/gateway-api/src/server.ts"
      provides: "Hardened RateLimiter class with config refresh and eviction"
      contains: "prune"
    - path: "services/gateway-api/src/server.test.ts"
      provides: "Focused tests for RateLimiter config refresh and map bounds"
  key_links:
    - from: "services/gateway-api/src/server.ts (RateLimiter.check)"
      to: "configStore.get()"
      via: "live read of rateLimitPerMinute on each check()"
      pattern: "configStore.*rateLimitPerMinute"
---

<objective>
Harden the RateLimiter class in server.ts to address two risks identified in RELEASE_HANDOFF.md (findings #3 and #4):
1. Rate limit value is captured once at construction and ignores runtime config changes via POST /api/settings.
2. The windows Map grows without bound under diverse-IP load because expired entries are never pruned.

Purpose: Eliminate stale-config and memory-leak risks so the rate limiter behaves correctly across config updates and long uptime under varied IP load.
Output: Updated RateLimiter class, new test file, updated docs.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@services/gateway-api/src/server.ts
@services/gateway-api/src/config-store.ts
@services/gateway-api/src/provider-rebuilder.test.ts (test pattern reference)
@RELEASE_HANDOFF.md (findings #3 and #4)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Harden RateLimiter with config refresh and eviction</name>
  <files>services/gateway-api/src/server.ts</files>
  <action>
Refactor the RateLimiter class in server.ts to address both RELEASE_HANDOFF findings:

**Config refresh (finding #3):**
- Change the constructor to accept a `ConfigStore` instead of a raw `maxPerMinute` number.
- In `check()`, read `this.configStore.get().server.rateLimitPerMinute` on every call instead of using the cached `this.maxPerMinute`. This is the simplest approach -- no onChange listener needed, matches how other config reads work (e.g., `deps.configStore.get()` in handleVoiceTurn).
- Remove the `private readonly maxPerMinute: number` field.

**Memory eviction (finding #4):**
- Add a `prune()` method that iterates the `windows` Map and deletes any entry where `Date.now() >= entry.resetAt`. This removes expired windows from IPs that stopped making requests.
- In the constructor, start a `setInterval(prune, 60_000)` with `.unref()` so it does not keep the process alive during shutdown. Store the interval handle as a private field.
- Add a `destroy()` method that calls `clearInterval` on the handle (for clean test teardown and graceful shutdown).
- Optionally add a hard cap: if `windows.size` exceeds 10_000 after a `check()`, call `prune()` eagerly. This prevents runaway growth between prune intervals during a burst of diverse IPs.

**Update createGatewayServer:**
- Change line 69 from `new RateLimiter(deps.configStore.get().server.rateLimitPerMinute)` to `new RateLimiter(deps.configStore)`.
- No other changes needed in route handlers -- they already call `rateLimiter.check(clientIp)` which will now read live config internally.

**Export the RateLimiter class** so it can be tested directly from server.test.ts. Add `export` to the class declaration.

Keep the class in server.ts (not a separate file) -- it is small and co-located with its only consumer.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run services/gateway-api/src/server.test.ts 2>/dev/null || echo "Tests will be created in Task 2"</automated>
    <manual>Review the RateLimiter class: constructor accepts ConfigStore, check() reads live config, prune() removes expired entries, destroy() cleans up interval.</manual>
  </verify>
  <done>RateLimiter reads live config on every check(), prunes expired entries on a 60s interval, has a destroy() method, and enforces a 10k hard cap.</done>
</task>

<task type="auto">
  <name>Task 2: Add focused RateLimiter tests and update docs</name>
  <files>services/gateway-api/src/server.test.ts, docs/security.md</files>
  <action>
**Create `services/gateway-api/src/server.test.ts`** with focused tests for the RateLimiter class. Follow the test pattern from `provider-rebuilder.test.ts` (Vitest, describe/it/expect, beforeEach cleanup). Use the same `makeTestConfig` fixture pattern.

Import `{ RateLimiter }` from `./server.js` and `{ ConfigStore }` from `./config-store.js`.

Tests to write:

1. **"allows requests within rate limit"** -- Create RateLimiter with limit=5, call check("ip1") 5 times, all return true.

2. **"rejects requests exceeding rate limit"** -- Create RateLimiter with limit=3, call check("ip1") 4 times, first 3 return true, 4th returns false.

3. **"tracks IPs independently"** -- Call check("ip1") up to limit, then check("ip2") should still return true.

4. **"reacts to config change for rateLimitPerMinute"** -- Create with limit=2, exhaust with check("ip1") x3 (3rd fails). Then update configStore: `configStore.update({ server: { rateLimitPerMinute: 10 } })`. Advance time past window reset (vi.advanceTimersByTime(61_000)). Call check("ip1") 10 times -- all pass. Call 11th -- fails. This proves the new limit is read live.

5. **"prune() removes expired entries"** -- Add entries for 3 IPs via check(). Advance time past 60s (vi.advanceTimersByTime(61_000)). Manually call rateLimiter.prune() (make it public or test via the auto-prune interval). Verify internal map size is 0 by calling check() on those IPs and verifying they all return true (fresh windows).

6. **"map does not grow unbounded under diverse IPs"** -- Call check() with 10_001 unique IPs with stale timestamps (use vi.setSystemTime to make the first batch expire). Verify that after a prune cycle the map size is bounded.

Use `vi.useFakeTimers()` in beforeEach and `vi.useRealTimers()` in afterEach. Call `rateLimiter.destroy()` in afterEach to clean up the interval.

**Update `docs/security.md`** in the Rate Limiting section (around line 69-76):
- Add a note that rate limit changes via POST /api/settings take effect immediately (no restart needed).
- Add a note that expired rate-limit windows are automatically pruned every 60 seconds to prevent memory growth.

Run the full test suite after writing tests.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npx vitest run</automated>
  </verify>
  <done>All RateLimiter tests pass (config refresh, eviction, bounds). Full test suite passes. Security docs updated with new behavior.</done>
</task>

</tasks>

<verification>
- `npx vitest run` -- all tests pass including new server.test.ts
- RateLimiter in server.ts no longer caches maxPerMinute -- reads from ConfigStore on each check()
- RateLimiter has prune interval and destroy method
- docs/security.md documents the new config-reactive and auto-prune behavior
</verification>

<success_criteria>
- RateLimiter.check() reads rateLimitPerMinute from ConfigStore on every call (no stale config)
- Expired entries are pruned every 60 seconds via setInterval().unref()
- destroy() method cleans up the interval
- Hard cap of 10k entries triggers eager prune
- 6 focused tests pass covering config refresh and map bounds
- Full test suite passes (no regressions)
- docs/security.md updated
</success_criteria>

<output>
After completion, create `.planning/quick/6-post-v1-hardening-pass-2-address-ratelim/6-SUMMARY.md`
</output>
