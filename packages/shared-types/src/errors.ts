/**
 * Error taxonomy: UserError (safe for chat app) vs OperatorError (detailed for logs).
 *
 * SAFE-04: Strong error taxonomy separating user-facing from operator-facing errors.
 */

/** Base class for all gateway errors. */
export abstract class GatewayError extends Error {
  abstract readonly kind: "user" | "operator";
  abstract readonly code: string;
  readonly timestamp: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    this.timestamp = new Date().toISOString();
  }

  /** Structured representation for logging. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      kind: this.kind,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      ...(this.cause != null ? { cause: String(this.cause) } : {}),
    };
  }
}

/**
 * Error safe to surface to the chat app / glasses user.
 * Message is human-readable and contains no sensitive info.
 */
export class UserError extends GatewayError {
  readonly kind = "user" as const;

  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Error for operator/developer debugging only.
 * May contain sensitive details — never surface to end user.
 */
export class OperatorError extends GatewayError {
  readonly kind = "operator" as const;
  readonly detail: string;

  constructor(
    readonly code: string,
    message: string,
    detail: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.detail = detail;
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      detail: this.detail,
    };
  }
}

// ── Error codes ──

export const ErrorCodes = {
  // Audio / input
  INVALID_AUDIO: "INVALID_AUDIO",
  AUDIO_TOO_LARGE: "AUDIO_TOO_LARGE",
  INVALID_CONTENT_TYPE: "INVALID_CONTENT_TYPE",

  // STT
  STT_UNAVAILABLE: "STT_UNAVAILABLE",
  STT_TIMEOUT: "STT_TIMEOUT",
  STT_TRANSCRIPTION_FAILED: "STT_TRANSCRIPTION_FAILED",

  // OpenClaw
  OPENCLAW_UNAVAILABLE: "OPENCLAW_UNAVAILABLE",
  OPENCLAW_SESSION_ERROR: "OPENCLAW_SESSION_ERROR",
  OPENCLAW_TIMEOUT: "OPENCLAW_TIMEOUT",

  // Config
  INVALID_CONFIG: "INVALID_CONFIG",
  MISSING_CONFIG: "MISSING_CONFIG",

  // Server / lifecycle
  CORS_REJECTED: "CORS_REJECTED",
  NOT_READY: "NOT_READY",

  // General
  INTERNAL_ERROR: "INTERNAL_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
