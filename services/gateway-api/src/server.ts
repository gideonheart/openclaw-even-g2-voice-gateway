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
import { ConfigStore, validateSettingsPatch } from "./config-store.js";

// ── Rate Limiter ──

class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly maxPerMinute: number;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  check(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || now >= window.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + 60_000 });
      return true;
    }
    window.count++;
    return window.count <= this.maxPerMinute;
  }
}

export interface ServerDeps {
  readonly configStore: ConfigStore;
  readonly sttProviders: Map<string, SttProvider>;
  openclawClient: OpenClawClient;
  readonly logger: Logger;
  ready: boolean;
}

/** Create and return the HTTP server (not yet listening). */
export function createGatewayServer(deps: ServerDeps): Server {
  const log = deps.logger.child({ component: "http-server" });
  const rateLimiter = new RateLimiter(deps.configStore.get().server.rateLimitPerMinute);

  const server = createServer(async (req, res) => {
    const turnId = createTurnId();
    const requestLog = log.child({ turnId, method: req.method, url: req.url });

    try {
      // Readiness gate — always allow /healthz (liveness probe)
      if (!deps.ready && req.url !== "/healthz") {
        sendJson(res, 503, {
          error: "Gateway is starting up",
          code: ErrorCodes.NOT_READY,
        });
        return;
      }

      // CORS handling (SAFE-07: strict rejection for non-allowlisted origins)
      if (handleCors(req, res, deps.configStore.get().server.corsOrigins)) return;

      const url = req.url ?? "";
      const method = req.method ?? "GET";

      // Route
      if (method === "POST" && url === "/api/voice/turn") {
        // Rate limit the expensive voice turn endpoint
        const clientIp = req.socket.remoteAddress ?? "unknown";
        if (!rateLimiter.check(clientIp)) {
          sendJson(res, 429, { error: "Too many requests. Please wait.", code: ErrorCodes.RATE_LIMITED });
          return;
        }
        await handleVoiceTurn(req, res, deps, turnId, requestLog);
      } else if (method === "POST" && url === "/api/settings") {
        // SAFE-06: Rate-limit the settings endpoint
        const clientIp = req.socket.remoteAddress ?? "unknown";
        if (!rateLimiter.check(clientIp)) {
          sendJson(res, 429, { error: "Too many requests. Please wait.", code: ErrorCodes.RATE_LIMITED });
          return;
        }
        await handlePostSettings(req, res, deps, requestLog);
      } else if (method === "GET" && url === "/api/settings") {
        handleGetSettings(res, deps.configStore);
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
  const config = deps.configStore.get();

  // Read body
  const body = await readBody(req, config.server.maxAudioBytes);

  // Validate content type
  const contentType = validateAudioContentType(req.headers["content-type"]);

  // Validate size
  validateAudioSize(body.length, config.server.maxAudioBytes);

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
      sessionKey: config.openclawSessionKey,
      audio,
    },
    {
      sttProviders: deps.sttProviders,
      activeProviderId: config.sttProvider,
      openclawClient: deps.openclawClient,
      logger: deps.logger,
    },
  );

  sendJson(res, 200, result.reply);
}

/**
 * POST /api/settings — validate and apply runtime config patch.
 * SAFE-06: 64KB body size limit (settings are small JSON).
 * CONF-05: Returns safe config with secrets masked.
 */
async function handlePostSettings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  log: Logger,
): Promise<void> {
  // SAFE-06: Body size limit for settings (64KB max — settings are small JSON)
  const body = await readBody(req, 64 * 1024);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf-8"));
  } catch {
    throw new UserError(ErrorCodes.INVALID_CONFIG, "Request body is not valid JSON");
  }

  const patch = validateSettingsPatch(parsed);
  deps.configStore.update(patch);

  log.info("Settings updated successfully");

  // CONF-05: Return safe config, never raw
  sendJson(res, 200, deps.configStore.getSafe());
}

/**
 * GET /api/settings — return safe config with secrets masked.
 * Uses ConfigStore.getSafe() directly (no duplicated masking logic).
 */
function handleGetSettings(
  res: ServerResponse,
  configStore: ConfigStore,
): void {
  sendJson(res, 200, configStore.getSafe());
}

function handleHealthz(res: ServerResponse): void {
  sendJson(res, 200, { status: "ok", timestamp: new Date().toISOString() });
}

async function handleReadyz(
  res: ServerResponse,
  deps: ServerDeps,
): Promise<void> {
  const provider = deps.sttProviders.get(deps.configStore.get().sttProvider);
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

/**
 * CORS handler with strict origin rejection (SAFE-07).
 *
 * - If corsOrigins is non-empty and the request Origin is NOT in the allowlist:
 *   return 403 CORS_REJECTED (blocks the request entirely).
 * - If corsOrigins is empty: allow all origins (development mode).
 * - If origin matches allowlist: add CORS headers.
 * - Preflight (OPTIONS): 204 with CORS headers if allowed, 204 without if not
 *   (browser will block the actual request).
 *
 * Returns true if the response has been fully handled (caller should return).
 */
function handleCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: readonly string[],
): boolean {
  const origin = req.headers["origin"];

  if (allowedOrigins.length > 0) {
    // Strict mode: only allowlisted origins pass
    if (origin && allowedOrigins.includes(origin)) {
      // Origin is in the allowlist — add CORS headers
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Language-Hint",
      );
      res.setHeader("Access-Control-Max-Age", "86400");
    } else if (origin) {
      // Origin present but NOT in allowlist — reject
      if (req.method === "OPTIONS") {
        // Preflight for non-matching origin: 204 without CORS headers (browser blocks)
        res.writeHead(204);
        res.end();
        return true;
      }
      sendJson(res, 403, {
        error: "Origin not allowed",
        code: ErrorCodes.CORS_REJECTED,
      });
      return true;
    }
    // No origin header (e.g., server-to-server) — allow through without CORS headers
  } else if (origin) {
    // Development mode: allow all origins
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
    let rejected = false;

    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        rejected = true;
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
      if (!rejected) resolve(Buffer.concat(chunks));
    });

    req.on("error", (err) => {
      if (rejected) return;
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
