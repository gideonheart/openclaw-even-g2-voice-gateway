import { describe, it, expect, vi, beforeEach } from "vitest";
import { Logger } from "./logger.js";
import type { TurnId } from "@voice-gateway/shared-types";

describe("Logger", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  it("logs info to stdout as JSON", () => {
    const logger = new Logger();
    logger.info("test message");

    expect(stdoutSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(
      (stdoutSpy.mock.calls[0]?.[0] as string).trim(),
    );
    expect(output).toMatchObject({
      level: "info",
      message: "test message",
    });
    expect(output.timestamp).toBeDefined();
  });

  it("logs error to stderr", () => {
    const logger = new Logger();
    logger.error("boom");

    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(
      (stderrSpy.mock.calls[0]?.[0] as string).trim(),
    );
    expect(output.level).toBe("error");
  });

  it("includes context in all log entries", () => {
    const logger = new Logger({ service: "test-svc" });
    logger.info("hello");

    const output = JSON.parse(
      (stdoutSpy.mock.calls[0]?.[0] as string).trim(),
    );
    expect(output.service).toBe("test-svc");
  });

  it("child logger inherits and extends context", () => {
    const parent = new Logger({ service: "gateway" });
    const child = parent.child({ turnId: "turn_abc" as TurnId });
    child.info("processing");

    const output = JSON.parse(
      (stdoutSpy.mock.calls[0]?.[0] as string).trim(),
    );
    expect(output.service).toBe("gateway");
    expect(output.turnId).toBe("turn_abc");
  });

  it("masks secret fields", () => {
    const logger = new Logger();
    logger.info("config loaded", {
      apiKey: "sk-secret-123",
      token: "bearer-xyz",
      url: "https://example.com",
    });

    const output = JSON.parse(
      (stdoutSpy.mock.calls[0]?.[0] as string).trim(),
    );
    expect(output.apiKey).toBe("********");
    expect(output.token).toBe("********");
    expect(output.url).toBe("https://example.com");
  });

  it("masks nested secret fields", () => {
    const logger = new Logger();
    logger.info("nested", {
      provider: {
        apiKey: "secret",
        name: "openai",
      },
    });

    const output = JSON.parse(
      (stdoutSpy.mock.calls[0]?.[0] as string).trim(),
    );
    expect(output.provider.apiKey).toBe("********");
    expect(output.provider.name).toBe("openai");
  });
});
