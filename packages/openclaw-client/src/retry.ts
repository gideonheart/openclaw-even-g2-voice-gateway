/**
 * Exponential backoff retry utility with jitter.
 *
 * CLAW-03: Network calls use exponential backoff with jitter on transient failures.
 */

import { OperatorError, ErrorCodes } from "@voice-gateway/shared-types";

export interface RetryOptions {
  /** Maximum number of retry attempts. */
  readonly maxRetries: number;
  /** Initial delay in ms before first retry. */
  readonly baseDelayMs: number;
  /** Maximum delay in ms between retries. */
  readonly maxDelayMs: number;
  /** Abort signal for cancellation. */
  readonly signal?: AbortSignal | undefined;
}

const DEFAULT_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

/** Check if an error is transient and worth retrying. */
function isTransient(err: unknown): boolean {
  if (err instanceof OperatorError) {
    // Don't retry config/auth errors
    return (
      err.code !== ErrorCodes.MISSING_CONFIG &&
      err.code !== ErrorCodes.INVALID_CONFIG
    );
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("epipe") ||
      msg.includes("fetch failed") ||
      msg.includes("socket hang up") ||
      msg.includes("network")
    );
  }
  return false;
}

/**
 * Execute a function with exponential backoff retry.
 * Only retries on transient errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: Partial<RetryOptions>,
): Promise<T> {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry non-transient errors
      if (!isTransient(err)) {
        throw err;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= options.maxRetries) {
        break;
      }

      // Check cancellation
      if (options.signal?.aborted) {
        throw err;
      }

      // Calculate delay with exponential backoff + jitter
      const exponentialDelay = options.baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * options.baseDelayMs;
      const delay = Math.min(exponentialDelay + jitter, options.maxDelayMs);

      await sleep(delay, options.signal);
    }
  }

  throw lastError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Retry cancelled"));
      },
      { once: true },
    );
  });
}
