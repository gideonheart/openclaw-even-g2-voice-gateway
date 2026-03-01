/**
 * End-to-end integration test: Text -> OpenClaw -> GatewayReply
 *
 * Uses mock OpenClaw gateway server (with proper protocol:
 * connect.challenge -> connect -> hello-ok -> chat.send -> chat event)
 * to verify the text turn pipeline without external dependencies.
 *
 * Text turns skip STT entirely and send user text directly to OpenClaw.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { WebSocketServer } from "ws";
import { createGatewayServer } from "../../services/gateway-api/src/server.js";
import { ConfigStore } from "../../services/gateway-api/src/config-store.js";
import { OpenClawClient } from "@voice-gateway/openclaw-client";
import { Logger } from "@voice-gateway/logging";
import {
  createSessionKey,
  createProviderId,
  ProviderIds,
} from "@voice-gateway/shared-types";
import type { SttProvider } from "@voice-gateway/stt-contract";
import type { GatewayConfig, GatewayReply } from "@voice-gateway/shared-types";

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    openclawGatewayUrl: "ws://127.0.0.1:0",
    openclawGatewayToken: "test-token",
    openclawSessionKey: createSessionKey("test-session"),
    sttProvider: createProviderId("whisperx"),
    whisperx: { baseUrl: "", model: "medium", language: "en", pollIntervalMs: 100, timeoutMs: 5000 },
    openai: { apiKey: "", model: "whisper-1", language: "en" },
    customHttp: { url: "", authHeader: "", requestMapping: {}, responseMapping: { textField: "text", languageField: "language", confidenceField: "confidence" } },
    server: { port: 0, host: "127.0.0.1", corsOrigins: [], allowNullOrigin: false, maxAudioBytes: 1024 * 1024, rateLimitPerMinute: 60 },
    ...overrides,
  };
}

/**
 * Attach OpenClaw gateway protocol to a WebSocket server.
 * Implements: connect.challenge -> connect handshake -> chat.send -> chat events.
 */
function attachOpenClawProtocol(
  wsServer: WebSocketServer,
  responseBuilder: (message: string) => string = (msg) => `AI response to: ${msg}`,
): void {
  wsServer.on("connection", (ws) => {
    let authenticated = false;

    ws.send(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "text-turn-test-nonce" },
    }));

    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as {
        type: string;
        id: string;
        method: string;
        params?: Record<string, unknown>;
      };

      if (frame.type !== "req" || !frame.id || !frame.method) {
        ws.close(1008, "invalid request frame");
        return;
      }

      if (!authenticated) {
        if (frame.method !== "connect") {
          ws.close(1008, "invalid handshake");
          return;
        }

        authenticated = true;
        ws.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            type: "hello-ok",
            protocol: 3,
            server: { version: "test", connId: "text-turn-conn-1" },
            features: { methods: ["chat.send"], events: ["chat"] },
            snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
            policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 30000 },
          },
        }));
        return;
      }

      if (frame.method === "chat.send") {
        const params = frame.params as {
          sessionKey: string;
          message: string;
          idempotencyKey: string;
        };

        ws.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { runId: params.idempotencyKey, status: "started" },
        }));

        const responseText = responseBuilder(params.message);
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: "event",
            event: "chat",
            payload: {
              runId: params.idempotencyKey,
              sessionKey: params.sessionKey,
              seq: 0,
              state: "final",
              message: {
                role: "assistant",
                content: [{ type: "text", text: responseText }],
                timestamp: Date.now(),
              },
            },
          }));
        }, 10);
      }
    });
  });
}

describe("Text Turn Integration", () => {
  let wsServer: WebSocketServer;
  let wsPort: number;
  let httpServer: http.Server;
  let httpPort: number;
  const logger = new Logger();

  beforeEach(async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    wsServer = new WebSocketServer({ port: 0 });
    const wsAddr = wsServer.address();
    wsPort = typeof wsAddr === "object" && wsAddr !== null ? wsAddr.port : 0;
  });

  afterEach(() => {
    wsServer.close();
    if (httpServer) httpServer.close();
    vi.restoreAllMocks();
  });

  it("complete text turn: text -> OpenClaw -> shaped response (no STT)", async () => {
    attachOpenClawProtocol(wsServer, (msg) => `AI says: ${msg}`);

    const openclawClient = new OpenClawClient(
      {
        gatewayUrl: `ws://127.0.0.1:${wsPort}`,
        authToken: "test-token",
        connectTimeoutMs: 5000,
        responseTimeoutMs: 5000,
        retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      },
      logger,
    );

    const config = makeConfig({
      openclawGatewayUrl: `ws://127.0.0.1:${wsPort}`,
    });

    httpServer = createGatewayServer({
      configStore: new ConfigStore(config),
      sttProviders: new Map(),
      openclawClient,
      logger,
      ready: true,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort = typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    const response = await fetch(
      `http://127.0.0.1:${httpPort}/api/text/turn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello from typed chat" }),
      },
    );

    expect(response.status).toBe(200);

    const reply = (await response.json()) as GatewayReply;

    // Verify response structure
    expect(reply.turnId).toBeDefined();
    expect(reply.sessionKey).toBe("test-session");
    expect(reply.assistant.fullText).toBe("AI says: Hello from typed chat");
    expect(reply.assistant.segments.length).toBeGreaterThan(0);
    expect(reply.assistant.segments[0]?.text).toBe("AI says: Hello from typed chat");

    // STT was not used -- sttMs must be 0
    expect(reply.timing.sttMs).toBe(0);
    expect(reply.timing.agentMs).toBeGreaterThanOrEqual(0);
    expect(reply.timing.totalMs).toBeGreaterThanOrEqual(0);

    // Provider should be "text" for text turns
    expect(reply.meta.provider).toBe("text");
    expect(reply.meta.model).toBeNull();

    openclawClient.disconnect();
  });

  it("rejects non-JSON content type", async () => {
    const config = makeConfig();
    httpServer = createGatewayServer({
      configStore: new ConfigStore(config),
      sttProviders: new Map(),
      openclawClient: new OpenClawClient({}, logger),
      logger,
      ready: true,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort = typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    const response = await fetch(
      `http://127.0.0.1:${httpPort}/api/text/turn`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json",
      },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.code).toBe("INVALID_CONTENT_TYPE");
    expect(body.error).toContain("application/json");
  });

  it("rejects empty text", async () => {
    const config = makeConfig();
    httpServer = createGatewayServer({
      configStore: new ConfigStore(config),
      sttProviders: new Map(),
      openclawClient: new OpenClawClient({}, logger),
      logger,
      ready: true,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort = typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    const response = await fetch(
      `http://127.0.0.1:${httpPort}/api/text/turn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.error).toContain("empty");
  });

  it("rejects missing text field", async () => {
    const config = makeConfig();
    httpServer = createGatewayServer({
      configStore: new ConfigStore(config),
      sttProviders: new Map(),
      openclawClient: new OpenClawClient({}, logger),
      logger,
      ready: true,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort = typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    const response = await fetch(
      `http://127.0.0.1:${httpPort}/api/text/turn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "wrong field name" }),
      },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; error: string };
    expect(body.error).toContain("text");
  });

  it("rejects invalid JSON body", async () => {
    const config = makeConfig();
    httpServer = createGatewayServer({
      configStore: new ConfigStore(config),
      sttProviders: new Map(),
      openclawClient: new OpenClawClient({}, logger),
      logger,
      ready: true,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort = typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    const response = await fetch(
      `http://127.0.0.1:${httpPort}/api/text/turn`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {{{",
      },
    );

    expect(response.status).toBe(400);
  });

  it("rate-limits text turn endpoint", async () => {
    const config = makeConfig({
      server: {
        ...makeConfig().server,
        rateLimitPerMinute: 2,
      },
    });

    httpServer = createGatewayServer({
      configStore: new ConfigStore(config),
      sttProviders: new Map(),
      openclawClient: new OpenClawClient({}, logger),
      logger,
      ready: true,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort = typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    // Use requests that fail fast at validation (missing text field)
    // so they don't hang waiting for OpenClaw.
    // Rate limiter still counts them since it runs before the handler.
    const sendRequest = (): Promise<Response> =>
      fetch(`http://127.0.0.1:${httpPort}/api/text/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noTextField: true }),
      });

    // First 2 go through rate limiter (fail at validation with 400, not 429)
    const r1 = await sendRequest();
    const r2 = await sendRequest();
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);

    // Third should be rate limited
    const r3 = await sendRequest();
    expect(r3.status).toBe(429);
    const body = (await r3.json()) as { code: string };
    expect(body.code).toBe("RATE_LIMITED");
  });
});
