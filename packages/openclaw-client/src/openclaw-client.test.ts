import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { OpenClawClient } from "./openclaw-client.js";
import { Logger } from "@voice-gateway/logging";
import {
  createTurnId,
  createSessionKey,
  UserError,
  OperatorError,
} from "@voice-gateway/shared-types";
import type { OpenClawOutbound } from "@voice-gateway/shared-types";

describe("OpenClawClient", () => {
  const logger = new Logger();
  let server: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    // Start a mock WebSocket server
    server = new WebSocketServer({ port: 0 });
    const address = server.address();
    port = typeof address === "object" && address !== null ? address.port : 0;
  });

  afterEach(() => {
    server.close();
    vi.restoreAllMocks();
  });

  it("connects to WebSocket server", async () => {
    const client = new OpenClawClient(
      {
        gatewayUrl: `ws://127.0.0.1:${port}`,
        authToken: "test-token",
        connectTimeoutMs: 5000,
        retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      },
      logger,
    );

    await client.connect();
    expect(client.isConnected()).toBe(true);
    client.disconnect();
  });

  it("sends transcript and receives response", async () => {
    // Set up echo server
    server.on("connection", (ws) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as OpenClawOutbound;
        // Echo back as assistant response
        ws.send(
          JSON.stringify({
            turnId: msg.turnId,
            sessionKey: msg.sessionKey,
            text: `Response to: ${msg.text}`,
            timestamp: new Date().toISOString(),
          }),
        );
      });
    });

    const client = new OpenClawClient(
      {
        gatewayUrl: `ws://127.0.0.1:${port}`,
        authToken: "test-token",
        connectTimeoutMs: 5000,
        responseTimeoutMs: 5000,
        retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      },
      logger,
    );

    await client.connect();

    const sessionKey = createSessionKey("test-session");
    const turnId = createTurnId("turn_test_echo");

    const response = await client.sendTranscript(
      sessionKey,
      turnId,
      "Hello OpenClaw",
    );

    expect(response.text).toBe("Response to: Hello OpenClaw");
    expect(response.turnId).toBe(turnId);
    expect(response.sessionKey).toBe(sessionKey);

    client.disconnect();
  });

  it("times out when no response received", async () => {
    // Server accepts but never responds
    server.on("connection", () => {
      // silence
    });

    const client = new OpenClawClient(
      {
        gatewayUrl: `ws://127.0.0.1:${port}`,
        authToken: "test-token",
        connectTimeoutMs: 5000,
        responseTimeoutMs: 100, // Very short timeout
        retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      },
      logger,
    );

    await client.connect();

    await expect(
      client.sendTranscript(
        createSessionKey("test-session"),
        createTurnId("turn_timeout"),
        "Hello",
      ),
    ).rejects.toThrow(UserError);

    client.disconnect();
  });

  it("handles error response from OpenClaw", async () => {
    server.on("connection", (ws) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as OpenClawOutbound;
        ws.send(
          JSON.stringify({
            turnId: msg.turnId,
            error: "Session not found",
          }),
        );
      });
    });

    const client = new OpenClawClient(
      {
        gatewayUrl: `ws://127.0.0.1:${port}`,
        authToken: "test-token",
        connectTimeoutMs: 5000,
        responseTimeoutMs: 5000,
        retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      },
      logger,
    );

    await client.connect();

    await expect(
      client.sendTranscript(
        createSessionKey("bad-session"),
        createTurnId("turn_error"),
        "Hello",
      ),
    ).rejects.toThrow(UserError);

    client.disconnect();
  });

  it("rejects pending turns on disconnect", async () => {
    // Server accepts but never responds
    server.on("connection", () => {
      // silence
    });

    const client = new OpenClawClient(
      {
        gatewayUrl: `ws://127.0.0.1:${port}`,
        authToken: "test-token",
        connectTimeoutMs: 5000,
        responseTimeoutMs: 30_000,
        retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      },
      logger,
    );

    await client.connect();

    const promise = client.sendTranscript(
      createSessionKey("test-session"),
      createTurnId("turn_disconnect"),
      "Hello",
    );

    // Disconnect while waiting
    client.disconnect();

    await expect(promise).rejects.toThrow(UserError);
  });

  it("healthCheck returns healthy when connected", async () => {
    const client = new OpenClawClient(
      {
        gatewayUrl: `ws://127.0.0.1:${port}`,
        authToken: "test-token",
        connectTimeoutMs: 5000,
        retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      },
      logger,
    );

    const health = await client.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);

    client.disconnect();
  });

  it("healthCheck returns unhealthy when server is down", async () => {
    server.close();

    const client = new OpenClawClient(
      {
        gatewayUrl: `ws://127.0.0.1:${port + 1}`,
        authToken: "test-token",
        connectTimeoutMs: 1000,
        retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      },
      logger,
    );

    const health = await client.healthCheck();
    expect(health.healthy).toBe(false);
  });
});
