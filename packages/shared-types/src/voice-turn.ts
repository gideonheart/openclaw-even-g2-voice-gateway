/**
 * Core domain types for the voice turn pipeline.
 *
 * Audio in → STT → OpenClaw → Shaped Response out.
 */

import type { TurnId, SessionKey, ProviderId } from "./branded.js";

// ── Audio Input ──

/** Supported audio content types. */
export type AudioContentType =
  | "audio/wav"
  | "audio/x-wav"
  | "audio/pcm"
  | "audio/ogg"
  | "audio/mpeg"
  | "audio/webm";

/** Incoming audio payload metadata. */
export interface AudioPayload {
  /** Raw audio buffer. */
  readonly data: Buffer;
  /** MIME content type of the audio. */
  readonly contentType: AudioContentType;
  /** Optional sample rate hint (Hz). */
  readonly sampleRate?: number | undefined;
  /** Optional language hint (ISO 639-1). */
  readonly languageHint?: string | undefined;
}

// ── STT Result ──

/** Normalized output from any STT provider — provider-agnostic. */
export interface SttResult {
  /** Transcribed text. */
  readonly text: string;
  /** Detected language (ISO 639-1). */
  readonly language: string;
  /** Confidence score 0.0–1.0 (null if provider doesn't report it). */
  readonly confidence: number | null;
  /** Provider that produced this result. */
  readonly providerId: ProviderId;
  /** Transcription duration in milliseconds. */
  readonly durationMs: number;
}

// ── OpenClaw Messages ──

/** Message sent to OpenClaw session. */
export interface OpenClawOutbound {
  readonly sessionKey: SessionKey;
  readonly turnId: TurnId;
  readonly text: string;
  readonly timestamp: string;
}

/** Response received from OpenClaw session. */
export interface OpenClawInbound {
  readonly sessionKey: SessionKey;
  readonly turnId: TurnId;
  readonly text: string;
  readonly timestamp: string;
}

// ── Response Shaping ──

/** A segment of the shaped response text. */
export interface ResponseSegment {
  /** Segment index (0-based). */
  readonly index: number;
  /** Text content of this segment. */
  readonly text: string;
  /** Whether this segment continues from the previous. */
  readonly continuation: boolean;
}

/** Timing breakdown for a voice turn. */
export interface TurnTiming {
  /** STT transcription time (ms). */
  readonly sttMs: number;
  /** OpenClaw agent response time (ms). */
  readonly agentMs: number;
  /** Total end-to-end time (ms). */
  readonly totalMs: number;
}

/** Provider metadata included in response. */
export interface ProviderMeta {
  /** STT provider used. */
  readonly provider: ProviderId;
  /** Model name if known. */
  readonly model: string | null;
}

/** The full structured response envelope — RESP-01. */
export interface GatewayReply {
  /** Correlation ID for this turn. */
  readonly turnId: TurnId;
  /** Session this turn belongs to. */
  readonly sessionKey: SessionKey;
  /** Shaped assistant response. */
  readonly assistant: {
    /** Full untruncated text. */
    readonly fullText: string;
    /** Segmented text for glasses viewport. */
    readonly segments: readonly ResponseSegment[];
    /** Whether the response was truncated. */
    readonly truncated: boolean;
  };
  /** Per-turn timing breakdown. */
  readonly timing: TurnTiming;
  /** Provider metadata. */
  readonly meta: ProviderMeta;
}

// ── Voice Turn Request/Result ──

/** Input to the voice turn pipeline. */
export interface VoiceTurnRequest {
  /** Correlation ID for tracing. */
  readonly turnId: TurnId;
  /** Target OpenClaw session. */
  readonly sessionKey: SessionKey;
  /** Audio payload to transcribe. */
  readonly audio: AudioPayload;
}

/** Result of a completed voice turn. */
export interface VoiceTurnResult {
  /** The full gateway reply. */
  readonly reply: GatewayReply;
  /** The raw STT result (for debugging). */
  readonly sttResult: SttResult;
}
