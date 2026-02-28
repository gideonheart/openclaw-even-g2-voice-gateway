/**
 * Branded types for critical identifiers.
 * Prevents accidental misuse of string values across different domains.
 */

declare const __brand: unique symbol;

/** A branded type — structurally a string but nominally distinct. */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Unique identifier for a voice turn (correlation ID). */
export type TurnId = Brand<string, "TurnId">;

/** OpenClaw session key. */
export type SessionKey = Brand<string, "SessionKey">;

/** STT provider identifier. */
export type ProviderId = Brand<string, "ProviderId">;

// ── Constructors (runtime validation + branding) ──

/** Create a TurnId from a string. Format: `turn_<uuid-fragment>` */
export function createTurnId(id?: string): TurnId {
  const value =
    id ?? `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return value as TurnId;
}

/** Brand a validated session key string. */
export function createSessionKey(key: string): SessionKey {
  if (key.length === 0) {
    throw new TypeError("SessionKey cannot be empty");
  }
  return key as SessionKey;
}

/** Brand a validated provider ID string. */
export function createProviderId(id: string): ProviderId {
  const valid = ["whisperx", "openai", "custom"] as const;
  if (!(valid as readonly string[]).includes(id)) {
    throw new TypeError(
      `Invalid ProviderId: "${id}". Must be one of: ${valid.join(", ")}`,
    );
  }
  return id as ProviderId;
}

/** Known provider IDs as branded constants. */
export const ProviderIds = {
  WhisperX: "whisperx" as ProviderId,
  OpenAI: "openai" as ProviderId,
  Custom: "custom" as ProviderId,
} as const;
