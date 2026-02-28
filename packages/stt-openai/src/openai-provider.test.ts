import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIProvider } from "./openai-provider.js";
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

describe("OpenAIProvider", () => {
  const logger = new Logger();
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct providerId and name", () => {
    const provider = new OpenAIProvider({}, logger);
    expect(provider.providerId).toBe("openai");
    expect(provider.name).toBe("OpenAI STT");
  });

  it("transcribes audio via synchronous API", async () => {
    const provider = new OpenAIProvider(
      { apiKey: "sk-test-key" },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          text: "Hello from OpenAI",
          language: "en",
          duration: 2.5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await provider.transcribe(TEST_AUDIO, makeCtx());

    expect(result.text).toBe("Hello from OpenAI");
    expect(result.language).toBe("en");
    expect(result.providerId).toBe("openai");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify auth header was sent
    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs).toBeDefined();
    const requestInit = callArgs![1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test-key");
  });

  it("throws OperatorError when API key is missing", async () => {
    const provider = new OpenAIProvider({ apiKey: "" }, logger);

    await expect(provider.transcribe(TEST_AUDIO, makeCtx())).rejects.toThrow(
      OperatorError,
    );
  });

  it("throws UserError on rate limit (429)", async () => {
    const provider = new OpenAIProvider(
      { apiKey: "sk-test-key" },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response("Rate limited", { status: 429 }),
    );

    await expect(provider.transcribe(TEST_AUDIO, makeCtx())).rejects.toThrow(
      UserError,
    );
  });

  it("throws OperatorError on auth failure (401)", async () => {
    const provider = new OpenAIProvider(
      { apiKey: "sk-bad-key" },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(provider.transcribe(TEST_AUDIO, makeCtx())).rejects.toThrow(
      OperatorError,
    );
  });

  it("throws UserError on empty transcript", async () => {
    const provider = new OpenAIProvider(
      { apiKey: "sk-test-key" },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ text: "", language: "en" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(provider.transcribe(TEST_AUDIO, makeCtx())).rejects.toThrow(
      UserError,
    );
  });

  describe("healthCheck", () => {
    it("returns unhealthy when API key is missing", async () => {
      const provider = new OpenAIProvider({ apiKey: "" }, logger);
      const status = await provider.healthCheck();
      expect(status.healthy).toBe(false);
    });

    it("returns healthy when API responds OK", async () => {
      const provider = new OpenAIProvider(
        { apiKey: "sk-test-key" },
        logger,
      );

      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "whisper-1" }), { status: 200 }),
      );

      const status = await provider.healthCheck();
      expect(status.healthy).toBe(true);
    });
  });
});
