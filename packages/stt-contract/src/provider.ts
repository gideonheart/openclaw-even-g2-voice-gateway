/**
 * STT Provider abstraction — PIPE-02.
 *
 * All STT providers implement this interface. The gateway orchestrator
 * depends only on this contract, never on concrete provider implementations.
 */

import type {
  AudioPayload,
  SttResult,
  ProviderId,
  TurnId,
} from "@voice-gateway/shared-types";

/** Context passed to the STT provider for each transcription request. */
export interface SttContext {
  /** Correlation ID for tracing this turn. */
  readonly turnId: TurnId;
  /** Optional language hint (ISO 639-1). */
  readonly languageHint?: string | undefined;
  /** Abort signal for cancellation. */
  readonly signal?: AbortSignal | undefined;
}

/** Health status of an STT provider. */
export interface SttHealthStatus {
  /** Whether the provider is reachable and ready. */
  readonly healthy: boolean;
  /** Human-readable status message. */
  readonly message: string;
  /** Latency of the health check in ms. */
  readonly latencyMs: number;
}

/**
 * Type-safe STT provider interface.
 *
 * Implementations:
 * - stt-whisperx: Async submit-then-poll pattern
 * - stt-openai: Synchronous API call
 * - stt-custom-http: Configurable HTTP adapter
 */
export interface SttProvider {
  /** Unique identifier for this provider. */
  readonly providerId: ProviderId;

  /** Human-readable name. */
  readonly name: string;

  /**
   * Transcribe an audio payload to text.
   *
   * @param audio - The audio data and metadata
   * @param ctx - Turn context with correlation ID and cancellation
   * @returns Normalized STT result
   * @throws UserError for user-facing failures
   * @throws OperatorError for internal failures
   */
  transcribe(audio: AudioPayload, ctx: SttContext): Promise<SttResult>;

  /**
   * Check if the provider is healthy and reachable.
   * Used by /readyz endpoint.
   */
  healthCheck(): Promise<SttHealthStatus>;
}
