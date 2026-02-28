/**
 * Runtime validation guards for external boundaries.
 *
 * SAFE-03: Runtime input validation at all external boundaries.
 */

import type { AudioContentType } from "@voice-gateway/shared-types";
import { UserError, ErrorCodes } from "@voice-gateway/shared-types";

/** Valid audio MIME types accepted by the gateway. */
const VALID_AUDIO_TYPES = new Set<string>([
  "audio/wav",
  "audio/x-wav",
  "audio/pcm",
  "audio/ogg",
  "audio/mpeg",
  "audio/webm",
]);

/** Default max audio payload size: 25 MB. */
export const DEFAULT_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Validate that a content type is a supported audio type. */
export function validateAudioContentType(
  contentType: string | undefined,
): AudioContentType {
  if (contentType == null || contentType.length === 0) {
    throw new UserError(
      ErrorCodes.INVALID_CONTENT_TYPE,
      "Missing Content-Type header. Expected audio/wav, audio/ogg, or similar.",
    );
  }

  // Strip parameters (e.g., "audio/ogg; codecs=opus" → "audio/ogg")
  const baseType = contentType.split(";")[0]?.trim().toLowerCase();

  if (baseType == null || !VALID_AUDIO_TYPES.has(baseType)) {
    throw new UserError(
      ErrorCodes.INVALID_CONTENT_TYPE,
      `Unsupported audio type: "${contentType}". Accepted: ${[...VALID_AUDIO_TYPES].join(", ")}`,
    );
  }

  return baseType as AudioContentType;
}

/** Validate audio payload size. */
export function validateAudioSize(
  sizeBytes: number,
  maxBytes: number = DEFAULT_MAX_AUDIO_BYTES,
): void {
  if (sizeBytes <= 0) {
    throw new UserError(ErrorCodes.INVALID_AUDIO, "Audio payload is empty.");
  }
  if (sizeBytes > maxBytes) {
    throw new UserError(
      ErrorCodes.AUDIO_TOO_LARGE,
      `Audio payload too large: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB. Max: ${(maxBytes / 1024 / 1024).toFixed(1)}MB.`,
    );
  }
}

/** Validate that a string is non-empty. */
export function requireNonEmpty(
  value: string | undefined | null,
  fieldName: string,
): string {
  if (value == null || value.trim().length === 0) {
    throw new UserError(
      ErrorCodes.INVALID_CONFIG,
      `${fieldName} is required and cannot be empty.`,
    );
  }
  return value.trim();
}

/** Validate a URL string. */
export function validateUrl(value: string, fieldName: string): string {
  const trimmed = requireNonEmpty(value, fieldName);
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    throw new UserError(
      ErrorCodes.INVALID_CONFIG,
      `${fieldName} is not a valid URL: "${trimmed}"`,
    );
  }
}

/** Validate a positive integer. */
export function validatePositiveInt(
  value: unknown,
  fieldName: string,
): number {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new UserError(
      ErrorCodes.INVALID_CONFIG,
      `${fieldName} must be a positive integer, got: ${String(value)}`,
    );
  }
  return num;
}
