import { describe, it, expect } from "vitest";
import { UserError, OperatorError, ErrorCodes } from "./errors.js";

describe("error taxonomy", () => {
  describe("UserError", () => {
    it("has kind=user", () => {
      const err = new UserError(ErrorCodes.INVALID_AUDIO, "Bad audio");
      expect(err.kind).toBe("user");
    });

    it("stores code and message", () => {
      const err = new UserError(ErrorCodes.STT_TIMEOUT, "Transcription timed out");
      expect(err.code).toBe("STT_TIMEOUT");
      expect(err.message).toBe("Transcription timed out");
    });

    it("serializes to JSON", () => {
      const err = new UserError(ErrorCodes.RATE_LIMITED, "Too fast");
      const json = err.toJSON();
      expect(json).toMatchObject({
        name: "UserError",
        kind: "user",
        code: "RATE_LIMITED",
        message: "Too fast",
      });
      expect(json["timestamp"]).toBeDefined();
    });

    it("includes cause when present", () => {
      const cause = new Error("root cause");
      const err = new UserError(ErrorCodes.STT_UNAVAILABLE, "STT down", {
        cause,
      });
      const json = err.toJSON();
      expect(json["cause"]).toContain("root cause");
    });
  });

  describe("OperatorError", () => {
    it("has kind=operator", () => {
      const err = new OperatorError(
        ErrorCodes.INTERNAL_ERROR,
        "Internal failure",
        "Connection reset by peer at 10.0.0.1:5432",
      );
      expect(err.kind).toBe("operator");
    });

    it("includes detail in JSON", () => {
      const err = new OperatorError(
        ErrorCodes.OPENCLAW_UNAVAILABLE,
        "OpenClaw unreachable",
        "ECONNREFUSED ws://localhost:3000",
      );
      const json = err.toJSON();
      expect(json).toMatchObject({
        name: "OperatorError",
        kind: "operator",
        code: "OPENCLAW_UNAVAILABLE",
        detail: "ECONNREFUSED ws://localhost:3000",
      });
    });
  });

  describe("ErrorCodes", () => {
    it("has all expected codes", () => {
      expect(ErrorCodes.INVALID_AUDIO).toBe("INVALID_AUDIO");
      expect(ErrorCodes.STT_UNAVAILABLE).toBe("STT_UNAVAILABLE");
      expect(ErrorCodes.OPENCLAW_UNAVAILABLE).toBe("OPENCLAW_UNAVAILABLE");
      expect(ErrorCodes.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
    });
  });
});
