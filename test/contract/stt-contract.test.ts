/**
 * STT Provider Contract Tests
 *
 * Verifies all providers accept the same input and produce conformant SttResult output.
 * This test suite runs against mocked HTTP backends — it validates the provider
 * normalization logic, not the external services.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WhisperXProvider } from "@voice-gateway/stt-whisperx";
import { OpenAIProvider } from "@voice-gateway/stt-openai";
import { CustomHttpProvider } from "@voice-gateway/stt-custom-http";
import type { SttProvider } from "@voice-gateway/stt-contract";
import { Logger } from "@voice-gateway/logging";
import { createTurnId, ProviderIds } from "@voice-gateway/shared-types";
import type { AudioPayload, SttResult } from "@voice-gateway/shared-types";

const TEST_AUDIO: AudioPayload = {
  data: Buffer.from("fake-wav-data"),
  contentType: "audio/wav",
};

const logger = new Logger();

/** Create mocked providers that return successful transcriptions. */
function createMockedProviders(
  fetchSpy: ReturnType<typeof vi.spyOn>,
): SttProvider[] {
  return [
    // WhisperX — submit returns task ID, poll returns completed
    (() => {
      const provider = new WhisperXProvider(
        { baseUrl: "https://mock.whisperx", pollIntervalMs: 10, timeoutMs: 5000 },
        logger,
      );
      return provider;
    })(),

    // OpenAI — synchronous response
    (() => {
      const provider = new OpenAIProvider(
        { apiKey: "sk-mock-key" },
        logger,
      );
      return provider;
    })(),

    // Custom HTTP — standard response mapping
    (() => {
      const provider = new CustomHttpProvider(
        {
          url: "https://mock.custom/transcribe",
          responseMapping: {
            textField: "text",
            languageField: "language",
            confidenceField: "confidence",
          },
        },
        logger,
      );
      return provider;
    })(),
  ];
}

describe("STT Provider Contract", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Mock fetch responses for each provider type. */
  function setupMocksForProvider(providerId: string): void {
    switch (providerId) {
      case "whisperx":
        // Submit
        fetchSpy.mockResolvedValueOnce(
          new Response(JSON.stringify({ identifier: "task-contract" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
        // Poll - completed
        fetchSpy.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              identifier: "task-contract",
              status: "completed",
              result: { text: "Contract test transcript", language: "en" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
        break;

      case "openai":
        fetchSpy.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              text: "Contract test transcript",
              language: "en",
              duration: 1.5,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
        break;

      case "custom":
        fetchSpy.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              text: "Contract test transcript",
              language: "en",
              confidence: 0.95,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
        break;
    }
  }

  function validateSttResult(result: SttResult): void {
    // Required fields exist and have correct types
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
    expect(typeof result.language).toBe("string");
    expect(result.language.length).toBeGreaterThanOrEqual(2);
    expect(
      result.confidence === null || typeof result.confidence === "number",
    ).toBe(true);
    if (result.confidence !== null) {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
    expect(typeof result.providerId).toBe("string");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }

  const providerConfigs = [
    { id: "whisperx", name: "WhisperX" },
    { id: "openai", name: "OpenAI" },
    { id: "custom", name: "Custom HTTP" },
  ];

  for (const { id, name } of providerConfigs) {
    describe(`${name} provider`, () => {
      it("produces conformant SttResult", async () => {
        const providers = createMockedProviders(fetchSpy);
        const provider = providers.find((p) => p.providerId === id);
        expect(provider).toBeDefined();

        setupMocksForProvider(id);

        const result = await provider!.transcribe(TEST_AUDIO, {
          turnId: createTurnId("turn_contract"),
        });

        validateSttResult(result);
      });

      it("has matching providerId", () => {
        const providers = createMockedProviders(fetchSpy);
        const provider = providers.find((p) => p.providerId === id);
        expect(provider).toBeDefined();
        expect(provider!.providerId).toBe(id);
      });

      it("has non-empty name", () => {
        const providers = createMockedProviders(fetchSpy);
        const provider = providers.find((p) => p.providerId === id);
        expect(provider).toBeDefined();
        expect(provider!.name.length).toBeGreaterThan(0);
      });

      it("has healthCheck method", () => {
        const providers = createMockedProviders(fetchSpy);
        const provider = providers.find((p) => p.providerId === id);
        expect(provider).toBeDefined();
        expect(typeof provider!.healthCheck).toBe("function");
      });
    });
  }

  it("all providers return matching transcript text", async () => {
    const providers = createMockedProviders(fetchSpy);
    const results: SttResult[] = [];

    for (const provider of providers) {
      fetchSpy.mockReset();
      vi.spyOn(process.stdout, "write").mockReturnValue(true);
      vi.spyOn(process.stderr, "write").mockReturnValue(true);
      fetchSpy = vi.spyOn(globalThis, "fetch");
      setupMocksForProvider(provider.providerId);

      const result = await provider.transcribe(TEST_AUDIO, {
        turnId: createTurnId("turn_all"),
      });
      results.push(result);
    }

    // All providers should return the same transcript text
    const texts = results.map((r) => r.text);
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toBe("Contract test transcript");
  });

  it("all providers set unique providerIds", () => {
    const providers = createMockedProviders(fetchSpy);
    const ids = providers.map((p) => p.providerId);
    expect(new Set(ids).size).toBe(providers.length);
  });
});
