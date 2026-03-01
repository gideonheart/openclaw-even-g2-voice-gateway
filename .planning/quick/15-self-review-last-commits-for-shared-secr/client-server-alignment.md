# Client/Server Alignment: Voice-Gateway <-> OpenClaw

Date: 2026-03-01

## Connect Params Sent by Voice-Gateway Client

From `openclaw-client.ts` sendConnectFrame (lines 385-401):

```typescript
{
  minProtocol: 3,
  maxProtocol: 3,
  client: {
    id: "gateway-client",
    displayName: "Even G2 Voice Gateway",
    version: "1.0.0",
    platform: process.platform,
    mode: "backend",
  },
  caps: [],
  role: "operator",
  scopes: ["operator.admin"],
  auth: { token: "<configured authToken>" },
  // NO device field
  // NO root-level nonce (removed in commit 862148e)
}
```

## Server Code Path Trace

Tracing through message-handler.ts for the exact frame above:

| Step | Line | Variable | Value | Explanation |
|------|------|----------|-------|-------------|
| 1 | 334 | deviceRaw | undefined | No device field in params |
| 2 | 336 | hasTokenAuth | true | auth.token is set |
| 3 | 338 | hasSharedAuth | true | hasTokenAuth is true |
| 4 | 347 | authResult | { ok: true, method: "token" } | Token matches server's shared secret |
| 5 | 376 | authOk | true | Primary auth succeeded |
| 6 | 379-388 | sharedAuthResult | { ok: true, method: "token" } | Re-verified with allowTailscale:false |
| 7 | 390-392 | sharedAuthOk | true | ok=true AND method="token" |
| 8 | 421 | !device | true | No device |
| 9 | 422 | scope check | `true && true && false` = false | !sharedAuthOk is false -> scopes RETAINED |
| 10 | 426 | canSkipDevice | true | = sharedAuthOk |
| 11 | 437 | !canSkipDevice | false | Does NOT reject |
| 12 | 617 | authOk | true | Does NOT reject unauthorized |
| 13 | -- | result | hello-ok | Connection succeeds with operator.admin scope |

## Outcome

The voice-gateway client's connect params align perfectly with the fixed server behavior:
- Scopes retained via !sharedAuthOk guard (line 422)
- Device skip allowed via canSkipDevice = sharedAuthOk (line 426)
- Connection succeeds with full operator.admin scope

## Mock/Reality Assessment

### openclaw-client.test.ts mocks (acceptable)
- Validates auth token when configured (simplified, not safeEqualSecret)
- Validates connect-first protocol requirement
- Schema compliance tests verify no unknown properties in connect params
- Chat.send protocol flow matches real server

### voice-turn.test.ts mocks (acceptable)
- Full protocol: connect.challenge -> connect -> hello-ok -> chat.send -> chat event
- Does not enforce auth token (simplified for integration scope)
- Auth coverage is handled by openclaw-client.test.ts unit tests

### Known gaps (low risk)
- Mocks don't enforce device identity or scope validation (not needed for backend client)
- Mocks don't use safeEqualSecret (timing attack defense not relevant for test)

## Test Results

- Voice-gateway: 192/192 pass (19 test files)
- OpenClaw auth e2e: 31/31 pass (1 test file)
- Total: 223/223 pass
