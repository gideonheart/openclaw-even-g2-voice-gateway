/**
 * WhisperX STT provider — async submit-then-poll pattern.
 *
 * PIPE-04: WhisperX self-hosted provider using logingrupa/whisperX-FastAPI.
 *
 * Flow:
 * 1. POST /speech-to-text with multipart audio → get task identifier
 * 2. GET /task/{identifier} poll until completed
 * 3. Extract transcript from completed task result
 */

import type {
  AudioPayload,
  SttResult,
  ProviderId,
  WhisperXConfig,
} from "@voice-gateway/shared-types";
import {
  ProviderIds,
  UserError,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";
import type { SttProvider, SttContext, SttHealthStatus } from "@voice-gateway/stt-contract";
import type { Logger } from "@voice-gateway/logging";

/** WhisperX task status from the API. */
interface WhisperXTaskStatus {
  identifier: string;
  status: "queued" | "processing" | "completed" | "failed";
  result?: {
    text?: string;
    language?: string;
    segments?: Array<{ text: string }>;
  };
  error?: string;
}

/** Default configuration values. */
const DEFAULTS: WhisperXConfig = {
  baseUrl: "https://wsp.kingdom.lv",
  model: "medium",
  language: "en",
  pollIntervalMs: 3000,
  timeoutMs: 300_000,
};

export class WhisperXProvider implements SttProvider {
  readonly providerId: ProviderId = ProviderIds.WhisperX;
  readonly name = "WhisperX (self-hosted)";

  private readonly config: WhisperXConfig;
  private readonly log: Logger;

  constructor(config: Partial<WhisperXConfig>, logger: Logger) {
    this.config = { ...DEFAULTS, ...config };
    this.log = logger.child({ provider: "whisperx" });
  }

  async transcribe(audio: AudioPayload, ctx: SttContext): Promise<SttResult> {
    const startMs = Date.now();
    const log = this.log.child({ turnId: ctx.turnId });

    log.info("Starting WhisperX transcription", {
      contentType: audio.contentType,
      audioBytes: audio.data.length,
      language: ctx.languageHint ?? this.config.language,
    });

    // Step 1: Submit audio
    const taskId = await this.submitAudio(audio, ctx);
    log.info("WhisperX task submitted", { taskId });

    // Step 2: Poll for result
    const result = await this.pollForResult(taskId, ctx);
    const durationMs = Date.now() - startMs;

    log.info("WhisperX transcription complete", {
      taskId,
      durationMs,
      textLength: result.text.length,
    });

    return {
      text: result.text,
      language: result.language,
      confidence: result.confidence,
      providerId: this.providerId,
      durationMs,
    };
  }

  async healthCheck(): Promise<SttHealthStatus> {
    const startMs = Date.now();
    try {
      const response = await fetch(`${this.config.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - startMs;

      return {
        healthy: response.ok,
        message: response.ok ? "WhisperX healthy" : `HTTP ${response.status}`,
        latencyMs,
      };
    } catch (err) {
      return {
        healthy: false,
        message: `WhisperX unreachable: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - startMs,
      };
    }
  }

  // ── Private ──

  private async submitAudio(
    audio: AudioPayload,
    ctx: SttContext,
  ): Promise<string> {
    const language = ctx.languageHint ?? this.config.language;

    // Build multipart form with the audio file
    const formData = new FormData();
    const blob = new Blob([audio.data], { type: audio.contentType });
    formData.append("file", blob, `audio.${this.getExtension(audio.contentType)}`);

    const url = new URL("/speech-to-text", this.config.baseUrl);
    url.searchParams.set("language", language);
    url.searchParams.set("model", this.config.model);
    url.searchParams.set("task", "transcribe");

    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        body: formData,
        signal: ctx.signal ?? AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OperatorError(
          ErrorCodes.STT_TRANSCRIPTION_FAILED,
          "WhisperX upload failed",
          `HTTP ${response.status}: ${body}`,
        );
      }

      const data = (await response.json()) as { identifier?: string };
      if (!data.identifier) {
        throw new OperatorError(
          ErrorCodes.STT_TRANSCRIPTION_FAILED,
          "WhisperX returned no task identifier",
          JSON.stringify(data),
        );
      }

      return data.identifier;
    } catch (err) {
      if (err instanceof OperatorError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new UserError(
          ErrorCodes.STT_TIMEOUT,
          "Transcription upload timed out. Please try again.",
        );
      }
      throw new OperatorError(
        ErrorCodes.STT_UNAVAILABLE,
        "Could not reach WhisperX",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async pollForResult(
    taskId: string,
    ctx: SttContext,
  ): Promise<{ text: string; language: string; confidence: number | null }> {
    const deadline = Date.now() + this.config.timeoutMs;
    const url = `${this.config.baseUrl}/task/${taskId}`;

    while (Date.now() < deadline) {
      // Check for cancellation
      if (ctx.signal?.aborted) {
        throw new UserError(
          ErrorCodes.STT_TIMEOUT,
          "Transcription was cancelled.",
        );
      }

      try {
        const response = await fetch(url, {
          signal: ctx.signal ?? AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          this.log.warn("WhisperX poll returned non-OK", {
            taskId,
            status: response.status,
          });
        } else {
          const task = (await response.json()) as WhisperXTaskStatus;

          switch (task.status) {
            case "completed": {
              const text = task.result?.text ?? "";
              if (text.length === 0) {
                throw new UserError(
                  ErrorCodes.STT_TRANSCRIPTION_FAILED,
                  "Transcription returned empty text. The audio may be silent or too short.",
                );
              }
              return {
                text,
                language: task.result?.language ?? this.config.language,
                confidence: null, // WhisperX doesn't report confidence
              };
            }
            case "failed":
              throw new OperatorError(
                ErrorCodes.STT_TRANSCRIPTION_FAILED,
                "WhisperX transcription failed",
                task.error ?? "Unknown error",
              );
            case "queued":
            case "processing":
              // Continue polling
              break;
          }
        }
      } catch (err) {
        if (err instanceof UserError || err instanceof OperatorError) throw err;
        this.log.warn("WhisperX poll error (retrying)", {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Wait before next poll
      await this.sleep(this.config.pollIntervalMs, ctx.signal);
    }

    throw new UserError(
      ErrorCodes.STT_TIMEOUT,
      "Transcription timed out. The audio may be too long or the server is busy.",
    );
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new UserError(ErrorCodes.STT_TIMEOUT, "Transcription was cancelled."));
        },
        { once: true },
      );
    });
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
