/**
 * Structured JSON logger with per-turn correlation IDs and secret masking.
 *
 * OPS-04: Structured logging with TurnId propagation.
 * SAFE-05: Secret masking in all log output.
 */

import type { TurnId } from "@voice-gateway/shared-types";

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly turnId?: TurnId | undefined;
  readonly [key: string]: unknown;
}

/** Fields that should be masked in log output. */
const SECRET_FIELDS = new Set([
  "token",
  "apikey",
  "api_key",
  "apiKey",
  "authorization",
  "auth",
  "secret",
  "password",
  "credential",
  "openclawGatewayToken",
  "authHeader",
]);

const MASK = "********";

/** Recursively mask secret fields in an object. */
function maskSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map(maskSecrets);
  }

  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SECRET_FIELDS.has(key) && typeof value === "string") {
      masked[key] = MASK;
    } else if (typeof value === "object" && value !== null) {
      masked[key] = maskSecrets(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

export class Logger {
  private readonly context: Record<string, unknown>;

  constructor(context?: Record<string, unknown>) {
    this.context = context ?? {};
  }

  /** Create a child logger with additional context (e.g., turnId). */
  child(extra: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...extra });
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.context,
      ...data,
    };

    const masked = maskSecrets(entry) as LogEntry;
    const output = JSON.stringify(masked);

    switch (level) {
      case "debug":
        process.stderr.write(output + "\n");
        break;
      case "info":
        process.stdout.write(output + "\n");
        break;
      case "warn":
        process.stderr.write(output + "\n");
        break;
      case "error":
        process.stderr.write(output + "\n");
        break;
    }
  }
}

/** Singleton root logger. */
export const rootLogger = new Logger({ service: "voice-gateway" });
