import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry } from "./retry.js";
import { OperatorError, ErrorCodes } from "@voice-gateway/shared-types";

describe("withRetry", () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  it("returns result on first attempt success", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on transient error and succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue("recovered");

    const result = await withRetry(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
    });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 }),
    ).rejects.toThrow("ECONNREFUSED");

    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry non-transient errors", async () => {
    const fn = vi.fn().mockRejectedValue(
      new OperatorError(
        ErrorCodes.MISSING_CONFIG,
        "Config missing",
        "No API key",
      ),
    );

    await expect(
      withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 }),
    ).rejects.toThrow(OperatorError);

    expect(fn).toHaveBeenCalledOnce(); // no retry
  });

  it("respects abort signal", async () => {
    const controller = new AbortController();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue("never");

    // Abort immediately
    controller.abort();

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        baseDelayMs: 10,
        maxDelayMs: 50,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});
