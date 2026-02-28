/**
 * Configuration loader — reads from environment variables.
 */

import type { GatewayConfig } from "@voice-gateway/shared-types";
import {
  createSessionKey,
  createProviderId,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";

/**
 * NaN-safe parseInt wrapper. Returns defaultVal when raw is undefined/empty.
 * Throws OperatorError(INVALID_CONFIG) when the parsed result is NaN.
 */
function safeParseInt(
  raw: string | undefined,
  defaultVal: number,
  fieldName: string,
): number {
  if (raw === undefined || raw === "") return defaultVal;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new OperatorError(
      ErrorCodes.INVALID_CONFIG,
      `Invalid integer for ${fieldName}`,
      `parseInt("${raw}", 10) returned NaN`,
    );
  }
  return parsed;
}

/**
 * NaN-safe parseInt that also enforces the value is positive (> 0).
 * Throws OperatorError(INVALID_CONFIG) when NaN or non-positive.
 */
function safeParsePositiveInt(
  raw: string | undefined,
  defaultVal: number,
  fieldName: string,
): number {
  const value = safeParseInt(raw, defaultVal, fieldName);
  if (value <= 0) {
    throw new OperatorError(
      ErrorCodes.INVALID_CONFIG,
      `${fieldName} must be positive`,
      `Got ${value}`,
    );
  }
  return value;
}

/** Load gateway configuration from environment variables. */
export function loadConfig(env: Record<string, string | undefined> = process.env): GatewayConfig {
  return {
    openclawGatewayUrl: env["OPENCLAW_GATEWAY_URL"] ?? "ws://localhost:3000",
    openclawGatewayToken: env["OPENCLAW_GATEWAY_TOKEN"] ?? "",
    openclawSessionKey: createSessionKey(
      env["OPENCLAW_SESSION_KEY"] ?? "default",
    ),
    sttProvider: createProviderId(env["STT_PROVIDER"] ?? "whisperx"),
    whisperx: {
      baseUrl: env["WHISPERX_BASE_URL"] ?? "https://wsp.kingdom.lv",
      model: env["WHISPERX_MODEL"] ?? "medium",
      language: env["WHISPERX_LANGUAGE"] ?? "en",
      pollIntervalMs: safeParsePositiveInt(env["WHISPERX_POLL_INTERVAL_MS"], 3000, "WHISPERX_POLL_INTERVAL_MS"),
      timeoutMs: safeParsePositiveInt(env["WHISPERX_TIMEOUT_MS"], 300000, "WHISPERX_TIMEOUT_MS"),
    },
    openai: {
      apiKey: env["OPENAI_API_KEY"] ?? "",
      model: env["OPENAI_STT_MODEL"] ?? "whisper-1",
      language: env["OPENAI_STT_LANGUAGE"] ?? "en",
    },
    customHttp: {
      url: env["CUSTOM_STT_URL"] ?? "",
      authHeader: env["CUSTOM_STT_AUTH"] ?? "",
      requestMapping: {},
      responseMapping: {
        textField: env["CUSTOM_STT_TEXT_FIELD"] ?? "text",
        languageField: env["CUSTOM_STT_LANGUAGE_FIELD"] ?? "language",
        confidenceField: env["CUSTOM_STT_CONFIDENCE_FIELD"] ?? "confidence",
      },
    },
    server: {
      port: safeParseInt(env["PORT"], 4400, "PORT"),
      host: env["HOST"] ?? "0.0.0.0",
      corsOrigins: (env["CORS_ORIGINS"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      maxAudioBytes: safeParsePositiveInt(
        env["MAX_AUDIO_BYTES"],
        25 * 1024 * 1024,
        "MAX_AUDIO_BYTES",
      ),
      rateLimitPerMinute: safeParsePositiveInt(
        env["RATE_LIMIT_PER_MINUTE"],
        60,
        "RATE_LIMIT_PER_MINUTE",
      ),
    },
  };
}
