---
phase: quick-18
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .env
autonomous: true
requirements: []

must_haves:
  truths:
    - "Gateway startup pre-checks pass or exact failure reason is documented"
    - "WhisperX endpoint reachability is verified with evidence"
    - "OpenClaw WebSocket reachability is verified with evidence"
    - ".env contains correct local defaults for reachable services"
  artifacts:
    - path: ".env"
      provides: "Correct endpoint configuration"
      contains: "OPENCLAW_GATEWAY_URL"
  key_links:
    - from: ".env"
      to: "services/gateway-api/src/config-loader.ts"
      via: "process.env reads"
      pattern: "OPENCLAW_GATEWAY_URL|WHISPERX_BASE_URL"
---

<objective>
Investigate and resolve the gateway startup blocker by systematically verifying each external dependency, patching config where needed, and providing definitive pass/fail evidence.

Purpose: The gateway process.exit(1)s when either STT or OpenClaw health checks fail at startup. We need to identify which check(s) fail, why, fix what we can, and document what remains external.

Output: Working gateway startup OR exact failure evidence with documented next actions.
</objective>

<execution_context>
@/home/forge/.claude/get-shit-done/workflows/execute-plan.md
@/home/forge/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.env
@services/gateway-api/src/index.ts
@services/gateway-api/src/config-loader.ts
@packages/openclaw-client/src/openclaw-client.ts
@packages/stt-whisperx/src/whisperx-provider.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Probe external dependencies and inspect effective config</name>
  <files>.env</files>
  <action>
    Systematically verify each external dependency the gateway needs at startup:

    1. **Inspect effective config:** Read `.env` and confirm what `config-loader.ts` would produce. Document:
       - `OPENCLAW_GATEWAY_URL` = `ws://127.0.0.1:3434` (the OpenClaw WS endpoint)
       - `STT_PROVIDER` = `whisperx`
       - `WHISPERX_BASE_URL` = `https://wsp.kingdom.lv` (the WhisperX health check target)

    2. **Check OpenClaw reachability:**
       - Run `openclaw status` (or `openclaw --version`) to see if the OpenClaw CLI/server is installed and running locally.
       - Attempt a raw WebSocket connection to `ws://127.0.0.1:3434` using a one-liner: `node -e "const ws = new (require('ws'))('ws://127.0.0.1:3434'); ws.on('open', () => { console.log('CONNECTED'); ws.close(); }); ws.on('error', e => { console.log('FAIL:', e.message); process.exit(1); }); setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 5000);"` (or equivalent with bun).
       - If `ws://127.0.0.1:3434` fails, also probe common OpenClaw ports: 3000, 3434, 8080.
       - Record exact error messages.

    3. **Check WhisperX reachability:**
       - `curl -sS -o /dev/null -w "%{http_code}" --max-time 5 https://wsp.kingdom.lv/health` — this is exactly what the WhisperX provider's `healthCheck()` calls.
       - If it fails, try alternate local WhisperX URLs: `http://localhost:9000/health`, `http://127.0.0.1:9000/health`.
       - Record exact response code and body (or error).

    4. **Patch `.env` if needed:**
       - If OpenClaw is running on a different port, update `OPENCLAW_GATEWAY_URL`.
       - If WhisperX is reachable at a different URL, update `WHISPERX_BASE_URL`.
       - If neither service is running locally and cannot be started, leave `.env` as-is and document.

    5. **Document findings** clearly: for each service, record reachable (yes/no), URL tested, response/error.
  </action>
  <verify>
    <automated>curl -sS -w "\nHTTP_CODE:%{http_code}" --max-time 5 https://wsp.kingdom.lv/health 2>&1; echo "---"; timeout 5 bash -c 'echo | nc -w 3 127.0.0.1 3434 && echo "PORT_3434:OPEN" || echo "PORT_3434:CLOSED"' 2>&1 || echo "PORT_3434:CLOSED"</automated>
    <manual>Review output: HTTP 200 from WhisperX = healthy; PORT_3434:OPEN = OpenClaw listening</manual>
  </verify>
  <done>Each external dependency has a documented reachable/unreachable status with exact evidence. .env is patched if corrections were found.</done>
</task>

<task type="auto">
  <name>Task 2: Attempt gateway startup and report pass/fail evidence</name>
  <files></files>
  <action>
    With the (potentially patched) `.env`, attempt to start the gateway and capture the outcome:

    1. **Build the project** (TypeScript must compile first):
       - `cd /home/forge/openclaw-even-g2-voice-gateway && npm run build`
       - If build fails, capture and report the error.

    2. **Start the gateway with timeout capture:**
       - Run `cd /home/forge/openclaw-even-g2-voice-gateway/services/gateway-api && timeout 35 node dist/index.js 2>&1` (35s because the startup timeout is 30s internally).
       - Capture ALL stdout/stderr output.

    3. **Interpret the result:**
       - If exit code 0 and log shows "Gateway API started" -> PASS.
       - If exit code 1 and log shows "Startup pre-check failed" -> FAIL with `{ stt: {...}, openclaw: {...} }` details.
       - If exit code 1 and log shows "Fatal startup error" -> config or import error.

    4. **If startup passed**, verify the health endpoint:
       - In a separate terminal/background: `curl -sS http://localhost:4400/healthz`
       - Then kill the gateway process.

    5. **Produce a clear verdict:**
       - PASS: "Gateway starts successfully. Both pre-checks pass."
       - PARTIAL: "Gateway fails because [service X] is unreachable. [Service Y] is fine. Next action: [start/configure X]."
       - FAIL: "Both services unreachable. Next actions: [list]."

    Do NOT attempt to start OpenClaw or WhisperX servers -- just document what is needed.
  </action>
  <verify>
    <automated>cd /home/forge/openclaw-even-g2-voice-gateway && npm run build 2>&1 | tail -5</automated>
    <manual>Check build output for errors. Then review gateway startup logs for pass/fail evidence.</manual>
  </verify>
  <done>Gateway startup attempt completed with exact pass/fail evidence. If failed, the specific failing pre-check(s) are identified with error messages and the concrete next required action is stated.</done>
</task>

</tasks>

<verification>
- .env inspected and documented
- OpenClaw WS reachability tested with evidence
- WhisperX /health reachability tested with evidence
- Gateway build succeeds (TypeScript compiles)
- Gateway startup attempted with full log capture
- Clear pass/fail verdict with next action if failed
</verification>

<success_criteria>
The investigation produces a definitive answer: either the gateway starts (with /healthz proof) or it fails with exact identification of which pre-check(s) fail, the root cause (service not running, wrong URL, auth rejection, etc.), and the concrete next step to resolve each blocker.
</success_criteria>

<output>
After completion, create `.planning/quick/18-investigate-and-resolve-startup-blocker/18-SUMMARY.md`
</output>
