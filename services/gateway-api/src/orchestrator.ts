/**
 * Turn orchestrator -- coordinates voice and text turn pipelines.
 *
 * Voice: Audio -> STT -> OpenClaw -> Response Shaping -> GatewayReply
 * Text:  Text  -> OpenClaw -> Response Shaping -> GatewayReply
 */

import type {
  VoiceTurnRequest,
  VoiceTurnResult,
  TextTurnRequest,
  TextTurnResult,
  GatewayReply,
  SttResult,
  SessionKey,
  TurnId,
  ProviderId,
} from "@voice-gateway/shared-types";
import {
  createTurnId,
  createProviderId,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";
import type { SttProvider, SttContext } from "@voice-gateway/stt-contract";
import type { OpenClawClient } from "@voice-gateway/openclaw-client";
import { shapeResponse } from "@voice-gateway/response-policy";
import type { Logger } from "@voice-gateway/logging";

// -- Dependency interfaces --

export interface OrchestratorDeps {
  readonly sttProviders: Map<string, SttProvider>;
  readonly activeProviderId: ProviderId;
  readonly openclawClient: OpenClawClient;
  readonly logger: Logger;
}

export interface TextTurnDeps {
  readonly openclawClient: OpenClawClient;
  readonly logger: Logger;
}

// -- Public API --

/** Execute a full voice turn pipeline (STT + OpenClaw + shaping). */
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

  // Step 1: STT transcription
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

  // Steps 2-3: send to OpenClaw, shape response, build reply
  const { reply, agentMs } = await sendAndShape({
    sessionKey: request.sessionKey,
    turnId: request.turnId,
    text: sttResult.text,
    sttMs,
    provider: deps.activeProviderId,
    model: sttResult.model ?? null,
    transcript: sttResult.text,
    openclawClient: deps.openclawClient,
    log,
    totalStart,
  });

  log.info("Voice turn complete", {
    totalMs: reply.timing.totalMs,
    sttMs,
    agentMs,
    segmentCount: reply.assistant.segments.length,
    truncated: reply.assistant.truncated,
  });

  return { reply, sttResult };
}

/** Execute a text turn pipeline (skips STT). */
export async function executeTextTurn(
  request: TextTurnRequest,
  deps: TextTurnDeps,
): Promise<TextTurnResult> {
  const totalStart = Date.now();
  const log = deps.logger.child({ turnId: request.turnId });

  log.info("Text turn started", {
    sessionKey: request.sessionKey,
    textLength: request.text.length,
  });

  const { reply, agentMs } = await sendAndShape({
    sessionKey: request.sessionKey,
    turnId: request.turnId,
    text: request.text,
    sttMs: 0,
    provider: createProviderId("text"),
    model: null,
    transcript: undefined,
    openclawClient: deps.openclawClient,
    log,
    totalStart,
  });

  log.info("Text turn complete", {
    totalMs: reply.timing.totalMs,
    agentMs,
    segmentCount: reply.assistant.segments.length,
    truncated: reply.assistant.truncated,
  });

  return { reply };
}

// -- Shared pipeline tail --

interface PipelineTailParams {
  readonly sessionKey: SessionKey;
  readonly turnId: TurnId;
  readonly text: string;
  readonly sttMs: number;
  readonly provider: ProviderId;
  readonly model: string | null;
  readonly transcript: string | undefined;
  readonly openclawClient: OpenClawClient;
  readonly log: Logger;
  readonly totalStart: number;
}

/**
 * Shared logic for both voice and text turns:
 * send transcript to OpenClaw, shape response, build GatewayReply.
 */
async function sendAndShape(
  params: PipelineTailParams,
): Promise<{ reply: GatewayReply; agentMs: number }> {
  const { sessionKey, turnId, text, sttMs, provider, model, transcript, openclawClient, log, totalStart } = params;

  // Send to OpenClaw
  const agentStart = Date.now();
  const clawResponse = await openclawClient.sendTranscript(sessionKey, turnId, text);
  const agentMs = Date.now() - agentStart;

  log.info("OpenClaw response received", {
    agentMs,
    responseLength: clawResponse.text.length,
  });

  // Shape response
  const { segments, truncated } = shapeResponse(clawResponse.text);

  const totalMs = Date.now() - totalStart;

  const reply: GatewayReply = {
    turnId,
    sessionKey,
    ...(transcript !== undefined && { transcript }),
    assistant: { fullText: clawResponse.text, segments, truncated },
    timing: { sttMs, agentMs, totalMs },
    meta: { provider, model },
  };

  return { reply, agentMs };
}
