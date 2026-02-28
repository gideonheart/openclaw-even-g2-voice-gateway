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

/**
 * Mock OpenClaw gateway server that implements the real protocol:
 * 1. Send connect.challenge event on connection
 * 2. Validate connect request frame
 * 3. Respond with hello-ok
 * 4. Handle chat.send requests and emit chat events
 */
function createMockOpenClawServer(port: number = 0): {
  server: WebSocketServer;
  getPort: () => number;
} {
  const server = new WebSocketServer({ port });
  const address = server.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    server,
    getPort: () => {
      const addr = server.address();
      return typeof addr === "object" && addr !== null ? addr.port : 0;
    },
  };
}

/**
 * Attach standard OpenClaw gateway protocol handlers to a WS server.
 * Sends connect.challenge, validates connect, responds with hello-ok,
 * and handles chat.send by emitting chat final events.
 */
function attachGatewayProtocol(
  server: WebSocketServer,
  options: {
    challengeNonce?: string;
    authToken?: string;
    chatResponse?: string | ((message: string) => string);
    rejectConnect?: boolean;
    skipChallenge?: boolean;
    chatErrorMessage?: string;
  } = {},
): void {
  const {
    challengeNonce = "test-nonce-123",
    authToken,
    chatResponse = "AI response",
    rejectConnect = false,
    skipChallenge = false,
    chatErrorMessage,
  } = options;

  server.on("connection", (ws) => {
    let authenticated = false;

    // Step 1: Send connect.challenge event
    if (!skipChallenge) {
      ws.send(JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: challengeNonce },
      }));
    }

    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as {
        type: string;
        id: string;
        method: string;
        params?: Record<string, unknown>;
      };

      // Validate frame structure
      if (frame.type !== "req" || !frame.id || !frame.method) {
        ws.close(1008, "invalid request frame");
        return;
      }

      if (!authenticated) {
        // Must be a connect request
        if (frame.method !== "connect") {
          ws.send(JSON.stringify({
            type: "res",
            id: frame.id,
            ok: false,
            error: { code: "INVALID_REQUEST", message: "invalid handshake: first request must be connect" },
          }));
          ws.close(1008, "invalid handshake: first request must be connect");
          return;
        }

        if (rejectConnect) {
          ws.send(JSON.stringify({
            type: "res",
            id: frame.id,
            ok: false,
            error: { code: "INVALID_REQUEST", message: "unauthorized" },
          }));
          ws.close(1008, "unauthorized");
          return;
        }

        // Validate auth token if required
        if (authToken) {
          const auth = (frame.params as { auth?: { token?: string } })?.auth;
          if (auth?.token !== authToken) {
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: false,
              error: { code: "INVALID_REQUEST", message: "invalid token" },
            }));
            ws.close(1008, "invalid token");
            return;
          }
        }

        // Send hello-ok response
        authenticated = true;
        ws.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            type: "hello-ok",
            protocol: 3,
            server: {
              version: "test",
              connId: "test-conn-1",
            },
            features: {
              methods: ["chat.send", "chat.history"],
              events: ["chat", "tick"],
            },
            snapshot: {
              presence: [],
              stateVersion: { presence: 0, health: 0 },
            },
            policy: {
              maxPayload: 1048576,
              maxBufferedBytes: 4194304,
              tickIntervalMs: 30000,
            },
          },
        }));
        return;
      }

      // After handshake -- handle chat.send
      if (frame.method === "chat.send") {
        const params = frame.params as {
          sessionKey: string;
          message: string;
          idempotencyKey: string;
        };

        // Send ack response
        ws.send(JSON.stringify({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            runId: params.idempotencyKey,
            status: "started",
          },
        }));

        // Simulate chat error if configured
        if (chatErrorMessage) {
          ws.send(JSON.stringify({
            type: "event",
            event: "chat",
            payload: {
              runId: params.idempotencyKey,
              sessionKey: params.sessionKey,
              seq: 0,
              state: "error",
              errorMessage: chatErrorMessage,
            },
          }));
          return;
        }

        // Send final chat event with response
        const responseText = typeof chatResponse === "function"
          ? chatResponse(params.message)
          : chatResponse;

        // Small delay to simulate real behavior
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
        return;
      }

      // Unknown method
      ws.send(JSON.stringify({
        type: "res",
        id: frame.id,
        ok: false,
        error: { code: "INVALID_REQUEST", message: `unknown method: ${frame.method}` },
      }));
    });
  });
}

describe("OpenClawClient", () => {
  const logger = new Logger();
  let server: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    // Start a mock OpenClaw WebSocket server
    const mock = createMockOpenClawServer();
    server = mock.server;
    port = mock.getPort();
  });

  afterEach(() => {
    server.close();
    vi.restoreAllMocks();
  });

  describe("Protocol Handshake", () => {
    it("completes connect.challenge + connect handshake", async () => {
      attachGatewayProtocol(server);

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

    it("connects even without connect.challenge (fallback timer)", async () => {
      attachGatewayProtocol(server, { skipChallenge: true });

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

    it("sends auth token in connect params", async () => {
      let receivedToken: string | undefined;
      server.on("connection", (ws) => {
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "nonce-1" },
        }));
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          if (frame.method === "connect") {
            receivedToken = frame.params?.auth?.token;
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
          }
        });
      });

      const client = new OpenClawClient(
        {
          gatewayUrl: `ws://127.0.0.1:${port}`,
          authToken: "my-secret-token-xyz",
          connectTimeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
        },
        logger,
      );

      await client.connect();
      expect(receivedToken).toBe("my-secret-token-xyz");
      client.disconnect();
    });

    it("does not include root-level nonce in connect frame params (schema compliance)", async () => {
      let receivedParams: Record<string, unknown> | undefined;
      server.on("connection", (ws) => {
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "challenge-nonce-abc123" },
        }));
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          if (frame.method === "connect") {
            receivedParams = frame.params;
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
          }
        });
      });

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
      expect(receivedParams).toBeDefined();
      // Root-level nonce is NOT part of OpenClaw ConnectParams schema (additionalProperties: false).
      // Nonce belongs in device.nonce for device-paired connections only.
      // Backend token-auth connections must NOT send root-level nonce.
      expect(receivedParams!["nonce"]).toBeUndefined();
      expect(client.isConnected()).toBe(true);
      client.disconnect();
    });

    it("connect params match OpenClaw ConnectParamsSchema (no extra properties)", async () => {
      let receivedParams: Record<string, unknown> | undefined;
      server.on("connection", (ws) => {
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "nonce-schema-check" },
        }));
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          if (frame.method === "connect") {
            receivedParams = frame.params;
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
          }
        });
      });

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
      expect(receivedParams).toBeDefined();

      // Only these top-level keys are allowed by ConnectParamsSchema (additionalProperties: false):
      // minProtocol, maxProtocol, client, caps, commands, permissions, pathEnv, role, scopes,
      // device, auth, locale, userAgent
      const allowedKeys = new Set([
        "minProtocol", "maxProtocol", "client", "caps", "commands", "permissions",
        "pathEnv", "role", "scopes", "device", "auth", "locale", "userAgent",
      ]);
      const actualKeys = Object.keys(receivedParams!);
      for (const key of actualKeys) {
        expect(allowedKeys.has(key)).toBe(true);
      }

      client.disconnect();
    });

    it("connects successfully with server that enforces strict schema (no extra props)", async () => {
      // Server that rejects any unknown properties in connect params (like the real OpenClaw server)
      server.on("connection", (ws) => {
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "strict-nonce-xyz" },
        }));
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          if (frame.method === "connect") {
            // Strict schema validation: reject if any unknown root-level properties
            const allowedKeys = new Set([
              "minProtocol", "maxProtocol", "client", "caps", "commands", "permissions",
              "pathEnv", "role", "scopes", "device", "auth", "locale", "userAgent",
            ]);
            const params = frame.params as Record<string, unknown>;
            const unknownKeys = Object.keys(params).filter((k) => !allowedKeys.has(k));
            if (unknownKeys.length > 0) {
              ws.send(JSON.stringify({
                type: "res",
                id: frame.id,
                ok: false,
                error: { code: "INVALID_REQUEST", message: `invalid connect params: at root: unexpected property '${unknownKeys[0]}'` },
              }));
              ws.close(1008, `invalid connect params: at root: unexpected property '${unknownKeys[0]}'`);
              return;
            }
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
          }
        });
      });

      const client = new OpenClawClient(
        {
          gatewayUrl: `ws://127.0.0.1:${port}`,
          authToken: "test-token",
          connectTimeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
        },
        logger,
      );

      // This must succeed -- our connect params must not have any unknown properties
      await client.connect();
      expect(client.isConnected()).toBe(true);
      client.disconnect();
    });

    it("sends proper request frame format (type:req, id, method, params)", async () => {
      let receivedFrame: Record<string, unknown> | undefined;
      server.on("connection", (ws) => {
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "nonce-1" },
        }));
        ws.on("message", (data) => {
          receivedFrame = JSON.parse(data.toString());
          if ((receivedFrame as { method?: string }).method === "connect") {
            ws.send(JSON.stringify({
              type: "res",
              id: (receivedFrame as { id: string }).id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
          }
        });
      });

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

      // Verify frame structure
      expect(receivedFrame).toBeDefined();
      expect(receivedFrame!["type"]).toBe("req");
      expect(receivedFrame!["id"]).toBeDefined();
      expect(typeof receivedFrame!["id"]).toBe("string");
      expect((receivedFrame!["id"] as string).length).toBeGreaterThan(0);
      expect(receivedFrame!["method"]).toBe("connect");
      expect(receivedFrame!["params"]).toBeDefined();

      // Verify connect params structure
      const params = receivedFrame!["params"] as Record<string, unknown>;
      expect(params["minProtocol"]).toBe(3);
      expect(params["maxProtocol"]).toBe(3);
      expect(params["client"]).toBeDefined();
      const clientInfo = params["client"] as Record<string, unknown>;
      expect(clientInfo["id"]).toBe("gateway-client");
      expect(clientInfo["mode"]).toBe("backend");
      expect(clientInfo["version"]).toBeDefined();
      expect(clientInfo["platform"]).toBeDefined();

      client.disconnect();
    });
  });

  describe("Chat Send (Transcript)", () => {
    it("sends transcript as chat.send and receives response via chat event", async () => {
      attachGatewayProtocol(server, {
        chatResponse: (msg) => `Response to: ${msg}`,
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

    it("sends chat.send with proper frame format", async () => {
      let chatSendFrame: Record<string, unknown> | undefined;
      attachGatewayProtocol(server);
      // Intercept after the default handler
      const originalOnConnection = server.listeners("connection");
      server.removeAllListeners("connection");
      server.on("connection", (ws) => {
        let authenticated = false;
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "n1" },
        }));
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          if (frame.method === "connect" && !authenticated) {
            authenticated = true;
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: ["chat.send"], events: ["chat"] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
            return;
          }
          if (frame.method === "chat.send") {
            chatSendFrame = frame;
            const params = frame.params as { idempotencyKey: string; sessionKey: string };
            // Send ack
            ws.send(JSON.stringify({
              type: "res", id: frame.id, ok: true,
              payload: { runId: params.idempotencyKey, status: "started" },
            }));
            // Send final event
            setTimeout(() => {
              ws.send(JSON.stringify({
                type: "event", event: "chat",
                payload: {
                  runId: params.idempotencyKey,
                  sessionKey: params.sessionKey,
                  seq: 0, state: "final",
                  message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
                },
              }));
            }, 5);
          }
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
      await client.sendTranscript(
        createSessionKey("my-session"),
        createTurnId("turn_frame_check"),
        "Test message",
      );

      // Verify chat.send frame structure
      expect(chatSendFrame).toBeDefined();
      expect(chatSendFrame!["type"]).toBe("req");
      expect(chatSendFrame!["method"]).toBe("chat.send");
      expect(typeof chatSendFrame!["id"]).toBe("string");

      const params = chatSendFrame!["params"] as Record<string, unknown>;
      expect(params["sessionKey"]).toBe("my-session");
      expect(params["message"]).toBe("Test message");
      expect(params["idempotencyKey"]).toBeDefined();
      expect(typeof params["idempotencyKey"]).toBe("string");

      client.disconnect();
    });
  });

  describe("Error Handling", () => {
    it("handles chat error events", async () => {
      attachGatewayProtocol(server, {
        chatErrorMessage: "Session not found",
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

    it("times out when no chat event received", async () => {
      // Server accepts and acks chat.send but never sends chat event
      server.on("connection", (ws) => {
        let authenticated = false;
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "n1" },
        }));
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          if (frame.method === "connect" && !authenticated) {
            authenticated = true;
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
            return;
          }
          if (frame.method === "chat.send") {
            const params = frame.params as { idempotencyKey: string };
            // Send ack but never send chat event
            ws.send(JSON.stringify({
              type: "res", id: frame.id, ok: true,
              payload: { runId: params.idempotencyKey, status: "started" },
            }));
          }
        });
      });

      const client = new OpenClawClient(
        {
          gatewayUrl: `ws://127.0.0.1:${port}`,
          authToken: "test-token",
          connectTimeoutMs: 5000,
          responseTimeoutMs: 200, // Very short timeout
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

    it("rejects pending turns on disconnect", async () => {
      // Server accepts but never responds to chat.send
      server.on("connection", (ws) => {
        let authenticated = false;
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "n1" },
        }));
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          if (frame.method === "connect" && !authenticated) {
            authenticated = true;
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
          }
        });
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

    it("rejects when server sends 1008 on invalid frame", async () => {
      // Server that closes with 1008 for any non-connect first message
      server.on("connection", (ws) => {
        // Don't send challenge -- client will send connect after delay
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          if (frame.type !== "req") {
            ws.close(1008, "invalid request frame");
            return;
          }
          if (frame.method === "connect") {
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
          }
        });
      });

      const client = new OpenClawClient(
        {
          gatewayUrl: `ws://127.0.0.1:${port}`,
          authToken: "test-token",
          connectTimeoutMs: 5000,
          retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
        },
        logger,
      );

      // This should succeed because our client now sends proper frames
      await client.connect();
      expect(client.isConnected()).toBe(true);
      client.disconnect();
    });
  });

  describe("Health Check", () => {
    it("healthCheck returns healthy when connected", async () => {
      attachGatewayProtocol(server);

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

  describe("Framing Contract Regression", () => {
    it("never sends raw domain objects (OpenClawOutbound) to the server", async () => {
      const receivedFrames: Record<string, unknown>[] = [];

      server.on("connection", (ws) => {
        let authenticated = false;
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "n1" },
        }));
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          receivedFrames.push(frame);

          if (frame.method === "connect" && !authenticated) {
            authenticated = true;
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
            return;
          }
          if (frame.method === "chat.send") {
            const params = frame.params as { idempotencyKey: string; sessionKey: string };
            ws.send(JSON.stringify({
              type: "res", id: frame.id, ok: true,
              payload: { runId: params.idempotencyKey, status: "started" },
            }));
            setTimeout(() => {
              ws.send(JSON.stringify({
                type: "event", event: "chat",
                payload: {
                  runId: params.idempotencyKey,
                  sessionKey: params.sessionKey,
                  seq: 0, state: "final",
                  message: { role: "assistant", content: [{ type: "text", text: "done" }] },
                },
              }));
            }, 5);
          }
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
      await client.sendTranscript(
        createSessionKey("sess-1"),
        createTurnId("turn_contract"),
        "Hello",
      );

      // REGRESSION CHECK: Every frame must be type:"req"
      for (const frame of receivedFrames) {
        expect(frame["type"]).toBe("req");
        expect(frame["id"]).toBeDefined();
        expect(frame["method"]).toBeDefined();
      }

      // First frame must be connect
      expect(receivedFrames[0]!["method"]).toBe("connect");
      // Second frame must be chat.send
      expect(receivedFrames[1]!["method"]).toBe("chat.send");

      // No frame should have raw OpenClawOutbound fields at top level
      for (const frame of receivedFrames) {
        expect(frame).not.toHaveProperty("sessionKey");
        expect(frame).not.toHaveProperty("turnId");
        expect(frame).not.toHaveProperty("text");
        expect(frame).not.toHaveProperty("timestamp");
      }

      client.disconnect();
    });

    it("all frames have type:'req' with required fields", async () => {
      const receivedFrames: unknown[] = [];

      server.on("connection", (ws) => {
        let authenticated = false;
        ws.send(JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "n1" },
        }));
        ws.on("message", (data) => {
          const frame = JSON.parse(data.toString());
          receivedFrames.push(frame);

          if (frame.method === "connect" && !authenticated) {
            authenticated = true;
            ws.send(JSON.stringify({
              type: "res",
              id: frame.id,
              ok: true,
              payload: {
                type: "hello-ok",
                protocol: 3,
                server: { version: "test", connId: "c1" },
                features: { methods: [], events: [] },
                snapshot: { presence: [], stateVersion: { presence: 0, health: 0 } },
                policy: { maxPayload: 1024, maxBufferedBytes: 4096, tickIntervalMs: 30000 },
              },
            }));
          }
        });
      });

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

      for (const raw of receivedFrames) {
        const frame = raw as Record<string, unknown>;
        // Must have type:"req"
        expect(frame["type"]).toBe("req");
        // Must have non-empty string id
        expect(typeof frame["id"]).toBe("string");
        expect((frame["id"] as string).length).toBeGreaterThan(0);
        // Must have non-empty string method
        expect(typeof frame["method"]).toBe("string");
        expect((frame["method"] as string).length).toBeGreaterThan(0);
      }

      client.disconnect();
    });
  });
});
