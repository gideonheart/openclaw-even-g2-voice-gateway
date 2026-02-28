/**
 * Runtime configuration types.
 */

import type { ProviderId, SessionKey } from "./branded.js";

/** Gateway runtime configuration. */
export interface GatewayConfig {
  /** OpenClaw WebSocket gateway URL. */
  readonly openclawGatewayUrl: string;
  /** OpenClaw authentication token (secret). */
  readonly openclawGatewayToken: string;
  /** Target OpenClaw session key. */
  readonly openclawSessionKey: SessionKey;
  /** Active STT provider. */
  readonly sttProvider: ProviderId;
  /** WhisperX-specific config. */
  readonly whisperx: WhisperXConfig;
  /** OpenAI STT-specific config. */
  readonly openai: OpenAIConfig;
  /** Custom HTTP STT config. */
  readonly customHttp: CustomHttpConfig;
  /** Server configuration. */
  readonly server: ServerConfig;
}

export interface WhisperXConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly language: string;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
}

export interface OpenAIConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly language: string;
}

export interface CustomHttpConfig {
  readonly url: string;
  readonly authHeader: string;
  readonly requestMapping: Record<string, string>;
  readonly responseMapping: ResponseMapping;
}

export interface ResponseMapping {
  readonly textField: string;
  readonly languageField: string;
  readonly confidenceField: string;
}

export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly corsOrigins: readonly string[];
  readonly maxAudioBytes: number;
  readonly rateLimitPerMinute: number;
}

/** Safe config for API responses — secrets masked. */
export interface SafeGatewayConfig {
  readonly openclawGatewayUrl: string;
  readonly openclawGatewayToken: "********";
  readonly openclawSessionKey: SessionKey;
  readonly sttProvider: ProviderId;
  readonly whisperx: { readonly baseUrl: string; readonly model: string };
  readonly openai: { readonly apiKey: "********"; readonly model: string };
  readonly customHttp: {
    readonly url: string;
    readonly authHeader: "********";
  };
  readonly server: ServerConfig;
}
