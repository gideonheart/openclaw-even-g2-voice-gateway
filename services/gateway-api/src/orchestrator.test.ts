import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeVoiceTurn } from "./orchestrator.js";
import { Logger } from "@voice-gateway/logging";
import {
  createTurnId,
  createSessionKey,
  ProviderIds,
  OperatorError,
} from "@voice-gateway/shared-types";
import type { AudioPayload, SttResult, OpenClawInbound } from "@voice-gateway/shared-types";
import type { SttProvider, SttContext } from "@voice-gateway/stt-contract";

describe("executeVoiceTurn", () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  it("orchestrates full pipeline: STT → OpenClaw → Shape", async () => {
    const turnId = createTurnId("turn_orch_1");
    const sessionKey = createSessionKey("test-session");

    const mockSttResult: SttResult = {
      text: "Hello from the glasses",
      language: "en",
      confidence: null,
      providerId: ProviderIds.WhisperX,
      durationMs: 500,
    };

    const mockClawResponse: OpenClawInbound = {
      sessionKey,
      turnId,
      text: "I received your message. How can I help you today?",
      timestamp: new Date().toISOString(),
    };

    const mockProvider: SttProvider = {
      providerId: ProviderIds.WhisperX,
      name: "Mock WhisperX",
      transcribe: vi.fn().mockResolvedValue(mockSttResult),
      healthCheck: vi.fn().mockResolvedValue({ healthy: true, message: "ok", latencyMs: 10 }),
    };

    const mockClient = {
      sendTranscript: vi.fn().mockResolvedValue(mockClawResponse),
    };

    const providers = new Map<string, SttProvider>();
    providers.set(ProviderIds.WhisperX, mockProvider);

    const audio: AudioPayload = {
      data: Buffer.from("fake-audio"),
      contentType: "audio/wav",
    };

    const result = await executeVoiceTurn(
      { turnId, sessionKey, audio },
      {
        sttProviders: providers,
        activeProviderId: ProviderIds.WhisperX,
        openclawClient: mockClient as any,
        logger: new Logger(),
      },
    );

    // Verify full pipeline executed
    expect(mockProvider.transcribe).toHaveBeenCalledOnce();
    expect(mockClient.sendTranscript).toHaveBeenCalledWith(
      sessionKey,
      turnId,
      "Hello from the glasses",
    );

    // Verify reply structure
    expect(result.reply.turnId).toBe(turnId);
    expect(result.reply.sessionKey).toBe(sessionKey);
    expect(result.reply.assistant.fullText).toBe(mockClawResponse.text);
    expect(result.reply.assistant.segments.length).toBeGreaterThan(0);
    expect(result.reply.timing.sttMs).toBeGreaterThanOrEqual(0);
    expect(result.reply.timing.agentMs).toBeGreaterThanOrEqual(0);
    expect(result.reply.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.reply.meta.provider).toBe("whisperx");

    // Verify raw STT result returned
    expect(result.sttResult.text).toBe("Hello from the glasses");
  });

  it("throws when provider not found", async () => {
    const providers = new Map<string, SttProvider>();

    await expect(
      executeVoiceTurn(
        {
          turnId: createTurnId("turn_no_provider"),
          sessionKey: createSessionKey("test"),
          audio: { data: Buffer.from(""), contentType: "audio/wav" },
        },
        {
          sttProviders: providers,
          activeProviderId: ProviderIds.WhisperX,
          openclawClient: {} as any,
          logger: new Logger(),
        },
      ),
    ).rejects.toThrow(OperatorError);

    await expect(
      executeVoiceTurn(
        {
          turnId: createTurnId("turn_no_provider_2"),
          sessionKey: createSessionKey("test"),
          audio: { data: Buffer.from(""), contentType: "audio/wav" },
        },
        {
          sttProviders: new Map(),
          activeProviderId: ProviderIds.WhisperX,
          openclawClient: {} as any,
          logger: new Logger(),
        },
      ),
    ).rejects.toThrow(/STT provider not available/);
  });
});
