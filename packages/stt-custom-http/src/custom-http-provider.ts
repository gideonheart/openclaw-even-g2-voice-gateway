/**
 * Custom HTTP STT provider — configurable URL, auth, and request/response mapping.
 *
 * PIPE-06: Generic HTTP adapter for any external STT service.
 *
 * Flow:
 * 1. POST audio to configured URL with auth header
 * 2. Map response fields using configurable mapping
 * 3. Normalize to SttResult
 */

import type {
  AudioPayload,
  SttResult,
  ProviderId,
  CustomHttpConfig,
} from "@voice-gateway/shared-types";
import {
  ProviderIds,
  UserError,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";
import type { SttProvider, SttContext, SttHealthStatus } from "@voice-gateway/stt-contract";
import type { Logger } from "@voice-gateway/logging";

const DEFAULTS: CustomHttpConfig = {
  url: "",
  authHeader: "",
  requestMapping: {},
  responseMapping: {
    textField: "text",
    languageField: "language",
    confidenceField: "confidence",
  },
};

export class CustomHttpProvider implements SttProvider {
  readonly providerId: ProviderId = ProviderIds.Custom;
  readonly name = "Custom HTTP STT";

  private readonly config: CustomHttpConfig;
  private readonly log: Logger;

  constructor(config: Partial<CustomHttpConfig>, logger: Logger) {
    this.config = { ...DEFAULTS, ...config };
    this.log = logger.child({ provider: "custom-http" });
  }

  async transcribe(audio: AudioPayload, ctx: SttContext): Promise<SttResult> {
    const startMs = Date.now();
    const log = this.log.child({ turnId: ctx.turnId });

    if (this.config.url.length === 0) {
      throw new OperatorError(
        ErrorCodes.MISSING_CONFIG,
        "Custom STT URL not configured",
        "CUSTOM_STT_URL is empty",
      );
    }

    log.info("Starting Custom HTTP transcription", {
      url: this.config.url,
      contentType: audio.contentType,
      audioBytes: audio.data.length,
    });

    const formData = new FormData();
    const blob = new Blob([audio.data], { type: audio.contentType });
    formData.append("file", blob, `audio.${this.getExtension(audio.contentType)}`);

    // Add any custom request fields
    if (audio.sampleRate != null) {
      formData.append("sampleRate", String(audio.sampleRate));
    }
    const language = ctx.languageHint ?? "en";
    formData.append("languageHint", language);

    // Add custom request mapping fields
    for (const [key, value] of Object.entries(this.config.requestMapping)) {
      formData.append(key, value);
    }

    const headers: Record<string, string> = {};
    if (this.config.authHeader.length > 0) {
      headers["Authorization"] = this.config.authHeader;
    }

    try {
      const response = await fetch(this.config.url, {
        method: "POST",
        headers,
        body: formData,
        signal: ctx.signal ?? AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new OperatorError(
          ErrorCodes.STT_TRANSCRIPTION_FAILED,
          "Custom STT provider returned an error",
          `HTTP ${response.status}: ${body}`,
        );
      }

      const data = (await response.json()) as Record<string, unknown>;
      const durationMs = Date.now() - startMs;

      // Extract fields using configurable mapping
      const text = this.extractField(data, this.config.responseMapping.textField);
      if (typeof text !== "string" || text.length === 0) {
        throw new UserError(
          ErrorCodes.STT_TRANSCRIPTION_FAILED,
          "Transcription returned empty text. The audio may be silent or too short.",
        );
      }

      const detectedLanguage = this.extractField(
        data,
        this.config.responseMapping.languageField,
      );
      const confidence = this.extractField(
        data,
        this.config.responseMapping.confidenceField,
      );

      log.info("Custom HTTP transcription complete", {
        durationMs,
        textLength: text.length,
      });

      return {
        text,
        language: typeof detectedLanguage === "string" ? detectedLanguage : language,
        confidence: typeof confidence === "number" ? confidence : null,
        providerId: this.providerId,
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
        "Could not reach custom STT provider",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async healthCheck(): Promise<SttHealthStatus> {
    const startMs = Date.now();

    if (this.config.url.length === 0) {
      return {
        healthy: false,
        message: "Custom STT URL not configured",
        latencyMs: 0,
      };
    }

    try {
      // Simple HEAD/GET check on the base URL
      const baseUrl = new URL(this.config.url);
      const healthUrl = `${baseUrl.origin}/health`;

      const headers: Record<string, string> = {};
      if (this.config.authHeader.length > 0) {
        headers["Authorization"] = this.config.authHeader;
      }

      const response = await fetch(healthUrl, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      const latencyMs = Date.now() - startMs;

      return {
        healthy: response.ok,
        message: response.ok ? "Custom STT healthy" : `HTTP ${response.status}`,
        latencyMs,
      };
    } catch (err) {
      return {
        healthy: false,
        message: `Custom STT unreachable: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - startMs,
      };
    }
  }

  /**
   * Extract a field from a nested object using dot notation.
   * e.g., "result.text" extracts obj.result.text
   */
  private extractField(
    data: Record<string, unknown>,
    fieldPath: string,
  ): unknown {
    const parts = fieldPath.split(".");
    let current: unknown = data;

    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
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
