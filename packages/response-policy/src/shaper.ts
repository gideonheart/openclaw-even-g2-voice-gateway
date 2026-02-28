/**
 * Response shaping for glasses viewport — RESP-01, RESP-02, RESP-03.
 *
 * Segments assistant text for the Even G2 display constraints.
 * Client-agnostic: no viewport/bubble/scroll assumptions (RESP-04).
 */

import type { ResponseSegment } from "@voice-gateway/shared-types";

export interface ShapingOptions {
  /** Max characters per segment. Default: 500. */
  readonly maxSegmentChars: number;
  /** Max total segments. Default: 20. */
  readonly maxSegments: number;
  /** Max total response characters before truncation. Default: 5000. */
  readonly maxTotalChars: number;
}

const DEFAULTS: ShapingOptions = {
  maxSegmentChars: 500,
  maxSegments: 20,
  maxTotalChars: 5000,
};

/**
 * Normalize text: strip control characters, unify line endings,
 * preserve semantic blocks (paragraphs).
 *
 * RESP-02: Response text normalization.
 */
export function normalizeText(raw: string): string {
  return (
    raw
      // Strip control chars except \n \r \t
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
      // Unify line endings to \n
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Collapse 3+ newlines to 2 (preserve paragraph breaks)
      .replace(/\n{3,}/g, "\n\n")
      // Trim leading/trailing whitespace
      .trim()
  );
}

/**
 * Shape an assistant response into segments for the glasses viewport.
 *
 * Strategy: split on paragraph boundaries first, then sentence boundaries,
 * then hard character limit. Respects max segment count and total char limit.
 */
export function shapeResponse(
  text: string,
  opts?: Partial<ShapingOptions>,
): { segments: ResponseSegment[]; truncated: boolean } {
  const options = { ...DEFAULTS, ...opts };

  // Normalize first
  const normalized = normalizeText(text);

  // Enforce max total chars — RESP-03
  const truncated = normalized.length > options.maxTotalChars;
  const effective = truncated
    ? normalized.slice(0, options.maxTotalChars)
    : normalized;

  if (effective.length === 0) {
    return { segments: [], truncated: false };
  }

  // Split into paragraphs first
  const paragraphs = effective.split(/\n\n+/);
  const segments: ResponseSegment[] = [];
  let segmentIndex = 0;

  for (const paragraph of paragraphs) {
    if (segments.length >= options.maxSegments) break;

    const trimmed = paragraph.trim();
    if (trimmed.length === 0) continue;

    if (trimmed.length <= options.maxSegmentChars) {
      // Paragraph fits in one segment
      segments.push({
        index: segmentIndex++,
        text: trimmed,
        continuation: false,
      });
    } else {
      // Need to split paragraph into multiple segments
      const chunks = splitIntoChunks(trimmed, options.maxSegmentChars);
      for (let i = 0; i < chunks.length; i++) {
        if (segments.length >= options.maxSegments) break;
        const chunk = chunks[i];
        if (chunk == null) continue;
        segments.push({
          index: segmentIndex++,
          text: chunk,
          continuation: i > 0,
        });
      }
    }
  }

  return { segments, truncated };
}

/**
 * Split text into chunks, preferring sentence boundaries.
 */
function splitIntoChunks(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Try to find a sentence boundary within the limit
    const candidate = remaining.slice(0, maxChars);
    let splitAt = -1;

    // Look for sentence-ending punctuation followed by space
    for (let i = candidate.length - 1; i >= Math.floor(maxChars * 0.5); i--) {
      const char = candidate[i];
      if (
        (char === "." || char === "!" || char === "?") &&
        (candidate[i + 1] === " " || i + 1 >= candidate.length)
      ) {
        splitAt = i + 1;
        break;
      }
    }

    // Fallback: split at last space
    if (splitAt === -1) {
      const lastSpace = candidate.lastIndexOf(" ");
      if (lastSpace > Math.floor(maxChars * 0.3)) {
        splitAt = lastSpace;
      }
    }

    // Hard fallback: split at maxChars
    if (splitAt === -1) {
      splitAt = maxChars;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks;
}
