/**
 * End-to-end integration test: Audio → STT → OpenClaw → GatewayReply
 *
 * Uses mocked STT provider and mock WebSocket server to verify
 * the complete pipeline without external dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { WebSocketServer } from "ws";
import { createGatewayServer } from "../../services/gateway-api/src/server.js";
import { OpenClawClient } from "@voice-gateway/openclaw-client";
import { Logger } from "@voice-gateway/logging";
import {
  createSessionKey,
  createProviderId,
  ProviderIds,
} from "@voice-gateway/shared-types";
import type { SttProvider } from "@voice-gateway/stt-contract";
import type { GatewayConfig, GatewayReply, OpenClawOutbound } from "@voice-gateway/shared-types";

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    openclawGatewayUrl: "ws://127.0.0.1:0",
    openclawGatewayToken: "test-token",
    openclawSessionKey: createSessionKey("test-session"),
    sttProvider: createProviderId("whisperx"),
    whisperx: { baseUrl: "", model: "medium", language: "en", pollIntervalMs: 100, timeoutMs: 5000 },
    openai: { apiKey: "", model: "whisper-1", language: "en" },
    customHttp: { url: "", authHeader: "", requestMapping: {}, responseMapping: { textField: "text", languageField: "language", confidenceField: "confidence" } },
    server: { port: 0, host: "127.0.0.1", corsOrigins: ["http://localhost:3001"], maxAudioBytes: 1024 * 1024, rateLimitPerMinute: 60 },
    ...overrides,
  };
}

describe("Voice Turn Integration", () => {
  let wsServer: WebSocketServer;
  let wsPort: number;
  let httpServer: http.Server;
  let httpPort: number;
  const logger = new Logger();

  beforeEach(async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    // Start mock OpenClaw WebSocket server
    wsServer = new WebSocketServer({ port: 0 });
    const wsAddr = wsServer.address();
    wsPort = typeof wsAddr === "object" && wsAddr !== null ? wsAddr.port : 0;

    // Echo bot: returns a response for every transcript
    wsServer.on("connection", (ws) => {
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as OpenClawOutbound;
        ws.send(
          JSON.stringify({
            turnId: msg.turnId,
            sessionKey: msg.sessionKey,
            text: `AI response to: ${msg.text}`,
            timestamp: new Date().toISOString(),
          }),
        );
      });
    });
  });

  afterEach(() => {
    wsServer.close();
    if (httpServer) httpServer.close();
    vi.restoreAllMocks();
  });

  it("complete voice turn: audio → STT → OpenClaw → shaped response", async () => {
    // Mock STT provider
    const mockProvider: SttProvider = {
      providerId: ProviderIds.WhisperX,
      name: "Mock WhisperX",
      transcribe: vi.fn().mockResolvedValue({
        text: "What is the weather today",
        language: "en",
        confidence: null,
        providerId: ProviderIds.WhisperX,
        durationMs: 200,
      }),
      healthCheck: vi.fn().mockResolvedValue({
        healthy: true,
        message: "ok",
        latencyMs: 5,
      }),
    };

    const providers = new Map<string, SttProvider>();
    providers.set(ProviderIds.WhisperX, mockProvider);

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
      config,
      sttProviders: providers,
      openclawClient,
      logger,
    });

    // Start HTTP server
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort =
      typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    // Send voice turn request
    const response = await fetch(
      `http://127.0.0.1:${httpPort}/api/voice/turn`,
      {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: Buffer.from("fake-wav-audio-data"),
      },
    );

    expect(response.status).toBe(200);

    const reply = (await response.json()) as GatewayReply;

    // Verify response structure
    expect(reply.turnId).toBeDefined();
    expect(reply.sessionKey).toBe("test-session");
    expect(reply.assistant.fullText).toBe(
      "AI response to: What is the weather today",
    );
    expect(reply.assistant.segments.length).toBeGreaterThan(0);
    expect(reply.assistant.segments[0]?.text).toBe(
      "AI response to: What is the weather today",
    );
    expect(reply.timing.sttMs).toBeGreaterThanOrEqual(0);
    expect(reply.timing.agentMs).toBeGreaterThanOrEqual(0);
    expect(reply.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(reply.meta.provider).toBe("whisperx");

    // Verify STT was called with audio
    expect(mockProvider.transcribe).toHaveBeenCalledOnce();

    openclawClient.disconnect();
  });

  it("healthz returns 200", async () => {
    const config = makeConfig();
    httpServer = createGatewayServer({
      config,
      sttProviders: new Map(),
      openclawClient: new OpenClawClient({}, logger),
      logger,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort =
      typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    const response = await fetch(`http://127.0.0.1:${httpPort}/healthz`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("rejects unsupported content type", async () => {
    const config = makeConfig();
    httpServer = createGatewayServer({
      config,
      sttProviders: new Map(),
      openclawClient: new OpenClawClient({}, logger),
      logger,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort =
      typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    const response = await fetch(
      `http://127.0.0.1:${httpPort}/api/voice/turn`,
      {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not audio",
      },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("INVALID_CONTENT_TYPE");
  });

  it("returns 404 for unknown routes", async () => {
    const config = makeConfig();
    httpServer = createGatewayServer({
      config,
      sttProviders: new Map(),
      openclawClient: new OpenClawClient({}, logger),
      logger,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort =
      typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    const response = await fetch(`http://127.0.0.1:${httpPort}/nope`);
    expect(response.status).toBe(404);
  });

  it("returns 429 when rate limit exceeded", async () => {
    const config = makeConfig({
      server: {
        ...makeConfig().server,
        rateLimitPerMinute: 2,
      },
    });

    httpServer = createGatewayServer({
      config,
      sttProviders: new Map(),
      openclawClient: new OpenClawClient({}, logger),
      logger,
    });

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const httpAddr = httpServer.address();
    httpPort =
      typeof httpAddr === "object" && httpAddr !== null ? httpAddr.port : 0;

    const sendRequest = (): Promise<Response> =>
      fetch(`http://127.0.0.1:${httpPort}/api/voice/turn`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: Buffer.from("fake-audio"),
      });

    // First 2 requests go through (they will fail with provider error, but not 429)
    const response1 = await sendRequest();
    const response2 = await sendRequest();
    expect(response1.status).not.toBe(429);
    expect(response2.status).not.toBe(429);

    // Third request should be rate limited
    const response3 = await sendRequest();
    expect(response3.status).toBe(429);
    const body = (await response3.json()) as { error: string; code: string };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.error).toBe("Too many requests. Please wait.");
  });
});
