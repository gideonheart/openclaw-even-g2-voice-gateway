import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CustomHttpProvider } from "./custom-http-provider.js";
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

describe("CustomHttpProvider", () => {
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
    const provider = new CustomHttpProvider({}, logger);
    expect(provider.providerId).toBe("custom");
    expect(provider.name).toBe("Custom HTTP STT");
  });

  it("transcribes audio via custom HTTP endpoint", async () => {
    const provider = new CustomHttpProvider(
      {
        url: "https://stt.example.com/transcribe",
        authHeader: "Bearer custom-token",
        responseMapping: {
          textField: "text",
          languageField: "language",
          confidenceField: "confidence",
        },
      },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          text: "Hello from custom",
          language: "en",
          confidence: 0.92,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await provider.transcribe(TEST_AUDIO, makeCtx());

    expect(result.text).toBe("Hello from custom");
    expect(result.language).toBe("en");
    expect(result.confidence).toBe(0.92);
    expect(result.providerId).toBe("custom");
  });

  it("supports nested response field mapping", async () => {
    const provider = new CustomHttpProvider(
      {
        url: "https://stt.example.com/transcribe",
        responseMapping: {
          textField: "result.transcript",
          languageField: "result.lang",
          confidenceField: "result.score",
        },
      },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            transcript: "Nested text",
            lang: "de",
            score: 0.88,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await provider.transcribe(TEST_AUDIO, makeCtx());

    expect(result.text).toBe("Nested text");
    expect(result.language).toBe("de");
    expect(result.confidence).toBe(0.88);
  });

  it("sends auth header when configured", async () => {
    const provider = new CustomHttpProvider(
      {
        url: "https://stt.example.com/transcribe",
        authHeader: "Bearer my-secret-token",
      },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ text: "Authed", language: "en" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await provider.transcribe(TEST_AUDIO, makeCtx());

    const callArgs = fetchSpy.mock.calls[0];
    expect(callArgs).toBeDefined();
    const requestInit = callArgs![1] as RequestInit;
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-secret-token");
  });

  it("throws OperatorError when URL is not configured", async () => {
    const provider = new CustomHttpProvider({ url: "" }, logger);

    await expect(provider.transcribe(TEST_AUDIO, makeCtx())).rejects.toThrow(
      OperatorError,
    );
  });

  it("throws OperatorError on HTTP error response", async () => {
    const provider = new CustomHttpProvider(
      { url: "https://stt.example.com/transcribe" },
      logger,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(provider.transcribe(TEST_AUDIO, makeCtx())).rejects.toThrow(
      OperatorError,
    );
  });

  it("throws UserError on empty transcript", async () => {
    const provider = new CustomHttpProvider(
      { url: "https://stt.example.com/transcribe" },
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
    it("returns unhealthy when URL not configured", async () => {
      const provider = new CustomHttpProvider({ url: "" }, logger);
      const status = await provider.healthCheck();
      expect(status.healthy).toBe(false);
    });

    it("returns healthy when server responds OK", async () => {
      const provider = new CustomHttpProvider(
        { url: "https://stt.example.com/transcribe" },
        logger,
      );

      fetchSpy.mockResolvedValueOnce(
        new Response("OK", { status: 200 }),
      );

      const status = await provider.healthCheck();
      expect(status.healthy).toBe(true);
    });
  });
});
