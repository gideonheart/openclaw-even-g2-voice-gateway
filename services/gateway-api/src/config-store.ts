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
import {
  createProviderId,
  createSessionKey,
  UserError,
  ErrorCodes,
} from "@voice-gateway/shared-types";
import {
  validateUrl,
  requireNonEmpty,
  validatePositiveInt,
} from "@voice-gateway/validation";

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

/** Callback fired after ConfigStore.update() with the patch and fully merged config. */
export type ConfigChangeListener = (
  patch: ValidatedSettingsPatch,
  config: Readonly<GatewayConfig>,
) => void;

/**
 * Mutable configuration store with immutable read snapshots.
 *
 * Wraps GatewayConfig and provides:
 * - `get()` — full config for internal consumers
 * - `getSafe()` — masked config for API responses (secrets hidden)
 * - `update()` — applies a validated partial patch
 * - `onChange()` — registers a listener for config changes
 */
export class ConfigStore {
  private config: GatewayConfig;
  private readonly listeners: ConfigChangeListener[] = [];

  constructor(initial: GatewayConfig) {
    this.config = { ...initial };
  }

  /** Registers a listener that is called after every update() with the patch and new config. */
  onChange(listener: ConfigChangeListener): void {
    this.listeners.push(listener);
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

    for (const fn of this.listeners) fn(patch, this.config);
  }
}

// ── Validation ──

/**
 * Validates a raw settings patch from an external source (e.g., POST /api/settings).
 *
 * Only present fields are validated. Unknown top-level fields are silently ignored.
 * Catches TypeError from branded constructors and rethrows as UserError
 * so the HTTP layer returns 400, not 500.
 *
 * @param body - Raw input from request body (unknown type)
 * @returns A validated partial settings patch safe for ConfigStore.update()
 * @throws UserError with INVALID_CONFIG code for any validation failure
 */
export function validateSettingsPatch(body: unknown): ValidatedSettingsPatch {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new UserError(
      ErrorCodes.INVALID_CONFIG,
      "Settings patch must be a non-null object.",
    );
  }

  const raw = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  // ── Top-level scalars ──

  if ("openclawGatewayUrl" in raw && raw["openclawGatewayUrl"] !== undefined) {
    patch.openclawGatewayUrl = validateUrl(
      String(raw["openclawGatewayUrl"]),
      "openclawGatewayUrl",
    );
  }

  if ("openclawGatewayToken" in raw && raw["openclawGatewayToken"] !== undefined) {
    patch.openclawGatewayToken = requireNonEmpty(
      String(raw["openclawGatewayToken"]),
      "openclawGatewayToken",
    );
  }

  if ("openclawSessionKey" in raw && raw["openclawSessionKey"] !== undefined) {
    try {
      patch.openclawSessionKey = createSessionKey(String(raw["openclawSessionKey"]));
    } catch (err) {
      if (err instanceof TypeError) {
        throw new UserError(ErrorCodes.INVALID_CONFIG, err.message);
      }
      throw err;
    }
  }

  if ("sttProvider" in raw && raw["sttProvider"] !== undefined) {
    try {
      patch.sttProvider = createProviderId(String(raw["sttProvider"]));
    } catch (err) {
      if (err instanceof TypeError) {
        throw new UserError(ErrorCodes.INVALID_CONFIG, err.message);
      }
      throw err;
    }
  }

  // ── Nested: whisperx ──

  if ("whisperx" in raw && raw["whisperx"] !== undefined) {
    if (typeof raw["whisperx"] !== "object" || raw["whisperx"] == null) {
      throw new UserError(ErrorCodes.INVALID_CONFIG, "whisperx must be an object.");
    }
    const wxRaw = raw["whisperx"] as Record<string, unknown>;
    const wx: Record<string, unknown> = {};

    if ("baseUrl" in wxRaw && wxRaw["baseUrl"] !== undefined) {
      wx.baseUrl = validateUrl(String(wxRaw["baseUrl"]), "whisperx.baseUrl");
    }
    if ("model" in wxRaw && wxRaw["model"] !== undefined) {
      wx.model = requireNonEmpty(String(wxRaw["model"]), "whisperx.model");
    }
    if ("language" in wxRaw && wxRaw["language"] !== undefined) {
      wx.language = requireNonEmpty(String(wxRaw["language"]), "whisperx.language");
    }
    if ("pollIntervalMs" in wxRaw && wxRaw["pollIntervalMs"] !== undefined) {
      wx.pollIntervalMs = validatePositiveInt(wxRaw["pollIntervalMs"], "whisperx.pollIntervalMs");
    }
    if ("timeoutMs" in wxRaw && wxRaw["timeoutMs"] !== undefined) {
      wx.timeoutMs = validatePositiveInt(wxRaw["timeoutMs"], "whisperx.timeoutMs");
    }

    if (Object.keys(wx).length > 0) {
      patch.whisperx = wx;
    }
  }

  // ── Nested: openai ──

  if ("openai" in raw && raw["openai"] !== undefined) {
    if (typeof raw["openai"] !== "object" || raw["openai"] == null) {
      throw new UserError(ErrorCodes.INVALID_CONFIG, "openai must be an object.");
    }
    const oaiRaw = raw["openai"] as Record<string, unknown>;
    const oai: Record<string, unknown> = {};

    if ("apiKey" in oaiRaw && oaiRaw["apiKey"] !== undefined) {
      oai.apiKey = requireNonEmpty(String(oaiRaw["apiKey"]), "openai.apiKey");
    }
    if ("model" in oaiRaw && oaiRaw["model"] !== undefined) {
      oai.model = requireNonEmpty(String(oaiRaw["model"]), "openai.model");
    }
    if ("language" in oaiRaw && oaiRaw["language"] !== undefined) {
      oai.language = requireNonEmpty(String(oaiRaw["language"]), "openai.language");
    }

    if (Object.keys(oai).length > 0) {
      patch.openai = oai;
    }
  }

  // ── Nested: customHttp ──

  if ("customHttp" in raw && raw["customHttp"] !== undefined) {
    if (typeof raw["customHttp"] !== "object" || raw["customHttp"] == null) {
      throw new UserError(ErrorCodes.INVALID_CONFIG, "customHttp must be an object.");
    }
    const chRaw = raw["customHttp"] as Record<string, unknown>;
    const ch: Record<string, unknown> = {};

    if ("url" in chRaw && chRaw["url"] !== undefined) {
      ch.url = validateUrl(String(chRaw["url"]), "customHttp.url");
    }
    if ("authHeader" in chRaw && chRaw["authHeader"] !== undefined) {
      ch.authHeader = requireNonEmpty(String(chRaw["authHeader"]), "customHttp.authHeader");
    }

    if (Object.keys(ch).length > 0) {
      patch.customHttp = ch;
    }
  }

  return patch as ValidatedSettingsPatch;
}
