/**
 * Configuration loader — reads from environment variables.
 */

import type { GatewayConfig } from "@voice-gateway/shared-types";
import { createSessionKey, createProviderId } from "@voice-gateway/shared-types";

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
      pollIntervalMs: parseInt(env["WHISPERX_POLL_INTERVAL_MS"] ?? "3000", 10),
      timeoutMs: parseInt(env["WHISPERX_TIMEOUT_MS"] ?? "300000", 10),
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
      port: parseInt(env["PORT"] ?? "4400", 10),
      host: env["HOST"] ?? "0.0.0.0",
      corsOrigins: (env["CORS_ORIGINS"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      maxAudioBytes: parseInt(
        env["MAX_AUDIO_BYTES"] ?? String(25 * 1024 * 1024),
        10,
      ),
      rateLimitPerMinute: parseInt(
        env["RATE_LIMIT_PER_MINUTE"] ?? "60",
        10,
      ),
    },
  };
}
