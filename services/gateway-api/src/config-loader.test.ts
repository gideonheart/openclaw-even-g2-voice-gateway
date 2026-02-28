import { describe, it, expect } from "vitest";
import { loadConfig } from "./config-loader.js";
import { OperatorError, ErrorCodes } from "@voice-gateway/shared-types";

describe("loadConfig", () => {
  it("uses defaults when no env vars set", () => {
    const config = loadConfig({});
    expect(config.openclawGatewayUrl).toBe("ws://localhost:3000");
    expect(config.sttProvider).toBe("whisperx");
    expect(config.server.port).toBe(4400);
    expect(config.server.host).toBe("0.0.0.0");
    expect(config.whisperx.model).toBe("medium");
  });

  it("reads env vars", () => {
    const config = loadConfig({
      OPENCLAW_GATEWAY_URL: "ws://custom:5000",
      OPENCLAW_GATEWAY_TOKEN: "secret-token",
      OPENCLAW_SESSION_KEY: "my-session",
      STT_PROVIDER: "openai",
      PORT: "8080",
      CORS_ORIGINS: "http://localhost:3001,http://example.com",
    });

    expect(config.openclawGatewayUrl).toBe("ws://custom:5000");
    expect(config.openclawGatewayToken).toBe("secret-token");
    expect(config.openclawSessionKey).toBe("my-session");
    expect(config.sttProvider).toBe("openai");
    expect(config.server.port).toBe(8080);
    expect(config.server.corsOrigins).toEqual([
      "http://localhost:3001",
      "http://example.com",
    ]);
  });

  it("parses WhisperX config", () => {
    const config = loadConfig({
      WHISPERX_BASE_URL: "https://custom-whisperx.local",
      WHISPERX_MODEL: "large-v3",
      WHISPERX_LANGUAGE: "lv",
      WHISPERX_POLL_INTERVAL_MS: "5000",
      WHISPERX_TIMEOUT_MS: "600000",
    });

    expect(config.whisperx.baseUrl).toBe("https://custom-whisperx.local");
    expect(config.whisperx.model).toBe("large-v3");
    expect(config.whisperx.language).toBe("lv");
    expect(config.whisperx.pollIntervalMs).toBe(5000);
    expect(config.whisperx.timeoutMs).toBe(600000);
  });

  it("parses OpenAI config", () => {
    const config = loadConfig({
      OPENAI_API_KEY: "sk-test-key",
      OPENAI_STT_MODEL: "whisper-1",
    });

    expect(config.openai.apiKey).toBe("sk-test-key");
    expect(config.openai.model).toBe("whisper-1");
  });

  it("parses custom HTTP config", () => {
    const config = loadConfig({
      CUSTOM_STT_URL: "https://custom-stt.local/transcribe",
      CUSTOM_STT_AUTH: "Bearer custom-token",
      CUSTOM_STT_TEXT_FIELD: "result.text",
    });

    expect(config.customHttp.url).toBe(
      "https://custom-stt.local/transcribe",
    );
    expect(config.customHttp.authHeader).toBe("Bearer custom-token");
    expect(config.customHttp.responseMapping.textField).toBe("result.text");
  });

  it("handles empty CORS_ORIGINS", () => {
    const config = loadConfig({ CORS_ORIGINS: "" });
    expect(config.server.corsOrigins).toEqual([]);
  });

  it("throws on invalid provider", () => {
    expect(() =>
      loadConfig({ STT_PROVIDER: "invalid" }),
    ).toThrow("Invalid ProviderId");
  });

  it("throws on non-numeric PORT", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(OperatorError);
    try {
      loadConfig({ PORT: "abc" });
    } catch (err) {
      expect(err).toBeInstanceOf(OperatorError);
      expect((err as OperatorError).code).toBe(ErrorCodes.INVALID_CONFIG);
    }
  });

  it("throws on non-numeric WHISPERX_POLL_INTERVAL_MS", () => {
    expect(() =>
      loadConfig({ WHISPERX_POLL_INTERVAL_MS: "not-a-number" }),
    ).toThrow(OperatorError);
    try {
      loadConfig({ WHISPERX_POLL_INTERVAL_MS: "not-a-number" });
    } catch (err) {
      expect(err).toBeInstanceOf(OperatorError);
      expect((err as OperatorError).code).toBe(ErrorCodes.INVALID_CONFIG);
    }
  });
});
