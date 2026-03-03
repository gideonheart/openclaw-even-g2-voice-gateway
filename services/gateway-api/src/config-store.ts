/**
 * Mutable configuration store with immutable read snapshots.
 *
 * Single source of truth for runtime configuration. Consumers read
 * via get() (full config) or getSafe() (secrets masked). Mutations
 * arrive via update() which shallow-merges nested objects and fires
 * registered change listeners.
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

// -- Public types --

/**
 * A validated partial update for GatewayConfig.
 * All fields optional at both top and nested levels.
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

/** Callback fired after ConfigStore.update(). */
export type ConfigChangeListener = (
  patch: ValidatedSettingsPatch,
  config: Readonly<GatewayConfig>,
) => void;

// -- ConfigStore --

/**
 * Mutable configuration store.
 *
 * - get()     returns full config for internal consumers
 * - getSafe() returns masked config safe for API responses
 * - update()  applies a validated partial patch, fires listeners
 * - onChange() registers a change listener
 */
export class ConfigStore {
  private config: GatewayConfig;
  private readonly listeners: ConfigChangeListener[] = [];

  constructor(initial: GatewayConfig) {
    this.config = { ...initial };
  }

  /** Register a listener called after every update(). */
  onChange(listener: ConfigChangeListener): void {
    this.listeners.push(listener);
  }

  /** Return the current full config (readonly view). */
  get(): Readonly<GatewayConfig> {
    return this.config;
  }

  /** Return config with secrets masked -- safe for API responses. */
  getSafe(): SafeGatewayConfig {
    const c = this.config;
    return {
      openclawGatewayUrl: c.openclawGatewayUrl,
      openclawGatewayToken: "********",
      openclawSessionKey: c.openclawSessionKey,
      sttProvider: c.sttProvider,
      whisperx: { baseUrl: c.whisperx.baseUrl, model: c.whisperx.model },
      openai: { apiKey: "********", model: c.openai.model },
      customHttp: { url: c.customHttp.url, authHeader: "********" },
      server: c.server,
    };
  }

  /**
   * Apply a validated partial update.
   *
   * Top-level scalars are overwritten. Nested objects are shallow-merged
   * so partial nested updates preserve sibling fields.
   */
  update(patch: ValidatedSettingsPatch): void {
    const prev = this.config;

    this.config = {
      ...prev,
      ...(patch.openclawGatewayUrl !== undefined && { openclawGatewayUrl: patch.openclawGatewayUrl }),
      ...(patch.openclawGatewayToken !== undefined && { openclawGatewayToken: patch.openclawGatewayToken }),
      ...(patch.openclawSessionKey !== undefined && { openclawSessionKey: patch.openclawSessionKey }),
      ...(patch.sttProvider !== undefined && { sttProvider: patch.sttProvider }),
      ...(patch.whisperx !== undefined && { whisperx: { ...prev.whisperx, ...patch.whisperx } }),
      ...(patch.openai !== undefined && { openai: { ...prev.openai, ...patch.openai } }),
      ...(patch.customHttp !== undefined && { customHttp: { ...prev.customHttp, ...patch.customHttp } }),
      ...(patch.server !== undefined && { server: { ...prev.server, ...patch.server } }),
    };

    for (const fn of this.listeners) fn(patch, this.config);
  }
}

// -- Validation --

/**
 * Validate a raw settings patch from an external source.
 *
 * Only present fields are validated. Unknown top-level fields are silently
 * ignored. Branded-type constructor TypeErrors are re-thrown as UserError
 * so the HTTP layer returns 400.
 */
export function validateSettingsPatch(body: unknown): ValidatedSettingsPatch {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    throw new UserError(ErrorCodes.INVALID_CONFIG, "Settings patch must be a non-null object.");
  }

  const raw = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  // -- Top-level scalars --

  if (has(raw, "openclawGatewayUrl")) {
    patch["openclawGatewayUrl"] = validateUrl(String(raw["openclawGatewayUrl"]), "openclawGatewayUrl");
  }

  if (has(raw, "openclawGatewayToken")) {
    patch["openclawGatewayToken"] = requireNonEmpty(String(raw["openclawGatewayToken"]), "openclawGatewayToken");
  }

  if (has(raw, "openclawSessionKey")) {
    patch["openclawSessionKey"] = brandSafe(() => createSessionKey(String(raw["openclawSessionKey"])));
  }

  if (has(raw, "sttProvider")) {
    patch["sttProvider"] = brandSafe(() => createProviderId(String(raw["sttProvider"])));
  }

  // -- Nested: whisperx --

  if (has(raw, "whisperx")) {
    const nested = requireObject(raw["whisperx"], "whisperx");
    const fields: Record<string, unknown> = {};
    if (has(nested, "baseUrl")) fields["baseUrl"] = validateUrl(String(nested["baseUrl"]), "whisperx.baseUrl");
    if (has(nested, "model")) fields["model"] = requireNonEmpty(String(nested["model"]), "whisperx.model");
    if (has(nested, "language")) fields["language"] = requireNonEmpty(String(nested["language"]), "whisperx.language");
    if (has(nested, "pollIntervalMs")) fields["pollIntervalMs"] = validatePositiveInt(nested["pollIntervalMs"], "whisperx.pollIntervalMs");
    if (has(nested, "timeoutMs")) fields["timeoutMs"] = validatePositiveInt(nested["timeoutMs"], "whisperx.timeoutMs");
    if (Object.keys(fields).length > 0) patch["whisperx"] = fields;
  }

  // -- Nested: openai --

  if (has(raw, "openai")) {
    const nested = requireObject(raw["openai"], "openai");
    const fields: Record<string, unknown> = {};
    if (has(nested, "apiKey")) fields["apiKey"] = requireNonEmpty(String(nested["apiKey"]), "openai.apiKey");
    if (has(nested, "model")) fields["model"] = requireNonEmpty(String(nested["model"]), "openai.model");
    if (has(nested, "language")) fields["language"] = requireNonEmpty(String(nested["language"]), "openai.language");
    if (Object.keys(fields).length > 0) patch["openai"] = fields;
  }

  // -- Nested: customHttp --

  if (has(raw, "customHttp")) {
    const nested = requireObject(raw["customHttp"], "customHttp");
    const fields: Record<string, unknown> = {};
    if (has(nested, "url")) fields["url"] = validateUrl(String(nested["url"]), "customHttp.url");
    if (has(nested, "authHeader")) fields["authHeader"] = requireNonEmpty(String(nested["authHeader"]), "customHttp.authHeader");
    if (Object.keys(fields).length > 0) patch["customHttp"] = fields;
  }

  return patch as ValidatedSettingsPatch;
}

// -- Internal helpers --

/** Check whether a key is present and its value is not undefined. */
function has(obj: Record<string, unknown>, key: string): boolean {
  return key in obj && obj[key] !== undefined;
}

/** Assert that a value is a non-null object, or throw UserError. */
function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value == null) {
    throw new UserError(ErrorCodes.INVALID_CONFIG, `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** Call a branded-type constructor, catching TypeError and re-throwing as UserError. */
function brandSafe<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof TypeError) {
      throw new UserError(ErrorCodes.INVALID_CONFIG, err.message);
    }
    throw err;
  }
}
