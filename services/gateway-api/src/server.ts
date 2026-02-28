/**
 * HTTP server with all API endpoints.
 *
 * Endpoints:
 * - POST /api/voice/turn — execute a voice turn (audio → response)
 * - POST /api/settings — update runtime configuration
 * - GET  /api/settings — get safe config (secrets masked)
 * - GET  /healthz — liveness check
 * - GET  /readyz — readiness check (dependencies healthy)
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type {
  GatewayConfig,
  SafeGatewayConfig,
  ProviderId,
  SessionKey,
  AudioPayload,
  AudioContentType,
  GatewayReply,
} from "@voice-gateway/shared-types";
import {
  createTurnId,
  createSessionKey,
  UserError,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";
import type { SttProvider } from "@voice-gateway/stt-contract";
import type { OpenClawClient } from "@voice-gateway/openclaw-client";
import { validateAudioContentType, validateAudioSize } from "@voice-gateway/validation";
import { executeVoiceTurn } from "./orchestrator.js";
import type { Logger } from "@voice-gateway/logging";

export interface ServerDeps {
  readonly config: GatewayConfig;
  readonly sttProviders: Map<string, SttProvider>;
  readonly openclawClient: OpenClawClient;
  readonly logger: Logger;
}

/** Create and return the HTTP server (not yet listening). */
export function createGatewayServer(deps: ServerDeps): Server {
  const log = deps.logger.child({ component: "http-server" });

  const server = createServer(async (req, res) => {
    const turnId = createTurnId();
    const requestLog = log.child({ turnId, method: req.method, url: req.url });

    try {
      // CORS handling
      if (handleCors(req, res, deps.config.server.corsOrigins)) return;

      const url = req.url ?? "";
      const method = req.method ?? "GET";

      // Route
      if (method === "POST" && url === "/api/voice/turn") {
        await handleVoiceTurn(req, res, deps, turnId, requestLog);
      } else if (method === "POST" && url === "/api/settings") {
        await handlePostSettings(req, res, requestLog);
      } else if (method === "GET" && url === "/api/settings") {
        handleGetSettings(res, deps.config);
      } else if (method === "GET" && url === "/healthz") {
        handleHealthz(res);
      } else if (method === "GET" && url === "/readyz") {
        await handleReadyz(res, deps);
      } else {
        sendJson(res, 404, { error: "Not found" });
      }
    } catch (err) {
      handleError(res, err, requestLog);
    }
  });

  return server;
}

// ── Route Handlers ──

async function handleVoiceTurn(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  turnId: ReturnType<typeof createTurnId>,
  log: Logger,
): Promise<void> {
  // Read body
  const body = await readBody(req, deps.config.server.maxAudioBytes);

  // Validate content type
  const contentType = validateAudioContentType(req.headers["content-type"]);

  // Validate size
  validateAudioSize(body.length, deps.config.server.maxAudioBytes);

  const audio: AudioPayload = {
    data: body,
    contentType,
    languageHint: req.headers["x-language-hint"] as string | undefined,
  };

  log.info("Voice turn request received", {
    audioBytes: body.length,
    contentType,
  });

  const result = await executeVoiceTurn(
    {
      turnId,
      sessionKey: deps.config.openclawSessionKey,
      audio,
    },
    {
      sttProviders: deps.sttProviders,
      activeProviderId: deps.config.sttProvider,
      openclawClient: deps.openclawClient,
      logger: deps.logger,
    },
  );

  sendJson(res, 200, result.reply);
}

async function handlePostSettings(
  _req: IncomingMessage,
  res: ServerResponse,
  log: Logger,
): Promise<void> {
  // Phase 2 — settings management
  log.info("Settings update requested (not implemented in Phase 1)");
  sendJson(res, 501, {
    error: "Settings API will be implemented in Phase 2",
  });
}

function handleGetSettings(
  res: ServerResponse,
  config: GatewayConfig,
): void {
  const safe: SafeGatewayConfig = {
    openclawGatewayUrl: config.openclawGatewayUrl,
    openclawGatewayToken: "********",
    openclawSessionKey: config.openclawSessionKey,
    sttProvider: config.sttProvider,
    whisperx: {
      baseUrl: config.whisperx.baseUrl,
      model: config.whisperx.model,
    },
    openai: {
      apiKey: "********",
      model: config.openai.model,
    },
    customHttp: {
      url: config.customHttp.url,
      authHeader: "********",
    },
    server: config.server,
  };
  sendJson(res, 200, safe);
}

function handleHealthz(res: ServerResponse): void {
  sendJson(res, 200, { status: "ok", timestamp: new Date().toISOString() });
}

async function handleReadyz(
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const provider = deps.sttProviders.get(deps.config.sttProvider);
  const [sttHealth, clawHealth] = await Promise.all([
    provider?.healthCheck() ??
      Promise.resolve({ healthy: false, message: "No provider", latencyMs: 0 }),
    deps.openclawClient.healthCheck(),
  ]);

  const ready = sttHealth.healthy && clawHealth.healthy;
  sendJson(res, ready ? 200 : 503, {
    status: ready ? "ready" : "not_ready",
    checks: {
      stt: sttHealth,
      openclaw: clawHealth,
    },
    timestamp: new Date().toISOString(),
  });
}

// ── Helpers ──

function handleCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: readonly string[],
): boolean {
  const origin = req.headers["origin"];

  if (
    origin &&
    allowedOrigins.length > 0 &&
    allowedOrigins.includes(origin)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Language-Hint",
    );
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}

function handleError(
  res: ServerResponse,
  err: unknown,
  log: Logger,
): void {
  if (err instanceof UserError) {
    log.warn("User error", { code: err.code, message: err.message });
    sendJson(res, 400, {
      error: err.message,
      code: err.code,
    });
  } else if (err instanceof OperatorError) {
    log.error("Operator error", err.toJSON());
    sendJson(res, 502, {
      error: "An internal error occurred. Please try again.",
      code: err.code,
    });
  } else {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : String(err),
    });
    sendJson(res, 500, {
      error: "An unexpected error occurred.",
      code: ErrorCodes.INTERNAL_ERROR,
    });
  }
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        reject(
          new UserError(
            ErrorCodes.AUDIO_TOO_LARGE,
            `Request body too large. Max: ${(maxBytes / 1024 / 1024).toFixed(1)}MB`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", (err) => {
      reject(
        new OperatorError(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to read request body",
          err.message,
        ),
      );
    });
  });
}
