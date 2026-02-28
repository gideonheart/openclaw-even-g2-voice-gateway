/**
 * OpenAI STT provider — synchronous transcription API.
 *
 * PIPE-05: OpenAI cloud provider using the transcriptions API.
 *
 * Flow:
 * 1. POST /v1/audio/transcriptions with multipart audio + model
 * 2. Get transcript text back synchronously
 */

import type {
  AudioPayload,
  SttResult,
  ProviderId,
  OpenAIConfig,
} from "@voice-gateway/shared-types";
import {
  ProviderIds,
  UserError,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";
import type { SttProvider, SttContext, SttHealthStatus } from "@voice-gateway/stt-contract";
import type { Logger } from "@voice-gateway/logging";

const OPENAI_API_BASE = "https://api.openai.com/v1";

const DEFAULTS: OpenAIConfig = {
  apiKey: "",
  model: "whisper-1",
  language: "en",
};

export class OpenAIProvider implements SttProvider {
  readonly providerId: ProviderId = ProviderIds.OpenAI;
  readonly name = "OpenAI STT";

  private readonly config: OpenAIConfig;
  private readonly log: Logger;

  constructor(config: Partial<OpenAIConfig>, logger: Logger) {
    this.config = { ...DEFAULTS, ...config };
    this.log = logger.child({ provider: "openai" });
  }

  async transcribe(audio: AudioPayload, ctx: SttContext): Promise<SttResult> {
    const startMs = Date.now();
    const log = this.log.child({ turnId: ctx.turnId });

    if (this.config.apiKey.length === 0) {
      throw new OperatorError(
        ErrorCodes.MISSING_CONFIG,
        "OpenAI API key not configured",
        "OPENAI_API_KEY is empty",
      );
    }

    log.info("Starting OpenAI transcription", {
      contentType: audio.contentType,
      audioBytes: audio.data.length,
      model: this.config.model,
    });

    const formData = new FormData();
    const blob = new Blob([audio.data], { type: audio.contentType });
    formData.append("file", blob, `audio.${this.getExtension(audio.contentType)}`);
    formData.append("model", this.config.model);
    formData.append("response_format", "verbose_json");

    const language = ctx.languageHint ?? this.config.language;
    if (language) {
      formData.append("language", language);
    }

    try {
      const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: formData,
        signal: ctx.signal ?? AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 401) {
          throw new OperatorError(
            ErrorCodes.STT_UNAVAILABLE,
            "OpenAI authentication failed",
            `HTTP 401: ${body}`,
          );
        }
        if (response.status === 429) {
          throw new UserError(
            ErrorCodes.RATE_LIMITED,
            "OpenAI rate limit exceeded. Please try again shortly.",
          );
        }
        throw new OperatorError(
          ErrorCodes.STT_TRANSCRIPTION_FAILED,
          "OpenAI transcription failed",
          `HTTP ${response.status}: ${body}`,
        );
      }

      const data = (await response.json()) as {
        text?: string;
        language?: string;
        duration?: number;
      };

      const text = data.text ?? "";
      if (text.length === 0) {
        throw new UserError(
          ErrorCodes.STT_TRANSCRIPTION_FAILED,
          "Transcription returned empty text. The audio may be silent or too short.",
        );
      }

      const durationMs = Date.now() - startMs;

      log.info("OpenAI transcription complete", {
        durationMs,
        textLength: text.length,
        detectedLanguage: data.language,
      });

      return {
        text,
        language: data.language ?? language,
        confidence: null, // Whisper API doesn't return confidence
        providerId: this.providerId,
        model: this.config.model,
        durationMs,
      };
    } catch (err) {
      if (err instanceof UserError || err instanceof OperatorError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new UserError(
          ErrorCodes.STT_TIMEOUT,
          "Transcription timed out. Please try again.",
        );
      }
      throw new OperatorError(
        ErrorCodes.STT_UNAVAILABLE,
        "Could not reach OpenAI API",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async healthCheck(): Promise<SttHealthStatus> {
    const startMs = Date.now();

    if (this.config.apiKey.length === 0) {
      return {
        healthy: false,
        message: "OpenAI API key not configured",
        latencyMs: 0,
      };
    }

    try {
      // Use models endpoint as a lightweight health check
      const response = await fetch(`${OPENAI_API_BASE}/models/whisper-1`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - startMs;

      return {
        healthy: response.ok,
        message: response.ok
          ? "OpenAI API healthy"
          : `HTTP ${response.status}`,
        latencyMs,
      };
    } catch (err) {
      return {
        healthy: false,
        message: `OpenAI unreachable: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - startMs,
      };
    }
  }

  private getExtension(contentType: string): string {
    const map: Record<string, string> = {
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/pcm": "pcm",
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/webm": "webm",
    };
    return map[contentType] ?? "bin";
  }
}
