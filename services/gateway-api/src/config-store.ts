/**
 * ConfigStore — mutable config wrapper with immutable snapshots.
 *
 * Single source of truth for runtime configuration. All readers
 * (server handlers, orchestrator, readyz) read from ConfigStore.
 * The validation function ensures all external input is validated
 * before reaching business logic.
 *
 * CONF-03: Runtime settings mutations via ConfigStore.update()
 * CONF-04: Validated settings patch for POST /api/settings
 */

import type {
  GatewayConfig,
  SafeGatewayConfig,
  WhisperXConfig,
  OpenAIConfig,
  CustomHttpConfig,
  ServerConfig,
} from "@voice-gateway/shared-types";

/**
 * A validated partial update for GatewayConfig.
 * All fields are optional at both top and nested levels.
 */
export interface ValidatedSettingsPatch {
  readonly openclawGatewayUrl?: string;
  readonly openclawGatewayToken?: string;
  readonly openclawSessionKey?: GatewayConfig["openclawSessionKey"];
  readonly sttProvider?: GatewayConfig["sttProvider"];
  readonly whisperx?: Partial<WhisperXConfig>;
  readonly openai?: Partial<OpenAIConfig>;
  readonly customHttp?: Partial<Omit<CustomHttpConfig, "requestMapping" | "responseMapping">>;
  readonly server?: Partial<ServerConfig>;
}

/**
 * Mutable configuration store with immutable read snapshots.
 *
 * Wraps GatewayConfig and provides:
 * - `get()` — full config for internal consumers
 * - `getSafe()` — masked config for API responses (secrets hidden)
 * - `update()` — applies a validated partial patch
 */
export class ConfigStore {
  private config: GatewayConfig;

  constructor(initial: GatewayConfig) {
    this.config = { ...initial };
  }

  /** Returns the current full config (readonly view). */
  get(): Readonly<GatewayConfig> {
    return this.config;
  }

  /** Returns config with all secrets masked — safe for API responses. */
  getSafe(): SafeGatewayConfig {
    return {
      openclawGatewayUrl: this.config.openclawGatewayUrl,
      openclawGatewayToken: "********",
      openclawSessionKey: this.config.openclawSessionKey,
      sttProvider: this.config.sttProvider,
      whisperx: {
        baseUrl: this.config.whisperx.baseUrl,
        model: this.config.whisperx.model,
      },
      openai: {
        apiKey: "********",
        model: this.config.openai.model,
      },
      customHttp: {
        url: this.config.customHttp.url,
        authHeader: "********",
      },
      server: this.config.server,
    };
  }

  /**
   * Applies a validated partial update to the config.
   *
   * Top-level scalar fields are overwritten.
   * Nested objects (whisperx, openai, customHttp, server) are shallow-merged
   * so partial nested updates don't destroy sibling fields.
   */
  update(patch: ValidatedSettingsPatch): void {
    this.config = {
      ...this.config,
      ...(patch.openclawGatewayUrl !== undefined && {
        openclawGatewayUrl: patch.openclawGatewayUrl,
      }),
      ...(patch.openclawGatewayToken !== undefined && {
        openclawGatewayToken: patch.openclawGatewayToken,
      }),
      ...(patch.openclawSessionKey !== undefined && {
        openclawSessionKey: patch.openclawSessionKey,
      }),
      ...(patch.sttProvider !== undefined && {
        sttProvider: patch.sttProvider,
      }),
      ...(patch.whisperx !== undefined && {
        whisperx: { ...this.config.whisperx, ...patch.whisperx },
      }),
      ...(patch.openai !== undefined && {
        openai: { ...this.config.openai, ...patch.openai },
      }),
      ...(patch.customHttp !== undefined && {
        customHttp: { ...this.config.customHttp, ...patch.customHttp },
      }),
      ...(patch.server !== undefined && {
        server: { ...this.config.server, ...patch.server },
      }),
    };
  }
}
