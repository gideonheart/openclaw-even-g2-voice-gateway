# Shared-Secret Scope-Retention Fix -- Final Handoff

## Problem

The OpenClaw server unconditionally stripped scopes for WebSocket connections lacking device identity, except for Control UI bypass clients. The Even G2 voice gateway connects as a shared-secret backend client without device identity, so its requested `operator.admin` scope was silently cleared. This caused `chat.send` to fail with "missing scope: operator.write".

## Fix

| Repo | Commit | Description |
|------|--------|-------------|
| openclaw | `4d1fb3e9f` | Adds `!sharedAuthOk` guard to scope-stripping condition (`message-handler.ts` line 422) |
| openclaw | `801fa7fe8` | Replaces "ignores scopes" test with "retains scopes for shared-secret" + adds "rejects unauthenticated" test |
| voice-gateway | `862148e` | Removes root-level nonce from ConnectParams to fix WS 1008 rejection |

## Files Changed

- `/home/forge/openclaw/src/gateway/server/ws-connection/message-handler.ts` (line 422: added `!sharedAuthOk` to scope-stripping condition)
- `/home/forge/openclaw/src/gateway/server.auth.e2e.test.ts` (new scope-retention + unauthenticated-rejection tests)
- `/home/forge/openclaw-even-g2-voice-gateway/src/openclaw/client.ts` (removed root-level nonce from ConnectParams)

## Tests

223/223 pass (192 voice-gateway + 31 OpenClaw auth e2e). Zero failures.

- Voice-gateway: `npx vitest run` -- 192/192 pass
- OpenClaw auth e2e: `npx vitest run --config vitest.e2e.config.ts src/gateway/server.auth.e2e.test.ts` -- 31/31 pass

## Security Audit

5/5 checks pass. Full audit in `../15-self-review-last-commits-for-shared-secr/security-audit.md`.

| Check | Result |
|-------|--------|
| sharedAuthOk derivation cannot be spoofed | PASS |
| Three-way exemption interaction safe | PASS |
| Unauthenticated rejection path correct | PASS |
| Password-auth scope retention correct | PASS |
| mode "none" prevents unauthorized scopes | PASS |

`sharedAuthOk` can only be true when the client presents a valid token or password verified by `safeEqualSecret` (constant-time comparison). No privilege escalation possible.

## Status

**Complete.** No open tasks, no open debug issues, no unpushed code changes.

- Working tree: clean
- Unpushed commits: 9 planning/docs commits from quick-13 through quick-16 (no code changes)
- Debug files: 2/2 resolved (`openclaw-scope-operator-write.md`, `openclaw-ws-nonce-e2e-verify.md`)
- Pending todos: None
