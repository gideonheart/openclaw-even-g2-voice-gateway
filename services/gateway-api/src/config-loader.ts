/**
 * Environment-based configuration loader for the gateway.
 *
 * Reads environment variables (or an injected env record) and produces
 * a fully-typed GatewayConfig with sensible defaults for every field.
 */

import type { GatewayConfig } from "@voice-gateway/shared-types";
import {
  createSessionKey,
  createProviderId,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";

// -- Env parsing helpers --

/** Parse an integer from a raw env string, returning `fallback` when unset/empty. */
function intOrDefault(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === "") return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) {
    throw new OperatorError(
      ErrorCodes.INVALID_CONFIG,
      `Invalid integer for ${name}`,
      `parseInt("${raw}", 10) returned NaN`,
    );
  }
  return n;
}

/** Like `intOrDefault` but also rejects zero and negative values. */
function positiveIntOrDefault(raw: string | undefined, fallback: number, name: string): number {
  const value = intOrDefault(raw, fallback, name);
  if (value <= 0) {
    throw new OperatorError(
      ErrorCodes.INVALID_CONFIG,
      `${name} must be positive`,
      `Got ${value}`,
    );
  }
  return value;
}

/** Read a string env var, falling back to `fallback` when unset/empty. */
function strOrDefault(raw: string | undefined, fallback: string): string {
  return raw ?? fallback;
}

/** Split a comma-separated env string into trimmed, non-empty tokens. */
function csvToArray(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve the OpenClaw upstream WebSocket URL via a 3-step fallback chain:
 * 1. Explicit OPENCLAW_GATEWAY_URL wins (operator override).
 * 2. OPENCLAW_GATEWAY_PORT (set by OpenClaw systemd) derives ws://127.0.0.1:{port}.
 * 3. Last resort: ws://localhost:3000 (matches .env.example default).
 */
function resolveOpenClawUrl(env: Record<string, string | undefined>): string {
  const explicit = env["OPENCLAW_GATEWAY_URL"];
  if (explicit !== undefined && explicit !== "") return explicit;
  const port = env["OPENCLAW_GATEWAY_PORT"];
  if (port !== undefined && port !== "") {
    const n = parseInt(port, 10);
    if (Number.isNaN(n) || n <= 0 || n > 65535) {
      throw new OperatorError(
        ErrorCodes.INVALID_CONFIG,
        "Invalid OPENCLAW_GATEWAY_PORT",
        `Expected a port number (1-65535), got "${port}"`,
      );
    }
    return `ws://127.0.0.1:${n}`;
  }
  return "ws://localhost:3000";
}

/** Load gateway configuration from environment variables. */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): GatewayConfig {
  return {
    openclawGatewayUrl: resolveOpenClawUrl(env),
    openclawGatewayToken: strOrDefault(env["OPENCLAW_GATEWAY_TOKEN"], ""),
    openclawSessionKey: createSessionKey(strOrDefault(env["OPENCLAW_SESSION_KEY"], "default")),
    sttProvider: createProviderId(strOrDefault(env["STT_PROVIDER"], "whisperx")),

    whisperx: {
      baseUrl: strOrDefault(env["WHISPERX_BASE_URL"], "https://wsp.kingdom.lv"),
      model: strOrDefault(env["WHISPERX_MODEL"], "medium"),
      language: strOrDefault(env["WHISPERX_LANGUAGE"], "en"),
      pollIntervalMs: positiveIntOrDefault(env["WHISPERX_POLL_INTERVAL_MS"], 3000, "WHISPERX_POLL_INTERVAL_MS"),
      timeoutMs: positiveIntOrDefault(env["WHISPERX_TIMEOUT_MS"], 300_000, "WHISPERX_TIMEOUT_MS"),
    },

    openai: {
      apiKey: strOrDefault(env["OPENAI_API_KEY"], ""),
      model: strOrDefault(env["OPENAI_STT_MODEL"], "whisper-1"),
      language: strOrDefault(env["OPENAI_STT_LANGUAGE"], "en"),
    },

    customHttp: {
      url: strOrDefault(env["CUSTOM_STT_URL"], ""),
      authHeader: strOrDefault(env["CUSTOM_STT_AUTH"], ""),
      requestMapping: {},
      responseMapping: {
        textField: strOrDefault(env["CUSTOM_STT_TEXT_FIELD"], "text"),
        languageField: strOrDefault(env["CUSTOM_STT_LANGUAGE_FIELD"], "language"),
        confidenceField: strOrDefault(env["CUSTOM_STT_CONFIDENCE_FIELD"], "confidence"),
      },
    },

    server: {
      port: intOrDefault(env["PORT"], 4400, "PORT"),
      host: strOrDefault(env["HOST"], "0.0.0.0"),
      corsOrigins: csvToArray(env["CORS_ORIGINS"]),
      allowNullOrigin: (strOrDefault(env["CORS_ALLOW_NULL_ORIGIN"], "")).toLowerCase() === "true",
      maxAudioBytes: positiveIntOrDefault(env["MAX_AUDIO_BYTES"], 25 * 1024 * 1024, "MAX_AUDIO_BYTES"),
      rateLimitPerMinute: positiveIntOrDefault(env["RATE_LIMIT_PER_MINUTE"], 60, "RATE_LIMIT_PER_MINUTE"),
    },
  };
}
