import { describe, it, expect, vi } from "vitest";
import { ConfigStore, validateSettingsPatch } from "./config-store.js";
import type { GatewayConfig, SafeGatewayConfig } from "@voice-gateway/shared-types";
import { createProviderId, createSessionKey, UserError, ErrorCodes } from "@voice-gateway/shared-types";

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

  describe("onChange()", () => {
    it("calls listener with patch and updated config after update()", () => {
      const store = new ConfigStore(makeTestConfig());
      const listener = vi.fn();
      store.onChange(listener);

      const patch = { whisperx: { baseUrl: "http://new-whisperx" } };
      store.update(patch);

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(patch, store.get());
      // Verify the config passed has the merged value
      expect(listener.mock.calls[0][1].whisperx.baseUrl).toBe("http://new-whisperx");
    });

    it("calls multiple listeners in registration order", () => {
      const store = new ConfigStore(makeTestConfig());
      const order: number[] = [];
      store.onChange(() => order.push(1));
      store.onChange(() => order.push(2));
      store.onChange(() => order.push(3));

      store.update({ openclawGatewayUrl: "ws://changed:3000" });

      expect(order).toEqual([1, 2, 3]);
    });

    it("listener receives fully merged config, not just the patch", () => {
      const store = new ConfigStore(makeTestConfig());
      const listener = vi.fn();
      store.onChange(listener);

      store.update({ whisperx: { model: "large" } });

      const receivedConfig = listener.mock.calls[0][1];
      // Merged field
      expect(receivedConfig.whisperx.model).toBe("large");
      // Preserved sibling fields
      expect(receivedConfig.whisperx.baseUrl).toBe("https://wsp.kingdom.lv");
      expect(receivedConfig.whisperx.language).toBe("en");
      // Unmodified top-level fields
      expect(receivedConfig.openclawGatewayUrl).toBe("ws://localhost:3000");
      expect(receivedConfig.sttProvider).toBe("whisperx");
    });
  });
});

describe("validateSettingsPatch", () => {
  it("returns empty patch for empty input", () => {
    const result = validateSettingsPatch({});
    expect(result).toEqual({});
  });

  it("validates a valid openclawGatewayUrl", () => {
    const result = validateSettingsPatch({ openclawGatewayUrl: "ws://localhost:3000" });
    expect(result.openclawGatewayUrl).toBe("ws://localhost:3000");
  });

  it("throws UserError for invalid openclawGatewayUrl", () => {
    expect(() => validateSettingsPatch({ openclawGatewayUrl: "not-a-url" })).toThrow(UserError);
    try {
      validateSettingsPatch({ openclawGatewayUrl: "not-a-url" });
    } catch (err) {
      expect((err as UserError).code).toBe(ErrorCodes.INVALID_CONFIG);
    }
  });

  it("validates a valid sttProvider and returns branded ProviderId", () => {
    const result = validateSettingsPatch({ sttProvider: "whisperx" });
    expect(result.sttProvider).toBe("whisperx");
  });

  it("throws UserError for invalid sttProvider", () => {
    expect(() => validateSettingsPatch({ sttProvider: "invalid-provider" })).toThrow(UserError);
    try {
      validateSettingsPatch({ sttProvider: "invalid-provider" });
    } catch (err) {
      expect((err as UserError).code).toBe(ErrorCodes.INVALID_CONFIG);
    }
  });

  it("validates a valid openclawSessionKey and returns branded SessionKey", () => {
    const result = validateSettingsPatch({ openclawSessionKey: "my-session" });
    expect(result.openclawSessionKey).toBe("my-session");
  });

  it("throws UserError for empty openclawSessionKey", () => {
    expect(() => validateSettingsPatch({ openclawSessionKey: "" })).toThrow(UserError);
    try {
      validateSettingsPatch({ openclawSessionKey: "" });
    } catch (err) {
      expect((err as UserError).code).toBe(ErrorCodes.INVALID_CONFIG);
    }
  });

  it("validates a valid openclawGatewayToken (non-empty)", () => {
    const result = validateSettingsPatch({ openclawGatewayToken: "secret-token" });
    expect(result.openclawGatewayToken).toBe("secret-token");
  });

  it("validates nested whisperx.baseUrl", () => {
    const result = validateSettingsPatch({ whisperx: { baseUrl: "http://new-url" } });
    expect(result.whisperx?.baseUrl).toBe("http://new-url");
  });

  it("throws on non-positive whisperx.pollIntervalMs", () => {
    expect(() =>
      validateSettingsPatch({ whisperx: { pollIntervalMs: -1 } }),
    ).toThrow(UserError);
  });

  it("throws UserError for non-object input (string)", () => {
    expect(() => validateSettingsPatch("not an object" as unknown)).toThrow(UserError);
    try {
      validateSettingsPatch("not an object" as unknown);
    } catch (err) {
      expect((err as UserError).code).toBe(ErrorCodes.INVALID_CONFIG);
    }
  });

  it("throws UserError for null input", () => {
    expect(() => validateSettingsPatch(null as unknown)).toThrow(UserError);
    try {
      validateSettingsPatch(null as unknown);
    } catch (err) {
      expect((err as UserError).code).toBe(ErrorCodes.INVALID_CONFIG);
    }
  });

  it("silently ignores unknown fields", () => {
    const result = validateSettingsPatch({ unknownField: "value", anotherRandom: 42 } as unknown);
    expect(result).toEqual({});
    expect((result as Record<string, unknown>)["unknownField"]).toBeUndefined();
  });

  it("validates multiple fields at once", () => {
    const result = validateSettingsPatch({
      openclawGatewayUrl: "ws://localhost:5000",
      sttProvider: "openai",
      openai: { apiKey: "sk-new-key", model: "whisper-2" },
    });
    expect(result.openclawGatewayUrl).toBe("ws://localhost:5000");
    expect(result.sttProvider).toBe("openai");
    expect(result.openai?.apiKey).toBe("sk-new-key");
    expect(result.openai?.model).toBe("whisper-2");
  });

  it("validates whisperx.timeoutMs as positive integer", () => {
    const result = validateSettingsPatch({ whisperx: { timeoutMs: 5000 } });
    expect(result.whisperx?.timeoutMs).toBe(5000);
  });

  it("throws on non-positive whisperx.timeoutMs", () => {
    expect(() =>
      validateSettingsPatch({ whisperx: { timeoutMs: 0 } }),
    ).toThrow(UserError);
  });

  it("validates customHttp fields", () => {
    const result = validateSettingsPatch({
      customHttp: {
        url: "https://stt.example.com/v2",
        authHeader: "Bearer new-token",
      },
    });
    expect(result.customHttp?.url).toBe("https://stt.example.com/v2");
    expect(result.customHttp?.authHeader).toBe("Bearer new-token");
  });
});
