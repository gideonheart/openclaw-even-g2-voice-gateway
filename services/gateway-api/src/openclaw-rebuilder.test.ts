import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerOpenClawRebuilder } from "./openclaw-rebuilder.js";
import { ConfigStore } from "./config-store.js";
import { Logger } from "@voice-gateway/logging";
import type { GatewayConfig } from "@voice-gateway/shared-types";
import { createProviderId, createSessionKey } from "@voice-gateway/shared-types";

// ── Mock the OpenClaw client package ──

const mockDisconnect = vi.fn();

vi.mock("@voice-gateway/openclaw-client", () => ({
  OpenClawClient: vi.fn().mockImplementation(() => ({
    disconnect: vi.fn(),
    connect: vi.fn(),
    sendTranscript: vi.fn(),
    healthCheck: vi.fn(),
    isConnected: vi.fn(),
  })),
}));

import { OpenClawClient } from "@voice-gateway/openclaw-client";

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

describe("registerOpenClawRebuilder", () => {
  let configStore: ConfigStore;
  let deps: { openclawClient: any };
  let logger: Logger;
  let originalClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    configStore = new ConfigStore(makeTestConfig());

    originalClient = {
      disconnect: vi.fn(),
      connect: vi.fn(),
      sendTranscript: vi.fn(),
      healthCheck: vi.fn(),
      isConnected: vi.fn(),
    };

    deps = { openclawClient: originalClient };
    logger = new Logger();
    registerOpenClawRebuilder(configStore, deps, logger);
  });

  it("rebuilds OpenClaw client when openclawGatewayUrl changes", () => {
    configStore.update({ openclawGatewayUrl: "ws://new-url:3000" });

    // Old client should be disconnected
    expect(originalClient.disconnect).toHaveBeenCalledOnce();

    // New client should have been created
    expect(OpenClawClient).toHaveBeenCalledOnce();

    // deps.openclawClient should be the new instance
    expect(deps.openclawClient).not.toBe(originalClient);
  });

  it("rebuilds OpenClaw client when openclawGatewayToken changes", () => {
    configStore.update({ openclawGatewayToken: "new-token" });

    expect(originalClient.disconnect).toHaveBeenCalledOnce();
    expect(OpenClawClient).toHaveBeenCalledOnce();
    expect(deps.openclawClient).not.toBe(originalClient);
  });

  it("rebuilds OpenClaw client when both URL and token change", () => {
    configStore.update({
      openclawGatewayUrl: "ws://new-url:4000",
      openclawGatewayToken: "new-token",
    });

    // Only ONE rebuild (not two) -- single onChange callback
    expect(originalClient.disconnect).toHaveBeenCalledOnce();
    expect(OpenClawClient).toHaveBeenCalledOnce();
    expect(deps.openclawClient).not.toBe(originalClient);
  });

  it("does not rebuild when unrelated config changes", () => {
    configStore.update({ sttProvider: createProviderId("openai") });

    expect(OpenClawClient).not.toHaveBeenCalled();
    expect(originalClient.disconnect).not.toHaveBeenCalled();
    expect(deps.openclawClient).toBe(originalClient);
  });

  it("does not rebuild when only STT provider config changes", () => {
    configStore.update({ whisperx: { baseUrl: "http://new" } });

    expect(OpenClawClient).not.toHaveBeenCalled();
    expect(originalClient.disconnect).not.toHaveBeenCalled();
    expect(deps.openclawClient).toBe(originalClient);
  });

  it("passes correct config to new OpenClawClient constructor", () => {
    configStore.update({ openclawGatewayUrl: "ws://new-url:5000" });

    const ctorCall = (OpenClawClient as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    // First arg is the config object
    expect(ctorCall[0]).toEqual({
      gatewayUrl: "ws://new-url:5000",
      authToken: "secret-token-123",
    });
    // Second arg is the logger
    expect(ctorCall[1]).toBe(logger);
  });
});
