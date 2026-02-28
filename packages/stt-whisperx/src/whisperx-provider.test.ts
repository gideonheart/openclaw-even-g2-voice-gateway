import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhisperXProvider } from "./whisperx-provider.js";
import { Logger } from "@voice-gateway/logging";
import { createTurnId, UserError, OperatorError } from "@voice-gateway/shared-types";
import type { AudioPayload } from "@voice-gateway/shared-types";
import type { SttContext } from "@voice-gateway/stt-contract";

const TEST_AUDIO: AudioPayload = {
  data: Buffer.from("fake-wav-data"),
  contentType: "audio/wav",
};

function makeCtx(overrides?: Partial<SttContext>): SttContext {
  return {
    turnId: createTurnId("turn_test_1"),
    ...overrides,
  };
}

describe("WhisperXProvider", () => {
  const logger = new Logger();
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Suppress log output in tests
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct providerId and name", () => {
    const provider = new WhisperXProvider({}, logger);
    expect(provider.providerId).toBe("whisperx");
    expect(provider.name).toBe("WhisperX (self-hosted)");
  });

  it("transcribes audio via submit-then-poll", async () => {
    const provider = new WhisperXProvider(
      { baseUrl: "https://test.local", pollIntervalMs: 10, timeoutMs: 5000 },
      logger,
    );

    // Mock submit
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ identifier: "task-123" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Mock poll - processing
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ identifier: "task-123", status: "processing" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    // Mock poll - completed
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          identifier: "task-123",
          status: "completed",
          result: { text: "Hello world", language: "en" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await provider.transcribe(TEST_AUDIO, makeCtx());

    expect(result.text).toBe("Hello world");
    expect(result.language).toBe("en");
    expect(result.providerId).toBe("whisperx");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeNull();
  });

  it("throws UserError on timeout", async () => {
    const provider = new WhisperXProvider(
      { baseUrl: "https://test.local", pollIntervalMs: 10, timeoutMs: 50 },
      logger,
    );

    // Mock submit
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ identifier: "task-456" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Mock polls - always processing (will timeout)
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({ identifier: "task-456", status: "processing" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(provider.transcribe(TEST_AUDIO, makeCtx())).rejects.toThrow(
      UserError,
    );
  });

  it("throws OperatorError on submit failure", async () => {
    const provider = new WhisperXProvider(
      { baseUrl: "https://test.local" },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response("Server Error", { status: 500 }),
    );

    await expect(provider.transcribe(TEST_AUDIO, makeCtx())).rejects.toThrow(
      OperatorError,
    );
  });

  it("throws OperatorError on task failure", async () => {
    const provider = new WhisperXProvider(
      { baseUrl: "https://test.local", pollIntervalMs: 10 },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ identifier: "task-789" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          identifier: "task-789",
          status: "failed",
          error: "GPU out of memory",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(provider.transcribe(TEST_AUDIO, makeCtx())).rejects.toThrow(
      OperatorError,
    );
  });

  describe("healthCheck", () => {
    it("returns healthy when server responds OK", async () => {
      const provider = new WhisperXProvider(
        { baseUrl: "https://test.local" },
        logger,
      );

      fetchSpy.mockResolvedValueOnce(new Response("OK", { status: 200 }));

      const status = await provider.healthCheck();
      expect(status.healthy).toBe(true);
      expect(status.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns unhealthy when server is down", async () => {
      const provider = new WhisperXProvider(
        { baseUrl: "https://test.local" },
        logger,
      );

      fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const status = await provider.healthCheck();
      expect(status.healthy).toBe(false);
      expect(status.message).toContain("ECONNREFUSED");
    });
  });
});
