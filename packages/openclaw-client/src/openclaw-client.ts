/**
 * OpenClaw WebSocket client for session messaging.
 *
 * CLAW-01: Connect to OpenClaw gateway via WebSocket, send transcripts on configured session.
 * CLAW-02: Receive assistant responses from OpenClaw session.
 * CLAW-03: Exponential backoff retries on transient failures.
 */

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

interface PendingTurn {
  readonly turnId: TurnId;
  readonly sessionKey: SessionKey;
  resolve: (response: OpenClawInbound) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Persistent WebSocket client for OpenClaw gateway communication.
 *
 * Maintains a single connection, sends transcripts, and receives
 * assistant responses with correlation via TurnId.
 */
export class OpenClawClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly config: OpenClawClientConfig;
  private readonly log: Logger;
  private readonly pending = new Map<string, PendingTurn>();
  private connected = false;

  constructor(config: Partial<OpenClawClientConfig>, logger: Logger) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.log = logger.child({ component: "openclaw-client" });
  }

  /** Connect to the OpenClaw gateway. */
  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
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
    }

    // Reject all pending turns
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new UserError(
          ErrorCodes.OPENCLAW_UNAVAILABLE,
          "Connection closed while waiting for response.",
        ),
      );
    }
    this.pending.clear();
  }

  /**
   * Send a transcript to an OpenClaw session and wait for the assistant response.
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

    // Ensure connected
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
      log.info("Not connected, attempting to connect");
      await this.connect();
    }

    const outbound: OpenClawOutbound = {
      sessionKey,
      turnId,
      text,
      timestamp: new Date().toISOString(),
    };

    log.info("Sending transcript to OpenClaw", {
      textLength: text.length,
    });

    return withRetry(
      () => this.doSendAndWait(outbound, log),
      this.config.retry,
    );
  }

  /** Check if connected. */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Health check — attempts connection if not already connected. */
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

  // ── Private ──

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.config.gatewayUrl;
      this.log.info("Connecting to OpenClaw", { url });

      const ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.config.authToken}`,
        },
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
        clearTimeout(timeout);
        this.ws = ws;
        this.connected = true;
        this.setupHandlers(ws);
        this.log.info("Connected to OpenClaw");
        resolve();
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

  private setupHandlers(ws: WebSocket): void {
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        this.handleMessage(message);
      } catch (err) {
        this.log.warn("Failed to parse OpenClaw message", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    ws.on("close", (code, reason) => {
      this.connected = false;
      this.log.warn("OpenClaw connection closed", {
        code,
        reason: reason.toString(),
      });

      // Reject all pending turns
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new UserError(
            ErrorCodes.OPENCLAW_UNAVAILABLE,
            "Connection to AI agent lost. Please try again.",
          ),
        );
      }
      this.pending.clear();

      this.emit("close", code, reason.toString());
    });

    ws.on("error", (err) => {
      this.log.error("OpenClaw WebSocket error", {
        error: err.message,
      });
      this.emit("error", err);
    });
  }

  private handleMessage(message: Record<string, unknown>): void {
    const turnId = message["turnId"] as string | undefined;
    if (!turnId) {
      this.log.warn("Received message without turnId", { message });
      return;
    }

    const pending = this.pending.get(turnId);
    if (!pending) {
      this.log.warn("Received response for unknown turnId", { turnId });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(turnId);

    // Check for error responses
    if (message["error"]) {
      pending.reject(
        new UserError(
          ErrorCodes.OPENCLAW_SESSION_ERROR,
          `AI agent error: ${String(message["error"])}`,
        ),
      );
      return;
    }

    const response: OpenClawInbound = {
      sessionKey: pending.sessionKey,
      turnId: pending.turnId,
      text: String(message["text"] ?? ""),
      timestamp: String(message["timestamp"] ?? new Date().toISOString()),
    };

    this.log.info("Received OpenClaw response", {
      turnId,
      textLength: response.text.length,
    });

    pending.resolve(response);
  }

  private doSendAndWait(
    outbound: OpenClawOutbound,
    log: Logger,
  ): Promise<OpenClawInbound> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(
          new OperatorError(
            ErrorCodes.OPENCLAW_UNAVAILABLE,
            "Not connected to OpenClaw",
            "WebSocket is not open",
          ),
        );
        return;
      }

      const timer = setTimeout(() => {
        this.pending.delete(outbound.turnId);
        reject(
          new UserError(
            ErrorCodes.OPENCLAW_TIMEOUT,
            "AI agent took too long to respond. Please try again.",
          ),
        );
      }, this.config.responseTimeoutMs);

      this.pending.set(outbound.turnId, {
        turnId: outbound.turnId,
        sessionKey: outbound.sessionKey,
        resolve,
        reject,
        timer,
      });

      const payload = JSON.stringify(outbound);
      this.ws.send(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(outbound.turnId);
          log.error("Failed to send to OpenClaw", {
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
