import { describe, it, expect } from "vitest";
import { ConfigStore } from "./config-store.js";
import type { GatewayConfig, SafeGatewayConfig } from "@voice-gateway/shared-types";
import { createProviderId, createSessionKey } from "@voice-gateway/shared-types";

/** Minimal valid GatewayConfig fixture for tests. */
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

describe("ConfigStore", () => {
  describe("get()", () => {
    it("returns the initial config passed to the constructor", () => {
      const initial = makeTestConfig();
      const store = new ConfigStore(initial);
      expect(store.get()).toEqual(initial);
    });
  });

  describe("getSafe()", () => {
    it("masks openclawGatewayToken, openai.apiKey, and customHttp.authHeader", () => {
      const store = new ConfigStore(makeTestConfig());
      const safe = store.getSafe();

      expect(safe.openclawGatewayToken).toBe("********");
      expect(safe.openai.apiKey).toBe("********");
      expect(safe.customHttp.authHeader).toBe("********");
    });

    it("preserves non-secret fields", () => {
      const initial = makeTestConfig();
      const store = new ConfigStore(initial);
      const safe = store.getSafe();

      expect(safe.openclawGatewayUrl).toBe(initial.openclawGatewayUrl);
      expect(safe.openclawSessionKey).toBe(initial.openclawSessionKey);
      expect(safe.sttProvider).toBe(initial.sttProvider);
      expect(safe.whisperx.baseUrl).toBe(initial.whisperx.baseUrl);
      expect(safe.whisperx.model).toBe(initial.whisperx.model);
      expect(safe.openai.model).toBe(initial.openai.model);
      expect(safe.customHttp.url).toBe(initial.customHttp.url);
      expect(safe.server).toEqual(initial.server);
    });

    it("return type is assignable to SafeGatewayConfig", () => {
      const store = new ConfigStore(makeTestConfig());
      const safe: SafeGatewayConfig = store.getSafe();
      expect(safe).toBeDefined();
    });
  });

  describe("update()", () => {
    it("applies a partial top-level patch and preserves unmodified fields", () => {
      const store = new ConfigStore(makeTestConfig());
      store.update({ openclawGatewayUrl: "ws://new-url:3000" });

      const updated = store.get();
      expect(updated.openclawGatewayUrl).toBe("ws://new-url:3000");
      // Unmodified fields preserved
      expect(updated.openclawGatewayToken).toBe("secret-token-123");
      expect(updated.sttProvider).toBe("whisperx");
      expect(updated.whisperx.model).toBe("medium");
    });

    it("merges nested provider config without destroying sibling fields", () => {
      const store = new ConfigStore(makeTestConfig());
      store.update({ whisperx: { baseUrl: "http://new-whisperx" } });

      const updated = store.get();
      expect(updated.whisperx.baseUrl).toBe("http://new-whisperx");
      // Sibling fields preserved
      expect(updated.whisperx.model).toBe("medium");
      expect(updated.whisperx.language).toBe("en");
      expect(updated.whisperx.pollIntervalMs).toBe(3000);
      expect(updated.whisperx.timeoutMs).toBe(300000);
    });

    it("handles empty patch leaving config unchanged", () => {
      const initial = makeTestConfig();
      const store = new ConfigStore(initial);
      store.update({});

      expect(store.get()).toEqual(initial);
    });

    it("merges nested openai config correctly", () => {
      const store = new ConfigStore(makeTestConfig());
      store.update({ openai: { model: "whisper-2" } });

      const updated = store.get();
      expect(updated.openai.model).toBe("whisper-2");
      expect(updated.openai.apiKey).toBe("sk-test-key");
      expect(updated.openai.language).toBe("en");
    });

    it("merges nested customHttp config correctly", () => {
      const store = new ConfigStore(makeTestConfig());
      store.update({ customHttp: { url: "https://new-stt.local" } });

      const updated = store.get();
      expect(updated.customHttp.url).toBe("https://new-stt.local");
      expect(updated.customHttp.authHeader).toBe("Bearer custom-token");
    });
  });
});
