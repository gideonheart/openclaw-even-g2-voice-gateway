/**
 * HTTP server with all API endpoints.
 *
 * Routes:
 *   POST /api/voice/turn  -- execute a voice turn (audio -> response)
 *   POST /api/text/turn   -- execute a text turn  (text  -> response, no STT)
 *   POST /api/settings    -- validate and apply runtime config patch
 *   GET  /api/settings    -- return safe config (secrets masked)
 *   GET  /healthz         -- liveness probe
 *   GET  /readyz          -- readiness probe (dependency health)
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { writeFile, mkdir } from "node:fs/promises";
import type {
  GatewayConfig,
  ProviderId,
  AudioPayload,
} from "@voice-gateway/shared-types";
import {
  createTurnId,
  UserError,
  OperatorError,
  ErrorCodes,
} from "@voice-gateway/shared-types";
import type { SttProvider } from "@voice-gateway/stt-contract";
import type { OpenClawClient } from "@voice-gateway/openclaw-client";
import { validateAudioContentType, validateAudioSize } from "@voice-gateway/validation";
import { executeVoiceTurn, executeTextTurn } from "./orchestrator.js";
import type { Logger } from "@voice-gateway/logging";
import { ConfigStore, validateSettingsPatch } from "./config-store.js";

// -- Rate Limiter --

export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly configStore: ConfigStore;
  private readonly pruneHandle: ReturnType<typeof setInterval>;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
    this.pruneHandle = setInterval(() => this.prune(), 60_000);
    this.pruneHandle.unref();
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  check(key: string): boolean {
    const now = Date.now();
    const maxPerMinute = this.configStore.get().server.rateLimitPerMinute;
    const window = this.windows.get(key);

    if (!window || now >= window.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + 60_000 });
    } else {
      window.count++;
      if (window.count > maxPerMinute) return false;
    }

    // Hard cap: eagerly prune if map grows beyond 10k entries
    if (this.windows.size > 10_000) this.prune();

    return true;
  }

  /** Remove expired windows to prevent unbounded memory growth. */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) this.windows.delete(key);
    }
  }

  /** Clean up the prune interval (for test teardown and graceful shutdown). */
  destroy(): void {
    clearInterval(this.pruneHandle);
  }
}

// -- Server dependencies --

export interface ServerDeps {
  readonly configStore: ConfigStore;
  readonly sttProviders: Map<string, SttProvider>;
  openclawClient: OpenClawClient;
  readonly logger: Logger;
  ready: boolean;
}

// -- Body size constant --

/** Maximum body size for text turn / settings requests (64 KB). */
const MAX_TEXT_BODY_BYTES = 64 * 1024;

// -- Server factory --

/** Create and return the HTTP server (not yet listening). */
export function createGatewayServer(deps: ServerDeps): Server {
  const log = deps.logger.child({ component: "http-server" });
  const rateLimiter = new RateLimiter(deps.configStore);

  return createServer(async (req, res) => {
    const turnId = createTurnId();
    const requestLog = log.child({ turnId, method: req.method, url: req.url });

    try {
      // Readiness gate -- always allow /healthz (liveness probe)
      if (!deps.ready && req.url !== "/healthz") {
        return sendJson(res, 503, { error: "Gateway is starting up", code: ErrorCodes.NOT_READY });
      }

      // CORS handling
      const serverCfg = deps.configStore.get().server;
      if (handleCors(req, res, serverCfg.corsOrigins, serverCfg.allowNullOrigin)) return;

      const url = req.url ?? "";
      const method = req.method ?? "GET";

      // -- Routing --

      if (method === "GET" && url === "/healthz") {
        return handleHealthz(res);
      }

      if (method === "GET" && url === "/readyz") {
        return await handleReadyz(res, deps);
      }

      if (method === "GET" && url === "/api/settings") {
        return sendJson(res, 200, deps.configStore.getSafe());
      }

      // POST routes share a rate-limit gate
      if (method === "POST" && (url === "/api/voice/turn" || url === "/api/text/turn" || url === "/api/settings")) {
        const clientIp = req.socket.remoteAddress ?? "unknown";
        if (!rateLimiter.check(clientIp)) {
          return sendJson(res, 429, { error: "Too many requests. Please wait.", code: ErrorCodes.RATE_LIMITED });
        }

        if (url === "/api/voice/turn") return await handleVoiceTurn(req, res, deps, turnId, requestLog);
        if (url === "/api/text/turn") return await handleTextTurn(req, res, deps, turnId, requestLog);
        if (url === "/api/settings") return await handlePostSettings(req, res, deps, requestLog);
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      handleError(res, err, requestLog);
    }
  });
}

// -- Route handlers --

async function handleVoiceTurn(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  turnId: ReturnType<typeof createTurnId>,
  log: Logger,
): Promise<void> {
  const config = deps.configStore.get();
  const body = await readBody(req, config.server.maxAudioBytes);
  const contentType = validateAudioContentType(req.headers["content-type"]);
  validateAudioSize(body.length, config.server.maxAudioBytes);

  const audio: AudioPayload = {
    data: body,
    contentType,
    languageHint: req.headers["x-language-hint"] as string | undefined,
  };

  log.info("Voice turn request received", { audioBytes: body.length, contentType });

  // DEBUG: save audio to disk so we can listen to what the client sends
  const ext = contentType === "audio/webm" ? "webm" : "wav";
  const debugDir = "/home/forge/openclaw-even-g2-voice-gateway/audio-debug";
  const debugPath = `${debugDir}/${turnId}-${Date.now()}.${ext}`;
  try {
    await mkdir(debugDir, { recursive: true });
    await writeFile(debugPath, body);
    log.info("DEBUG audio saved", { path: debugPath, bytes: body.length });
  } catch (e) {
    log.warn("DEBUG audio save failed", { error: String(e) });
  }

  const result = await executeVoiceTurn(
    { turnId, sessionKey: config.openclawSessionKey, audio },
    {
      sttProviders: deps.sttProviders,
      activeProviderId: config.sttProvider,
      openclawClient: deps.openclawClient,
      logger: deps.logger,
    },
  );

  sendJson(res, 200, result.reply);
}

async function handleTextTurn(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  turnId: ReturnType<typeof createTurnId>,
  log: Logger,
): Promise<void> {
  const config = deps.configStore.get();

  // Validate content type
  const ct = req.headers["content-type"];
  if (!ct || !ct.startsWith("application/json")) {
    throw new UserError(ErrorCodes.INVALID_CONTENT_TYPE, "Content-Type must be application/json");
  }

  const body = await readBody(req, MAX_TEXT_BODY_BYTES);
  const parsed = parseJson(body);

  // Validate payload shape
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as Record<string, unknown>)["text"] !== "string") {
    throw new UserError(ErrorCodes.INVALID_CONFIG, 'Request body must contain a "text" field (string)');
  }

  const text = ((parsed as Record<string, unknown>)["text"] as string).trim();
  if (text.length === 0) {
    throw new UserError(ErrorCodes.INVALID_CONFIG, "Text must not be empty");
  }

  log.info("Text turn request received", { textLength: text.length });

  const result = await executeTextTurn(
    { turnId, sessionKey: config.openclawSessionKey, text },
    { openclawClient: deps.openclawClient, logger: deps.logger },
  );

  sendJson(res, 200, result.reply);
}

async function handlePostSettings(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ServerDeps,
  log: Logger,
): Promise<void> {
  const body = await readBody(req, MAX_TEXT_BODY_BYTES);
  const parsed = parseJson(body);
  const patch = validateSettingsPatch(parsed);
  deps.configStore.update(patch);

  log.info("Settings updated successfully");
  sendJson(res, 200, deps.configStore.getSafe());
}

function handleHealthz(res: ServerResponse): void {
  sendJson(res, 200, { status: "ok", timestamp: new Date().toISOString() });
}

async function handleReadyz(res: ServerResponse, deps: ServerDeps): Promise<void> {
  const provider = deps.sttProviders.get(deps.configStore.get().sttProvider);
  const [sttHealth, clawHealth] = await Promise.all([
    provider?.healthCheck() ?? Promise.resolve({ healthy: false, message: "No provider", latencyMs: 0 }),
    deps.openclawClient.healthCheck(),
  ]);

  const ready = sttHealth.healthy && clawHealth.healthy;
  sendJson(res, ready ? 200 : 503, {
    status: ready ? "ready" : "not_ready",
    checks: { stt: sttHealth, openclaw: clawHealth },
    timestamp: new Date().toISOString(),
  });
}

// -- CORS handling --

/**
 * Strict CORS handler.
 *
 * Returns true if the response has been fully handled (caller should return).
 */
function handleCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigins: readonly string[],
  allowNullOrigin: boolean,
): boolean {
  const origin = req.headers["origin"];
  const corsHeaders = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Language-Hint, X-Session-Key",
    "Access-Control-Max-Age": "86400",
  };

  // WebView/file:// origins send literal "null" per RFC 6454
  if (origin === "null" && allowNullOrigin) {
    res.setHeader("Access-Control-Allow-Origin", "null");
    for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }
    return false;
  }

  if (allowedOrigins.length > 0) {
    if (origin && allowedOrigins.includes(origin)) {
      // Allowed origin -- set CORS headers
      res.setHeader("Access-Control-Allow-Origin", origin);
      for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
    } else if (origin) {
      // Origin present but not in allowlist -- reject
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }
      sendJson(res, 403, { error: "Origin not allowed", code: ErrorCodes.CORS_REJECTED });
      return true;
    }
    // No origin header (server-to-server) -- pass through without CORS headers
  } else if (origin) {
    // Development mode: allow all origins
    res.setHeader("Access-Control-Allow-Origin", origin);
    for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);
  }

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }
  return false;
}

// -- Error handling --

function handleError(res: ServerResponse, err: unknown, log: Logger): void {
  if (err instanceof UserError) {
    log.warn("User error", { code: err.code, message: err.message });
    sendJson(res, 400, { error: err.message, code: err.code });
  } else if (err instanceof OperatorError) {
    log.error("Operator error", err.toJSON());
    sendJson(res, 502, { error: "An internal error occurred. Please try again.", code: err.code });
  } else {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : String(err) });
    sendJson(res, 500, { error: "An unexpected error occurred.", code: ErrorCodes.INTERNAL_ERROR });
  }
}

// -- Utilities --

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf-8"));
  } catch {
    throw new UserError(ErrorCodes.INVALID_CONFIG, "Request body is not valid JSON");
  }
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
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

    req.on("end", () => { if (!rejected) resolve(Buffer.concat(chunks)); });

    req.on("error", (err) => {
      if (rejected) return;
      reject(new OperatorError(ErrorCodes.INTERNAL_ERROR, "Failed to read request body", err.message));
    });
  });
}
