import { describe, it, expect } from "vitest";
import {
  createTurnId,
  createSessionKey,
  createProviderId,
  ProviderIds,
} from "./branded.js";

describe("branded types", () => {
  describe("createTurnId", () => {
    it("generates a turn ID with prefix when no input given", () => {
      const id = createTurnId();
      expect(id).toMatch(/^turn_/);
    });

    it("accepts a custom ID string", () => {
      const id = createTurnId("turn_custom_123");
      expect(id).toBe("turn_custom_123");
    });

    it("generates unique IDs", () => {
      const id1 = createTurnId();
      const id2 = createTurnId();
      expect(id1).not.toBe(id2);
    });
  });

  describe("createSessionKey", () => {
    it("brands a valid session key", () => {
      const key = createSessionKey("my-session");
      expect(key).toBe("my-session");
    });

    it("throws on empty string", () => {
      expect(() => createSessionKey("")).toThrow("SessionKey cannot be empty");
    });
  });

  describe("createProviderId", () => {
    it("accepts 'whisperx'", () => {
      expect(createProviderId("whisperx")).toBe("whisperx");
    });

    it("accepts 'openai'", () => {
      expect(createProviderId("openai")).toBe("openai");
    });

    it("accepts 'custom'", () => {
      expect(createProviderId("custom")).toBe("custom");
    });

    it("rejects invalid provider", () => {
      expect(() => createProviderId("invalid")).toThrow(
        'Invalid ProviderId: "invalid"',
      );
    });
  });

  describe("ProviderIds constants", () => {
    it("has WhisperX", () => {
      expect(ProviderIds.WhisperX).toBe("whisperx");
    });

    it("has OpenAI", () => {
      expect(ProviderIds.OpenAI).toBe("openai");
    });

    it("has Custom", () => {
      expect(ProviderIds.Custom).toBe("custom");
    });
  });
});
