import { describe, it, expect } from "vitest";
import {
  validateAudioContentType,
  validateAudioSize,
  requireNonEmpty,
  validateUrl,
  validatePositiveInt,
} from "./guards.js";

describe("validation guards", () => {
  describe("validateAudioContentType", () => {
    it("accepts audio/wav", () => {
      expect(validateAudioContentType("audio/wav")).toBe("audio/wav");
    });

    it("accepts audio/ogg with codecs parameter", () => {
      expect(validateAudioContentType("audio/ogg; codecs=opus")).toBe(
        "audio/ogg",
      );
    });

    it("accepts audio/webm", () => {
      expect(validateAudioContentType("audio/webm")).toBe("audio/webm");
    });

    it("rejects missing content type", () => {
      expect(() => validateAudioContentType(undefined)).toThrow(
        "Missing Content-Type",
      );
    });

    it("rejects unsupported type", () => {
      expect(() => validateAudioContentType("text/plain")).toThrow(
        "Unsupported audio type",
      );
    });

    it("is case insensitive", () => {
      expect(validateAudioContentType("Audio/WAV")).toBe("audio/wav");
    });
  });

  describe("validateAudioSize", () => {
    it("accepts valid size", () => {
      expect(() => validateAudioSize(1024)).not.toThrow();
    });

    it("rejects zero bytes", () => {
      expect(() => validateAudioSize(0)).toThrow("empty");
    });

    it("rejects oversized payload", () => {
      expect(() => validateAudioSize(100_000_000, 25_000_000)).toThrow(
        "too large",
      );
    });
  });

  describe("requireNonEmpty", () => {
    it("returns trimmed value", () => {
      expect(requireNonEmpty("  hello  ", "field")).toBe("hello");
    });

    it("rejects null", () => {
      expect(() => requireNonEmpty(null, "name")).toThrow("required");
    });

    it("rejects empty string", () => {
      expect(() => requireNonEmpty("", "name")).toThrow("required");
    });

    it("rejects whitespace-only string", () => {
      expect(() => requireNonEmpty("   ", "name")).toThrow("required");
    });
  });

  describe("validateUrl", () => {
    it("accepts valid URL", () => {
      expect(validateUrl("https://example.com", "url")).toBe(
        "https://example.com",
      );
    });

    it("accepts ws:// URL", () => {
      expect(validateUrl("ws://localhost:3000", "url")).toBe(
        "ws://localhost:3000",
      );
    });

    it("rejects invalid URL", () => {
      expect(() => validateUrl("not-a-url", "url")).toThrow("not a valid URL");
    });
  });

  describe("validatePositiveInt", () => {
    it("accepts positive integer", () => {
      expect(validatePositiveInt(42, "count")).toBe(42);
    });

    it("rejects zero", () => {
      expect(() => validatePositiveInt(0, "count")).toThrow("positive integer");
    });

    it("rejects negative", () => {
      expect(() => validatePositiveInt(-1, "count")).toThrow("positive integer");
    });

    it("rejects float", () => {
      expect(() => validatePositiveInt(1.5, "count")).toThrow(
        "positive integer",
      );
    });

    it("accepts string number", () => {
      expect(validatePositiveInt("10", "count")).toBe(10);
    });
  });
});
