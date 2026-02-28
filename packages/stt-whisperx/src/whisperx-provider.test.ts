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

const TEST_OGG_AUDIO: AudioPayload = {
  data: Buffer.from("fake-ogg-opus-data"),
  contentType: "audio/ogg",
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
    expect(result.model).toBe("medium");
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

  describe("segment-based transcript extraction", () => {
    it("extracts text from result.segments (standard WhisperX output)", async () => {
      const provider = new WhisperXProvider(
        { baseUrl: "https://test.local", pollIntervalMs: 10, timeoutMs: 5000 },
        logger,
      );

      // Mock submit
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ identifier: "task-seg-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      // Mock poll - completed with segments but no top-level text
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            identifier: "task-seg-1",
            status: "completed",
            result: {
              language: "en",
              segments: [
                { text: "Hello from" },
                { text: "the voice note" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const result = await provider.transcribe(TEST_OGG_AUDIO, makeCtx());

      expect(result.text).toBe("Hello from the voice note");
      expect(result.language).toBe("en");
      expect(result.providerId).toBe("whisperx");
    });

    it("extracts text from segments when result.text is empty", async () => {
      const provider = new WhisperXProvider(
        { baseUrl: "https://test.local", pollIntervalMs: 10, timeoutMs: 5000 },
        logger,
      );

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ identifier: "task-seg-2" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      // Has both text (empty) and segments (populated)
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            identifier: "task-seg-2",
            status: "completed",
            result: {
              text: "",
              language: "en",
              segments: [{ text: "Segment text here" }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const result = await provider.transcribe(TEST_AUDIO, makeCtx());

      expect(result.text).toBe("Segment text here");
    });

    it("falls back to result.text when segments are absent", async () => {
      const provider = new WhisperXProvider(
        { baseUrl: "https://test.local", pollIntervalMs: 10, timeoutMs: 5000 },
        logger,
      );

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ identifier: "task-seg-3" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      // Only has top-level text, no segments
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            identifier: "task-seg-3",
            status: "completed",
            result: { text: "Fallback text", language: "en" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const result = await provider.transcribe(TEST_AUDIO, makeCtx());

      expect(result.text).toBe("Fallback text");
    });

    it("throws UserError when both segments and text are empty", async () => {
      const provider = new WhisperXProvider(
        { baseUrl: "https://test.local", pollIntervalMs: 10, timeoutMs: 5000 },
        logger,
      );

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ identifier: "task-seg-4" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      // Completed but with empty segments and no text
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            identifier: "task-seg-4",
            status: "completed",
            result: { language: "en", segments: [] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(
        provider.transcribe(TEST_AUDIO, makeCtx()),
      ).rejects.toThrow(UserError);
    });

    it("handles OGG audio with segments response (Telegram voice note path)", async () => {
      const provider = new WhisperXProvider(
        { baseUrl: "https://test.local", pollIntervalMs: 10, timeoutMs: 5000 },
        logger,
      );

      // Mock submit
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ identifier: "task-ogg-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      // Mock poll - completed with segments (typical WhisperX response for OGG voice notes)
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            identifier: "task-ogg-1",
            status: "completed",
            result: {
              language: "en",
              segments: [
                { text: "This is a test" },
                { text: "of the voice gateway" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const result = await provider.transcribe(TEST_OGG_AUDIO, makeCtx());

      expect(result.text).toBe("This is a test of the voice gateway");
      expect(result.language).toBe("en");
      expect(result.providerId).toBe("whisperx");
      expect(result.model).toBe("medium");
    });
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
