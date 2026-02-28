/**
 * Voice turn orchestrator — coordinates the full pipeline.
 *
 * Audio → STT → OpenClaw → Response Shaping → GatewayReply
 */

import type {
  VoiceTurnRequest,
  VoiceTurnResult,
  GatewayReply,
  SttResult,
  SessionKey,
  TurnId,
  ProviderId,
  AudioPayload,
} from "@voice-gateway/shared-types";
import {
  createTurnId,
  ProviderIds,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";
import type { SttProvider, SttContext } from "@voice-gateway/stt-contract";
import type { OpenClawClient } from "@voice-gateway/openclaw-client";
import { shapeResponse } from "@voice-gateway/response-policy";
import type { Logger } from "@voice-gateway/logging";

export interface OrchestratorDeps {
  readonly sttProviders: Map<string, SttProvider>;
  readonly activeProviderId: ProviderId;
  readonly openclawClient: OpenClawClient;
  readonly logger: Logger;
}

/**
 * Execute a full voice turn pipeline.
 *
 * OPS-05: Timing breakdown included in response metadata.
 */
export async function executeVoiceTurn(
  request: VoiceTurnRequest,
  deps: OrchestratorDeps,
): Promise<VoiceTurnResult> {
  const totalStart = Date.now();
  const log = deps.logger.child({ turnId: request.turnId });

  log.info("Voice turn started", {
    sessionKey: request.sessionKey,
    audioContentType: request.audio.contentType,
    audioBytes: request.audio.data.length,
    provider: deps.activeProviderId,
  });

  // Step 1: STT Transcription
  const provider = deps.sttProviders.get(deps.activeProviderId);
  if (!provider) {
    throw new OperatorError(
      ErrorCodes.MISSING_CONFIG,
      "STT provider not available",
      `No STT provider registered for: ${deps.activeProviderId}`,
    );
  }

  const sttCtx: SttContext = {
    turnId: request.turnId,
    languageHint: request.audio.languageHint,
  };

  const sttStart = Date.now();
  const sttResult: SttResult = await provider.transcribe(request.audio, sttCtx);
  const sttMs = Date.now() - sttStart;

  log.info("STT complete", {
    sttMs,
    textLength: sttResult.text.length,
    language: sttResult.language,
  });

  // Step 2: Send to OpenClaw
  const agentStart = Date.now();
  const clawResponse = await deps.openclawClient.sendTranscript(
    request.sessionKey,
    request.turnId,
    sttResult.text,
  );
  const agentMs = Date.now() - agentStart;

  log.info("OpenClaw response received", {
    agentMs,
    responseLength: clawResponse.text.length,
  });

  // Step 3: Shape response
  const { segments, truncated } = shapeResponse(clawResponse.text);

  const totalMs = Date.now() - totalStart;

  // Build reply envelope — RESP-01
  const reply: GatewayReply = {
    turnId: request.turnId,
    sessionKey: request.sessionKey,
    assistant: {
      fullText: clawResponse.text,
      segments,
      truncated,
    },
    timing: {
      sttMs,
      agentMs,
      totalMs,
    },
    meta: {
      provider: deps.activeProviderId,
      model: null, // TODO(phase-2): thread SttResult.model when available
    },
  };

  log.info("Voice turn complete", {
    totalMs,
    sttMs,
    agentMs,
    segmentCount: segments.length,
    truncated,
  });

  return {
    reply,
    sttResult,
  };
}
