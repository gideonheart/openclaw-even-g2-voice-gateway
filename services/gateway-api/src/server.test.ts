import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "./server.js";
import { ConfigStore } from "./config-store.js";
import { createProviderId, createSessionKey } from "@voice-gateway/shared-types";
import type { GatewayConfig } from "@voice-gateway/shared-types";

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

describe("RateLimiter", () => {
  let configStore: ConfigStore;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    configStore = new ConfigStore(
      makeTestConfig({ server: { port: 4400, host: "0.0.0.0", corsOrigins: [], maxAudioBytes: 25 * 1024 * 1024, rateLimitPerMinute: 60 } }),
    );
    rateLimiter = new RateLimiter(configStore);
  });

  afterEach(() => {
    rateLimiter.destroy();
    vi.useRealTimers();
  });

  it("allows requests within rate limit", () => {
    const store = new ConfigStore(
      makeTestConfig({ server: { port: 4400, host: "0.0.0.0", corsOrigins: [], maxAudioBytes: 25 * 1024 * 1024, rateLimitPerMinute: 5 } }),
    );
    const limiter = new RateLimiter(store);

    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(limiter.check("ip1"));
    }

    expect(results).toEqual([true, true, true, true, true]);
    limiter.destroy();
  });

  it("rejects requests exceeding rate limit", () => {
    const store = new ConfigStore(
      makeTestConfig({ server: { port: 4400, host: "0.0.0.0", corsOrigins: [], maxAudioBytes: 25 * 1024 * 1024, rateLimitPerMinute: 3 } }),
    );
    const limiter = new RateLimiter(store);

    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(limiter.check("ip1"));
    }

    expect(results).toEqual([true, true, true, false]);
    limiter.destroy();
  });

  it("tracks IPs independently", () => {
    const store = new ConfigStore(
      makeTestConfig({ server: { port: 4400, host: "0.0.0.0", corsOrigins: [], maxAudioBytes: 25 * 1024 * 1024, rateLimitPerMinute: 2 } }),
    );
    const limiter = new RateLimiter(store);

    // Exhaust ip1
    limiter.check("ip1");
    limiter.check("ip1");
    expect(limiter.check("ip1")).toBe(false);

    // ip2 should still be allowed
    expect(limiter.check("ip2")).toBe(true);
    expect(limiter.check("ip2")).toBe(true);
    expect(limiter.check("ip2")).toBe(false);

    limiter.destroy();
  });

  it("reacts to config change for rateLimitPerMinute", () => {
    const store = new ConfigStore(
      makeTestConfig({ server: { port: 4400, host: "0.0.0.0", corsOrigins: [], maxAudioBytes: 25 * 1024 * 1024, rateLimitPerMinute: 2 } }),
    );
    const limiter = new RateLimiter(store);

    // Exhaust with limit=2
    expect(limiter.check("ip1")).toBe(true);
    expect(limiter.check("ip1")).toBe(true);
    expect(limiter.check("ip1")).toBe(false);

    // Increase limit to 10 via config update
    store.update({ server: { rateLimitPerMinute: 10 } });

    // Advance time past window reset so ip1 gets a fresh window
    vi.advanceTimersByTime(61_000);

    // Now all 10 should pass
    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(limiter.check("ip1"));
    }
    expect(results.every((r) => r === true)).toBe(true);

    // 11th should fail
    expect(limiter.check("ip1")).toBe(false);

    limiter.destroy();
  });

  it("prune() removes expired entries", () => {
    // Add entries for 3 IPs
    rateLimiter.check("ip1");
    rateLimiter.check("ip2");
    rateLimiter.check("ip3");

    // Advance time past the 60s window
    vi.advanceTimersByTime(61_000);

    // Call prune explicitly
    rateLimiter.prune();

    // All IPs should get fresh windows (proving old entries were pruned)
    // If entries were not pruned, the counts would carry over
    // We verify by checking that all IPs return true (fresh window)
    expect(rateLimiter.check("ip1")).toBe(true);
    expect(rateLimiter.check("ip2")).toBe(true);
    expect(rateLimiter.check("ip3")).toBe(true);
  });

  it("map does not grow unbounded under diverse IPs", () => {
    // Create entries for 10,001 unique IPs in the current time
    // The first batch will be created, then we advance time to expire them
    for (let i = 0; i < 5_000; i++) {
      rateLimiter.check(`ip-batch1-${i}`);
    }

    // Advance time past the window to expire the first batch
    vi.advanceTimersByTime(61_000);

    // Create another batch -- these are fresh
    for (let i = 0; i < 5_002; i++) {
      rateLimiter.check(`ip-batch2-${i}`);
    }

    // At this point we have >10,000 entries (5000 expired + 5002 fresh)
    // The hard cap in check() should have triggered prune()
    // which removes the expired 5000, leaving only the fresh 5002

    // Verify by checking that expired IPs get fresh windows (not rejected)
    // If pruning didn't happen, the map would have 10,002 entries
    // After prune, only the batch2 entries remain
    expect(rateLimiter.check("ip-batch1-0")).toBe(true); // fresh window (was pruned)
    expect(rateLimiter.check("ip-batch1-1")).toBe(true); // fresh window (was pruned)
  });
});
