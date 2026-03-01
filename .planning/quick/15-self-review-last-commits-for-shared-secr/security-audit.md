# Security Audit: sharedAuthOk Scope Guard (Commit 4d1fb3e9f)

Date: 2026-03-01
Auditor: Claude (self-review)
Scope: message-handler.ts scope-stripping condition at line 422, auth.ts authorizeGatewayConnect

## Check 1: sharedAuthOk Derivation Cannot Be Spoofed

**PASS**

**Lines:** message-handler.ts 379-392, auth.ts 394-424

The `sharedAuthOk` flag requires ALL of:
1. `hasSharedAuth` = client sent `auth.token` or `auth.password` (lines 336-338)
2. `sharedAuthResult` = server-side `authorizeGatewayConnect` returns `{ ok: true }` (lines 380-388)
3. `sharedAuthResult.method` is `"token"` or `"password"` (line 392)

`authorizeGatewayConnect` validates credentials server-side:
- Token mode: `safeEqualSecret(connectAuth.token, auth.token)` (auth.ts line 402) -- constant-time comparison against server's configured secret
- Password mode: `safeEqualSecret(password, auth.password)` (auth.ts line 419) -- same

A malicious client CANNOT forge `sharedAuthOk = true` because:
- Credentials are validated server-side against server config
- `safeEqualSecret` prevents timing attacks
- Method check excludes "tailscale", "none", "trusted-proxy" (only "token"/"password")
- `allowTailscale: false` on the sharedAuthResult call (line 381) prevents tailscale-only auth from qualifying
- If auth mode is "none", authorizeGatewayConnect returns method "none" which fails the method check

## Check 2: Three-Way Exemption Interaction Is Safe

**PASS**

**Lines:** message-handler.ts 422, 622-623

Condition at line 422:
```typescript
if (scopes.length > 0 && !allowControlUiBypass && !sharedAuthOk)
```

- `allowControlUiBypass` (line 343): only true for Control UI clients with explicit config flags (`allowInsecureAuth` or `dangerouslyDisableDeviceAuth`)
- `sharedAuthOk`: only true for valid shared-secret auth

Both CAN be true simultaneously (Control UI + valid token + insecureAuth). This is correct: the client has BOTH bypass permission AND valid credentials.

Line 622: `const skipPairing = allowControlUiBypass && sharedAuthOk`
- Only reached when `device` is present (line 623 checks `if (device && devicePublicKey && !skipPairing)`)
- For deviceless connections, execution exits at line 446 or earlier, never reaching line 622
- No interaction between scope fix and pairing skip for the voice-gateway use case

## Check 3: Unauthenticated Connection Rejection Path

**PASS**

**Lines:** message-handler.ts 421-446, test line 375

When client sends no auth + no device:
1. `hasSharedAuth = false` (no token/password)
2. `sharedAuthResult = null` (ternary at line 379)
3. `sharedAuthOk = false`
4. `authOk = false` (authorizeGatewayConnect fails for token_missing)
5. Line 422: scopes stripped (moot since connection is rejected)
6. Line 426: `canSkipDevice = false`
7. Line 437-445: Rejected with "device identity required" (NOT_PAIRED error code)

Connection is rejected at the device-required gate, before any operations are possible.
The test at line 375 asserts `res.error?.message` contains "device identity required" matching line 443.

## Check 4: Password-Auth Scope Retention

**PASS**

**Lines:** message-handler.ts 392, auth.ts 410-424

`sharedAuthOk` is true for `method === "password"`. Password auth uses `safeEqualSecret` against the server's configured password -- functionally equivalent to token auth. A client that proves knowledge of the shared password should retain its requested scopes.

No dedicated test exists for password + deviceless scope retention, but the code path is identical to token auth (both produce sharedAuthOk=true via the same check at line 392). The token auth test at line 362 covers the shared logic.

## Check 5: mode "none" Prevents Unauthorized Scope Claims

**PASS**

**Lines:** auth.ts 359-361, message-handler.ts 390-392

With `resolvedAuth.mode === "none"`:
- `authorizeGatewayConnect` returns `{ ok: true, method: "none" }`
- `sharedAuthOk` requires method "token" or "password" -- "none" fails this check
- Scopes ARE stripped for mode "none" + no device (correct behavior)
- Connection is rejected at line 442 (device identity required)

Even with mode "none", deviceless connections cannot self-declare scopes.

## Summary

All 5 security checks PASS. No privilege escalation possible via the !sharedAuthOk guard.
The fix is narrowly scoped: it only exempts connections that provably authenticated via the server's shared secret.
All other auth methods (tailscale, none, trusted-proxy) and unauthenticated clients are unaffected.
