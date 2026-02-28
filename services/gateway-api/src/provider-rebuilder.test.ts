import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerProviderRebuilder } from "./provider-rebuilder.js";
import { ConfigStore } from "./config-store.js";
import { Logger } from "@voice-gateway/logging";
import { ProviderIds } from "@voice-gateway/shared-types";
import type { GatewayConfig } from "@voice-gateway/shared-types";
import type { SttProvider } from "@voice-gateway/stt-contract";
import { createProviderId, createSessionKey } from "@voice-gateway/shared-types";

// ── Mock all three provider packages ──

vi.mock("@voice-gateway/stt-whisperx", () => ({
  WhisperXProvider: vi.fn().mockImplementation(() => ({
    providerId: ProviderIds.WhisperX,
    name: "WhisperX (mock)",
  })),
}));

vi.mock("@voice-gateway/stt-openai", () => ({
  OpenAIProvider: vi.fn().mockImplementation(() => ({
    providerId: ProviderIds.OpenAI,
    name: "OpenAI (mock)",
  })),
}));

vi.mock("@voice-gateway/stt-custom-http", () => ({
  CustomHttpProvider: vi.fn().mockImplementation(() => ({
    providerId: ProviderIds.Custom,
    name: "Custom HTTP (mock)",
  })),
}));

import { WhisperXProvider } from "@voice-gateway/stt-whisperx";
import { OpenAIProvider } from "@voice-gateway/stt-openai";
import { CustomHttpProvider } from "@voice-gateway/stt-custom-http";

/** Minimal valid GatewayConfig fixture. */
function makeTestConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    openclawGatewayUrl: "ws://localhost:3000",
    openclawGatewayToken: "secret-token-123",
    openclawSessionKey: createSessionKey("test-session"),
    sttProvider: createProviderId("whisperx"),
    whisperx: {
      baseUrl: "https://wsp.kingdom.lv",
      model: "medium",
      language: "en",
      pollIntervalMs: 3000,
      timeoutMs: 300000,
    },
    openai: {
      apiKey: "sk-test-key",
      model: "whisper-1",
      language: "en",
    },
    customHttp: {
      url: "https://custom-stt.local",
      authHeader: "Bearer custom-token",
      requestMapping: {},
      responseMapping: {
        textField: "text",
        languageField: "language",
        confidenceField: "confidence",
      },
    },
    server: {
      port: 4400,
      host: "0.0.0.0",
      corsOrigins: [],
      maxAudioBytes: 25 * 1024 * 1024,
      rateLimitPerMinute: 60,
    },
    ...overrides,
  };
}

describe("registerProviderRebuilder", () => {
  let configStore: ConfigStore;
  let sttProviders: Map<string, SttProvider>;
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    configStore = new ConfigStore(makeTestConfig());
    sttProviders = new Map<string, SttProvider>();
    // Seed with sentinel providers so we can verify they get replaced
    sttProviders.set(ProviderIds.WhisperX, { providerId: ProviderIds.WhisperX, name: "old-whisperx" } as any);
    sttProviders.set(ProviderIds.OpenAI, { providerId: ProviderIds.OpenAI, name: "old-openai" } as any);
    sttProviders.set(ProviderIds.Custom, { providerId: ProviderIds.Custom, name: "old-custom" } as any);
    logger = new Logger();
    registerProviderRebuilder(configStore, sttProviders, logger);
  });

  it("replaces WhisperX provider when whisperx config changes", () => {
    configStore.update({ whisperx: { baseUrl: "http://new-whisperx" } });

    expect(WhisperXProvider).toHaveBeenCalledOnce();
    const provider = sttProviders.get(ProviderIds.WhisperX);
    expect(provider?.name).toBe("WhisperX (mock)");
  });

  it("replaces OpenAI provider when openai config changes", () => {
    configStore.update({ openai: { apiKey: "sk-new-key" } });

    expect(OpenAIProvider).toHaveBeenCalledOnce();
    const provider = sttProviders.get(ProviderIds.OpenAI);
    expect(provider?.name).toBe("OpenAI (mock)");
  });

  it("replaces Custom HTTP provider when customHttp config changes", () => {
    configStore.update({ customHttp: { url: "https://new-stt.local" } });

    expect(CustomHttpProvider).toHaveBeenCalledOnce();
    const provider = sttProviders.get(ProviderIds.Custom);
    expect(provider?.name).toBe("Custom HTTP (mock)");
  });

  it("does not rebuild any provider when only sttProvider selector changes", () => {
    configStore.update({ sttProvider: createProviderId("openai") });

    expect(WhisperXProvider).not.toHaveBeenCalled();
    expect(OpenAIProvider).not.toHaveBeenCalled();
    expect(CustomHttpProvider).not.toHaveBeenCalled();

    // Sentinel providers still in place
    expect(sttProviders.get(ProviderIds.WhisperX)?.name).toBe("old-whisperx");
    expect(sttProviders.get(ProviderIds.OpenAI)?.name).toBe("old-openai");
    expect(sttProviders.get(ProviderIds.Custom)?.name).toBe("old-custom");
  });

  it("rebuilds multiple providers when patch includes multiple sections", () => {
    configStore.update({
      whisperx: { model: "large" },
      openai: { model: "whisper-2" },
    });

    expect(WhisperXProvider).toHaveBeenCalledOnce();
    expect(OpenAIProvider).toHaveBeenCalledOnce();
    expect(CustomHttpProvider).not.toHaveBeenCalled();

    expect(sttProviders.get(ProviderIds.WhisperX)?.name).toBe("WhisperX (mock)");
    expect(sttProviders.get(ProviderIds.OpenAI)?.name).toBe("OpenAI (mock)");
    expect(sttProviders.get(ProviderIds.Custom)?.name).toBe("old-custom");
  });

  it("passes fully merged config to provider constructors", () => {
    configStore.update({ whisperx: { model: "large" } });

    // Constructor should receive the fully merged whisperx config
    const ctorCall = (WhisperXProvider as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ctorCall[0]).toEqual({
      baseUrl: "https://wsp.kingdom.lv",
      model: "large",
      language: "en",
      pollIntervalMs: 3000,
      timeoutMs: 300000,
    });
  });
});
