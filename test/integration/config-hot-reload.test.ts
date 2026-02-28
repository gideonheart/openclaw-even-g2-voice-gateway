/**
 * Integration tests for runtime config hot-reload paths.
 *
 * Verifies that POST /api/settings triggers provider/client re-initialization
 * and config changes are observable in subsequent requests/state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { WebSocketServer } from "ws";
import { createGatewayServer } from "../../services/gateway-api/src/server.js";
import { ConfigStore } from "../../services/gateway-api/src/config-store.js";
import { registerProviderRebuilder } from "../../services/gateway-api/src/provider-rebuilder.js";
import { registerOpenClawRebuilder } from "../../services/gateway-api/src/openclaw-rebuilder.js";
import { OpenClawClient } from "@voice-gateway/openclaw-client";
import { Logger } from "@voice-gateway/logging";
import {
  createSessionKey,
  createProviderId,
  ProviderIds,
} from "@voice-gateway/shared-types";
import type { SttProvider } from "@voice-gateway/stt-contract";
import type {
  GatewayConfig,
  GatewayReply,
  SafeGatewayConfig,
} from "@voice-gateway/shared-types";

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    openclawGatewayUrl: "ws://127.0.0.1:0",
    openclawGatewayToken: "test-token",
    openclawSessionKey: createSessionKey("test-session"),
    sttProvider: createProviderId("whisperx"),
    whisperx: { baseUrl: "", model: "medium", language: "en", pollIntervalMs: 100, timeoutMs: 5000 },
    openai: { apiKey: "", model: "whisper-1", language: "en" },
    customHttp: { url: "", authHeader: "", requestMapping: {}, responseMapping: { textField: "text", languageField: "language", confidenceField: "confidence" } },
    server: { port: 0, host: "127.0.0.1", corsOrigins: [], maxAudioBytes: 1024 * 1024, rateLimitPerMinute: 60 },
    ...overrides,
  };
}

function makeMockProvider(model: string = "medium"): SttProvider {
  return {
    providerId: ProviderIds.WhisperX,
    name: "Mock WhisperX",
    transcribe: vi.fn().mockResolvedValue({
      text: "What is the weather today",
      language: "en",
      confidence: null,
      providerId: ProviderIds.WhisperX,
      model,
      durationMs: 200,
    }),
    healthCheck: vi.fn().mockResolvedValue({
      healthy: true,
      message: "ok",
      latencyMs: 5,
    }),
  };
}

/**
 * Attach OpenClaw gateway protocol to a WebSocket server for hot-reload tests.
 * Uses the proper connect.challenge -> connect -> hello-ok -> chat.send flow.
 */
function attachOpenClawProtocol(
  wsServer: WebSocketServer,
  responsePrefix: string,
): void {
  wsServer.on("connection", (ws) => {
    let authenticated = false;

    // Step 1: Send connect.challenge
    ws.send(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: `nonce-${responsePrefix}` },
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
            server: { version: "test", connId: `conn-${responsePrefix}` },
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

        // Send ack
        ws.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { runId: params.idempotencyKey, status: "started" },
        }));

        // Send final chat event with server-prefixed response
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
                content: [{ type: "text", text: `${responsePrefix} response: ${params.message}` }],
                timestamp: Date.now(),
              },
            },
          }));
        }, 10);
      }
    });
  });
}

describe("Config Hot-Reload Integration", () => {
  const logger = new Logger();
  let httpServer: http.Server;
  let httpPort: number;

  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    if (httpServer) httpServer.close();
    vi.restoreAllMocks();
  });

  async function startServer(server: http.Server): Promise<number> {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address();
    return typeof addr === "object" && addr !== null ? addr.port : 0;
  }

  // ── Test 1: STT provider config hot-reload ──

  it("STT provider config hot-reload: settings update changes whisperx model", async () => {
    const mockProvider = makeMockProvider("medium");
    const providers = new Map<string, SttProvider>();
    providers.set(ProviderIds.WhisperX, mockProvider);

    const configStore = new ConfigStore(makeConfig());

    // Register provider rebuilder so config changes rebuild providers
    registerProviderRebuilder(configStore, providers, logger);

    const openclawClient = new OpenClawClient({}, logger);

    httpServer = createGatewayServer({
      configStore,
      sttProviders: providers,
      openclawClient,
      logger,
      ready: true,
    });

    httpPort = await startServer(httpServer);

    // Verify initial settings show model: "medium"
    const getResp1 = await fetch(`http://127.0.0.1:${httpPort}/api/settings`);
    expect(getResp1.status).toBe(200);
    const settings1 = (await getResp1.json()) as SafeGatewayConfig;
    expect(settings1.whisperx.model).toBe("medium");

    // POST settings change to update whisperx model
    const postResp = await fetch(`http://127.0.0.1:${httpPort}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ whisperx: { model: "large-v3" } }),
    });
    expect(postResp.status).toBe(200);

    // Verify GET /api/settings reflects the new model
    const getResp2 = await fetch(`http://127.0.0.1:${httpPort}/api/settings`);
    expect(getResp2.status).toBe(200);
    const settings2 = (await getResp2.json()) as SafeGatewayConfig;
    expect(settings2.whisperx.model).toBe("large-v3");

    // Verify the provider was rebuilt (it's now a real WhisperXProvider, not our mock)
    const rebuiltProvider = providers.get(ProviderIds.WhisperX);
    expect(rebuiltProvider).toBeDefined();
    expect(rebuiltProvider!.name).toBe("WhisperX (self-hosted)");

    openclawClient.disconnect();
  });

  // ── Test 2: OpenClaw client hot-reload ──

  it("OpenClaw client hot-reload: switching URL routes to new WS server", async () => {
    // Start mock WS server A with proper OpenClaw protocol
    const wsServerA = new WebSocketServer({ port: 0 });
    const wsAddrA = wsServerA.address();
    const wsPortA = typeof wsAddrA === "object" && wsAddrA !== null ? wsAddrA.port : 0;
    attachOpenClawProtocol(wsServerA, "Server-A");

    // Start mock WS server B with proper OpenClaw protocol
    const wsServerB = new WebSocketServer({ port: 0 });
    const wsAddrB = wsServerB.address();
    const wsPortB = typeof wsAddrB === "object" && wsAddrB !== null ? wsAddrB.port : 0;
    attachOpenClawProtocol(wsServerB, "Server-B");

    const mockProvider = makeMockProvider("medium");
    const providers = new Map<string, SttProvider>();
    providers.set(ProviderIds.WhisperX, mockProvider);

    const openclawClient = new OpenClawClient(
      {
        gatewayUrl: `ws://127.0.0.1:${wsPortA}`,
        authToken: "test-token",
        connectTimeoutMs: 5000,
        responseTimeoutMs: 5000,
        retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
      },
      logger,
    );

    const config = makeConfig({
      openclawGatewayUrl: `ws://127.0.0.1:${wsPortA}`,
    });

    const configStore = new ConfigStore(config);
    const deps = {
      configStore,
      sttProviders: providers,
      openclawClient,
      logger,
      ready: true,
    };

    // Register OpenClaw rebuilder so URL changes rebuild the client
    registerOpenClawRebuilder(configStore, deps, logger);

    httpServer = createGatewayServer(deps);
    httpPort = await startServer(httpServer);

    // Send first voice turn -- should go to Server A
    const resp1 = await fetch(`http://127.0.0.1:${httpPort}/api/voice/turn`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: Buffer.from("fake-wav-audio-data"),
    });
    expect(resp1.status).toBe(200);
    const reply1 = (await resp1.json()) as GatewayReply;
    expect(reply1.assistant.fullText).toContain("Server-A response:");

    // POST settings change to switch to Server B
    const postResp = await fetch(`http://127.0.0.1:${httpPort}/api/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openclawGatewayUrl: `ws://127.0.0.1:${wsPortB}` }),
    });
    expect(postResp.status).toBe(200);

    // Send second voice turn -- should go to Server B
    const resp2 = await fetch(`http://127.0.0.1:${httpPort}/api/voice/turn`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: Buffer.from("fake-wav-audio-data"),
    });
    expect(resp2.status).toBe(200);
    const reply2 = (await resp2.json()) as GatewayReply;
    expect(reply2.assistant.fullText).toContain("Server-B response:");

    // Cleanup
    deps.openclawClient.disconnect();
    wsServerA.close();
    wsServerB.close();
  });

  // ── Test 3: Rate limit config hot-reload ──

  it("rate limit config hot-reload: settings update changes limit value", async () => {
    // Start with limit of 5 -- allows room for settings requests (which share the limiter)
    const config = makeConfig({
      server: {
        ...makeConfig().server,
        rateLimitPerMinute: 5,
      },
    });

    const configStore = new ConfigStore(config);
    const openclawClient = new OpenClawClient({}, logger);

    httpServer = createGatewayServer({
      configStore,
      sttProviders: new Map(),
      openclawClient,
      logger,
      ready: true,
    });

    httpPort = await startServer(httpServer);

    const sendVoiceTurn = (): Promise<Response> =>
      fetch(`http://127.0.0.1:${httpPort}/api/voice/turn`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: Buffer.from("fake-audio"),
      });

    // Exhaust the 5-request limit
    for (let i = 0; i < 5; i++) {
      const r = await sendVoiceTurn();
      expect(r.status).not.toBe(429);
    }

    // Next request hits rate limit
    const r6 = await sendVoiceTurn();
    expect(r6.status).toBe(429);

    // Verify GET /api/settings shows current limit (GET is not rate-limited)
    const getResp1 = await fetch(`http://127.0.0.1:${httpPort}/api/settings`);
    expect(getResp1.status).toBe(200);
    const settings1 = (await getResp1.json()) as SafeGatewayConfig;
    expect(settings1.server.rateLimitPerMinute).toBe(5);

    // Update rate limit to 100 via ConfigStore directly (bypasses HTTP rate limiter)
    // This mirrors what POST /api/settings does internally
    configStore.update({ server: { rateLimitPerMinute: 100 } });

    // Verify the config store has the new value
    expect(configStore.get().server.rateLimitPerMinute).toBe(100);

    // After limit increase, additional requests should pass (within the same window,
    // the RateLimiter reads the new config on each check() call)
    const r7 = await sendVoiceTurn();
    expect(r7.status).not.toBe(429);

    // Verify GET /api/settings reflects the new limit
    const getResp2 = await fetch(`http://127.0.0.1:${httpPort}/api/settings`);
    expect(getResp2.status).toBe(200);
    const settings2 = (await getResp2.json()) as SafeGatewayConfig;
    expect(settings2.server.rateLimitPerMinute).toBe(100);

    openclawClient.disconnect();
  });
});
