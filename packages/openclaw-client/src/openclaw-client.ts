/**
 * OpenClaw WebSocket client for session messaging.
 *
 * Implements the OpenClaw gateway protocol (v3):
 *   1. Connect WebSocket
 *   2. Wait for connect.challenge event (provides nonce)
 *   3. Send connect request frame with auth + client info
 *   4. Receive hello-ok response
 *   5. Use chat.send method for transcript delivery
 *   6. Collect assistant response from chat events (delta/final)
 *
 * CLAW-01: Connect to OpenClaw gateway via WebSocket with proper protocol handshake.
 * CLAW-02: Receive assistant responses from OpenClaw session via chat events.
 * CLAW-03: Exponential backoff retries on transient failures.
 */

import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type {
  SessionKey,
  TurnId,
  OpenClawOutbound,
  OpenClawInbound,
} from "@voice-gateway/shared-types";
import {
  UserError,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";
import type { Logger } from "@voice-gateway/logging";
import { withRetry, type RetryOptions } from "./retry.js";

// ── OpenClaw Gateway Protocol Types ──

/** Protocol version supported by this client. */
const PROTOCOL_VERSION = 3;

/** Client identification for the gateway. */
const CLIENT_ID = "gateway-client" as const;
const CLIENT_MODE = "backend" as const;
const CLIENT_VERSION = "1.0.0";

/** Request frame sent to the gateway. */
interface RequestFrame {
  readonly type: "req";
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
}

/** Response frame received from the gateway. */
interface ResponseFrame {
  readonly type: "res";
  readonly id: string;
  readonly ok: boolean;
  readonly payload?: unknown;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

/** Event frame received from the gateway. */
interface EventFrame {
  readonly type: "event";
  readonly event: string;
  readonly payload?: unknown;
  readonly seq?: number;
}

/** Connect parameters for the gateway handshake. */
interface ConnectParams {
  readonly minProtocol: number;
  readonly maxProtocol: number;
  /** Challenge nonce echoed back from connect.challenge event. */
  readonly nonce?: string | undefined;
  readonly client: {
    readonly id: string;
    readonly displayName?: string | undefined;
    readonly version: string;
    readonly platform: string;
    readonly mode: string;
  };
  readonly caps: readonly string[];
  readonly role: string;
  readonly scopes: readonly string[];
  readonly auth?: {
    readonly token?: string | undefined;
  } | undefined;
}

/** Chat send parameters. */
interface ChatSendParams {
  readonly sessionKey: string;
  readonly message: string;
  readonly idempotencyKey: string;
  readonly timeoutMs?: number;
}

/** Chat event payload received from the gateway. */
interface ChatEventPayload {
  readonly runId: string;
  readonly sessionKey: string;
  readonly seq: number;
  readonly state: "delta" | "final" | "aborted" | "error";
  readonly message?: {
    readonly role?: string;
    readonly content?: ReadonlyArray<{
      readonly type?: string;
      readonly text?: string;
    }>;
  };
  readonly errorMessage?: string;
}

/** Pending request awaiting response. */
interface PendingRequest {
  readonly resolve: (payload: unknown) => void;
  readonly reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Pending chat turn awaiting final event. */
interface PendingChatTurn {
  readonly turnId: TurnId;
  readonly sessionKey: SessionKey;
  readonly runId: string;
  readonly resolve: (response: OpenClawInbound) => void;
  readonly reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  accumulatedText: string;
}

// ── Configuration ──

export interface OpenClawClientConfig {
  /** WebSocket URL of the OpenClaw gateway. */
  readonly gatewayUrl: string;
  /** Authentication token. */
  readonly authToken: string;
  /** Connection timeout in ms. */
  readonly connectTimeoutMs: number;
  /** Response timeout in ms (waiting for assistant response). */
  readonly responseTimeoutMs: number;
  /** Retry options for transient failures. */
  readonly retry: RetryOptions;
}

const DEFAULT_CONFIG: OpenClawClientConfig = {
  gatewayUrl: "ws://localhost:3000",
  authToken: "",
  connectTimeoutMs: 10_000,
  responseTimeoutMs: 60_000,
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30_000,
  },
};

/**
 * Persistent WebSocket client for OpenClaw gateway communication.
 *
 * Implements the full OpenClaw gateway protocol:
 * - connect.challenge / connect handshake
 * - Request/response framing (type:"req" / type:"res")
 * - Chat event streaming for assistant responses
 */
export class OpenClawClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly config: OpenClawClientConfig;
  private readonly log: Logger;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly pendingChatTurns = new Map<string, PendingChatTurn>();
  private connected = false;
  private handshakeComplete = false;

  constructor(config: Partial<OpenClawClientConfig>, logger: Logger) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = logger.child({ component: "openclaw-client" });
  }

  /** Connect to the OpenClaw gateway and complete protocol handshake. */
  async connect(): Promise<void> {
    if (this.connected && this.handshakeComplete && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    await withRetry(
      () => this.doConnect(),
      this.config.retry,
    );
  }

  /** Disconnect from the gateway. */
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, "Client disconnecting");
      this.ws = null;
      this.connected = false;
      this.handshakeComplete = false;
    }

    // Reject all pending requests
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new UserError(
          ErrorCodes.OPENCLAW_UNAVAILABLE,
          "Connection closed while waiting for response.",
        ),
      );
    }
    this.pendingRequests.clear();

    // Reject all pending chat turns
    for (const pending of this.pendingChatTurns.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new UserError(
          ErrorCodes.OPENCLAW_UNAVAILABLE,
          "Connection closed while waiting for response.",
        ),
      );
    }
    this.pendingChatTurns.clear();
  }

  /**
   * Send a transcript to an OpenClaw session and wait for the assistant response.
   *
   * Uses the OpenClaw chat.send method with proper framing.
   *
   * @returns The assistant's response
   * @throws UserError on timeout or connection issues
   * @throws OperatorError on protocol errors
   */
  async sendTranscript(
    sessionKey: SessionKey,
    turnId: TurnId,
    text: string,
  ): Promise<OpenClawInbound> {
    const log = this.log.child({ turnId, sessionKey });

    // Ensure connected and handshake complete
    if (!this.connected || !this.handshakeComplete || this.ws?.readyState !== WebSocket.OPEN) {
      log.info("Not connected, attempting to connect");
      await this.connect();
    }

    log.info("Sending transcript to OpenClaw", {
      textLength: text.length,
    });

    return withRetry(
      () => this.doChatSendAndWait(sessionKey, turnId, text, log),
      this.config.retry,
    );
  }

  /** Check if connected and handshake is complete. */
  isConnected(): boolean {
    return this.connected && this.handshakeComplete && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Health check -- attempts connection if not already connected. */
  async healthCheck(): Promise<{
    healthy: boolean;
    message: string;
    latencyMs: number;
  }> {
    const startMs = Date.now();
    try {
      if (!this.isConnected()) {
        await this.connect();
      }
      return {
        healthy: true,
        message: "OpenClaw connected",
        latencyMs: Date.now() - startMs,
      };
    } catch (err) {
      return {
        healthy: false,
        message: `OpenClaw unreachable: ${err instanceof Error ? err.message : String(err)}`,
        latencyMs: Date.now() - startMs,
      };
    }
  }

  // ── Private: Connection ──

  private doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = this.config.gatewayUrl;
      this.log.info("Connecting to OpenClaw", { url });

      const ws = new WebSocket(url, {
        handshakeTimeout: this.config.connectTimeoutMs,
      });

      const timeout = setTimeout(() => {
        ws.close();
        reject(
          new OperatorError(
            ErrorCodes.OPENCLAW_TIMEOUT,
            "OpenClaw connection timeout",
            `Timed out after ${this.config.connectTimeoutMs}ms connecting to ${url}`,
          ),
        );
      }, this.config.connectTimeoutMs);

      ws.on("open", () => {
        this.ws = ws;
        this.connected = true;
        this.handshakeComplete = false;
        this.setupHandlers(ws);
        this.log.info("WebSocket open, waiting for handshake");

        // Start handshake: either wait for connect.challenge or send connect after short delay
        // The server may send connect.challenge event with a nonce
        this.performHandshake(ws, timeout, resolve, reject);
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        reject(
          new OperatorError(
            ErrorCodes.OPENCLAW_UNAVAILABLE,
            "OpenClaw connection failed",
            err.message,
          ),
        );
      });
    });
  }

  private performHandshake(
    ws: WebSocket,
    connectTimeout: ReturnType<typeof setTimeout>,
    resolve: () => void,
    reject: (err: Error) => void,
  ): void {
    let handshakeResolved = false;

    const completeHandshake = (err?: Error) => {
      if (handshakeResolved) return;
      handshakeResolved = true;
      clearTimeout(connectTimeout);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    };

    // Store handshake callback so message handler can complete it
    this._handshakeCallback = completeHandshake;

    // Send connect after a short delay to allow for connect.challenge
    // If connect.challenge arrives first, sendConnect will be called from there
    this._connectTimer = setTimeout(() => {
      if (!handshakeResolved && !this._connectSent) {
        this.log.info("No connect.challenge received, sending connect without nonce");
        this.sendConnectFrame(ws, undefined);
      }
    }, 750);
  }

  // Handshake state
  private _handshakeCallback: ((err?: Error) => void) | null = null;
  private _connectSent = false;
  private _connectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connectNonce: string | null = null;

  private sendConnectFrame(ws: WebSocket, nonce: string | undefined): void {
    if (this._connectSent) return;
    this._connectSent = true;

    if (this._connectTimer) {
      clearTimeout(this._connectTimer);
      this._connectTimer = null;
    }

    const connectParams: ConnectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      nonce: nonce ?? undefined,
      client: {
        id: CLIENT_ID,
        displayName: "Even G2 Voice Gateway",
        version: CLIENT_VERSION,
        platform: process.platform,
        mode: CLIENT_MODE,
      },
      caps: [],
      role: "operator",
      scopes: ["operator.admin"],
      auth: this.config.authToken
        ? { token: this.config.authToken }
        : undefined,
    };

    const requestId = randomUUID();
    const frame: RequestFrame = {
      type: "req",
      id: requestId,
      method: "connect",
      params: connectParams,
    };

    this.log.info("Sending connect request", { requestId, hasNonce: Boolean(nonce) });

    // Register pending request for connect response
    const timer = setTimeout(() => {
      this.pendingRequests.delete(requestId);
      this._handshakeCallback?.(
        new OperatorError(
          ErrorCodes.OPENCLAW_TIMEOUT,
          "OpenClaw handshake timeout",
          "Timed out waiting for hello-ok response",
        ),
      );
    }, this.config.connectTimeoutMs);

    this.pendingRequests.set(requestId, {
      resolve: (payload) => {
        this.handshakeComplete = true;
        this.log.info("OpenClaw handshake complete (hello-ok received)");
        this._handshakeCallback?.();
      },
      reject: (err) => {
        this._handshakeCallback?.(err);
      },
      timer,
    });

    ws.send(JSON.stringify(frame), (err) => {
      if (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        this._handshakeCallback?.(
          new OperatorError(
            ErrorCodes.OPENCLAW_UNAVAILABLE,
            "Failed to send connect frame",
            err.message,
          ),
        );
      }
    });
  }

  // ── Private: Message Handling ──

  private setupHandlers(ws: WebSocket): void {
    ws.on("message", (data) => {
      try {
        const raw = data.toString();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        this.handleFrame(parsed);
      } catch (err) {
        this.log.warn("Failed to parse OpenClaw message", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    ws.on("close", (code, reason) => {
      this.connected = false;
      this.handshakeComplete = false;
      this._connectSent = false;
      this._connectNonce = null;

      if (this._connectTimer) {
        clearTimeout(this._connectTimer);
        this._connectTimer = null;
      }

      this.log.warn("OpenClaw connection closed", {
        code,
        reason: reason.toString(),
      });

      // Reject all pending requests
      for (const pending of this.pendingRequests.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new UserError(
            ErrorCodes.OPENCLAW_UNAVAILABLE,
            "Connection to AI agent lost. Please try again.",
          ),
        );
      }
      this.pendingRequests.clear();

      // Reject all pending chat turns
      for (const pending of this.pendingChatTurns.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new UserError(
            ErrorCodes.OPENCLAW_UNAVAILABLE,
            "Connection to AI agent lost. Please try again.",
          ),
        );
      }
      this.pendingChatTurns.clear();

      // Complete handshake with error if still pending
      this._handshakeCallback?.(
        new OperatorError(
          ErrorCodes.OPENCLAW_UNAVAILABLE,
          "OpenClaw connection closed during handshake",
          `WebSocket closed with code ${code}: ${reason.toString()}`,
        ),
      );

      this.emit("close", code, reason.toString());
    });

    ws.on("error", (err) => {
      this.log.error("OpenClaw WebSocket error", {
        error: err.message,
      });
      this.emit("error", err);
    });
  }

  private handleFrame(frame: Record<string, unknown>): void {
    const frameType = frame["type"];

    if (frameType === "event") {
      this.handleEventFrame(frame as unknown as EventFrame);
    } else if (frameType === "res") {
      this.handleResponseFrame(frame as unknown as ResponseFrame);
    } else {
      this.log.warn("Received unknown frame type", { type: frameType });
    }
  }

  private handleEventFrame(event: EventFrame): void {
    if (event.event === "connect.challenge") {
      const payload = event.payload as { nonce?: unknown } | undefined;
      const nonce = payload && typeof payload.nonce === "string" ? payload.nonce : null;
      this.log.info("Received connect.challenge", { hasNonce: Boolean(nonce) });
      if (nonce) {
        this._connectNonce = nonce;
        if (this.ws) {
          this.sendConnectFrame(this.ws, nonce);
        }
      }
      return;
    }

    if (event.event === "chat") {
      this.handleChatEvent(event.payload as ChatEventPayload);
      return;
    }

    // Ignore tick and other events silently
    if (event.event !== "tick") {
      this.log.info("Received event", { event: event.event });
    }
  }

  private handleResponseFrame(response: ResponseFrame): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      // Check if this is an ack for a chat.send (status: "started" or "accepted")
      // We don't track these by request ID since we use runId for chat tracking
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if (response.ok) {
      pending.resolve(response.payload);
    } else {
      const errMsg = response.error?.message ?? "Unknown gateway error";
      const errCode = response.error?.code ?? "UNKNOWN";
      pending.reject(
        new OperatorError(
          ErrorCodes.OPENCLAW_SESSION_ERROR,
          `OpenClaw error: ${errMsg}`,
          `code=${errCode} message=${errMsg}`,
        ),
      );
    }
  }

  private handleChatEvent(payload: ChatEventPayload): void {
    if (!payload || !payload.runId) return;

    const pending = this.pendingChatTurns.get(payload.runId);
    if (!pending) {
      // Could be a chat event for a session we're not tracking
      return;
    }

    if (payload.state === "delta") {
      // Accumulate text from delta events
      const text = extractTextFromMessage(payload.message);
      if (text) {
        pending.accumulatedText += text;
      }
      return;
    }

    if (payload.state === "final") {
      clearTimeout(pending.timer);
      this.pendingChatTurns.delete(payload.runId);

      // Extract text from final message, or use accumulated deltas
      const finalText = extractTextFromMessage(payload.message);
      const responseText = finalText || pending.accumulatedText || "";

      const response: OpenClawInbound = {
        sessionKey: pending.sessionKey,
        turnId: pending.turnId,
        text: responseText,
        timestamp: new Date().toISOString(),
      };

      this.log.info("Received OpenClaw response (chat final)", {
        turnId: pending.turnId,
        textLength: response.text.length,
      });

      pending.resolve(response);
      return;
    }

    if (payload.state === "error") {
      clearTimeout(pending.timer);
      this.pendingChatTurns.delete(payload.runId);

      pending.reject(
        new UserError(
          ErrorCodes.OPENCLAW_SESSION_ERROR,
          `AI agent error: ${payload.errorMessage ?? "Unknown error"}`,
        ),
      );
      return;
    }

    if (payload.state === "aborted") {
      clearTimeout(pending.timer);
      this.pendingChatTurns.delete(payload.runId);

      // If we have accumulated text, treat it as a partial success
      if (pending.accumulatedText) {
        const response: OpenClawInbound = {
          sessionKey: pending.sessionKey,
          turnId: pending.turnId,
          text: pending.accumulatedText,
          timestamp: new Date().toISOString(),
        };
        pending.resolve(response);
      } else {
        pending.reject(
          new UserError(
            ErrorCodes.OPENCLAW_SESSION_ERROR,
            "AI agent response was aborted.",
          ),
        );
      }
    }
  }

  // ── Private: Chat Send ──

  private doChatSendAndWait(
    sessionKey: SessionKey,
    turnId: TurnId,
    text: string,
    log: Logger,
  ): Promise<OpenClawInbound> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.handshakeComplete) {
        reject(
          new OperatorError(
            ErrorCodes.OPENCLAW_UNAVAILABLE,
            "Not connected to OpenClaw",
            "WebSocket is not open or handshake not complete",
          ),
        );
        return;
      }

      const idempotencyKey = randomUUID();
      const requestId = randomUUID();

      const chatParams: ChatSendParams = {
        sessionKey: sessionKey as string,
        message: text,
        idempotencyKey,
        timeoutMs: this.config.responseTimeoutMs,
      };

      const frame: RequestFrame = {
        type: "req",
        id: requestId,
        method: "chat.send",
        params: chatParams,
      };

      // Set up chat turn tracking using idempotencyKey as runId
      const chatTimer = setTimeout(() => {
        this.pendingChatTurns.delete(idempotencyKey);
        this.pendingRequests.delete(requestId);
        reject(
          new UserError(
            ErrorCodes.OPENCLAW_TIMEOUT,
            "AI agent took too long to respond. Please try again.",
          ),
        );
      }, this.config.responseTimeoutMs);

      this.pendingChatTurns.set(idempotencyKey, {
        turnId,
        sessionKey,
        runId: idempotencyKey,
        resolve,
        reject,
        timer: chatTimer,
        accumulatedText: "",
      });

      // Also track the request to handle immediate errors from chat.send
      const requestTimer = setTimeout(() => {
        // Request-level timeout is shorter; chat turn timeout handles the long wait
        this.pendingRequests.delete(requestId);
      }, 30_000);

      this.pendingRequests.set(requestId, {
        resolve: (payload) => {
          // chat.send ack received (status: "started" or "accepted")
          // The actual response comes via chat events
          const p = payload as { status?: string; runId?: string } | undefined;
          log.info("chat.send acknowledged", {
            status: p?.status,
            runId: p?.runId,
          });
        },
        reject: (err) => {
          // chat.send itself failed (validation error, etc.)
          clearTimeout(chatTimer);
          this.pendingChatTurns.delete(idempotencyKey);
          reject(err);
        },
        timer: requestTimer,
      });

      const payload = JSON.stringify(frame);
      this.ws.send(payload, (err) => {
        if (err) {
          clearTimeout(chatTimer);
          clearTimeout(requestTimer);
          this.pendingChatTurns.delete(idempotencyKey);
          this.pendingRequests.delete(requestId);
          log.error("Failed to send chat.send to OpenClaw", {
            error: err.message,
          });
          reject(
            new OperatorError(
              ErrorCodes.OPENCLAW_UNAVAILABLE,
              "Failed to send transcript",
              err.message,
            ),
          );
        }
      });
    });
  }
}

// ── Helpers ──

/**
 * Extract text content from an OpenClaw chat message object.
 * Messages use the format: { role, content: [{type: "text", text: "..."}] }
 */
function extractTextFromMessage(
  message: ChatEventPayload["message"] | undefined,
): string {
  if (!message) return "";

  // Try content array first (standard format)
  if (Array.isArray(message.content)) {
    const textParts: string[] = [];
    for (const block of message.content) {
      if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      }
    }
    if (textParts.length > 0) {
      return textParts.join("");
    }
  }

  // Try content as string (simple format)
  if (typeof message.content === "string") {
    return message.content as string;
  }

  return "";
}
