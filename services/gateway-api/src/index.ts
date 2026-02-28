/**
 * Gateway API — main entry point.
 *
 * Wires up all dependencies and starts the HTTP server.
 * Creates ConfigStore from initial config, runs startup pre-checks,
 * then opens the readiness gate after server is listening.
 */

import { rootLogger } from "@voice-gateway/logging";
import { WhisperXProvider } from "@voice-gateway/stt-whisperx";
import { OpenAIProvider } from "@voice-gateway/stt-openai";
import { CustomHttpProvider } from "@voice-gateway/stt-custom-http";
import { OpenClawClient } from "@voice-gateway/openclaw-client";
import type { SttProvider } from "@voice-gateway/stt-contract";
import type { GatewayConfig } from "@voice-gateway/shared-types";
import { ProviderIds } from "@voice-gateway/shared-types";
import { createGatewayServer, type ServerDeps } from "./server.js";
import { loadConfig } from "./config-loader.js";
import { ConfigStore } from "./config-store.js";

const log = rootLogger.child({ component: "startup" });

// TODO(phase-3): When provider-specific config changes (e.g., whisperx.baseUrl),
// reconstruct the affected provider instance. For Phase 2, provider selection
// (which provider is active) works immediately because the orchestrator reads
// config per-request, but provider-specific settings (URLs, models) require restart.

function buildSttProviders(cfg: GatewayConfig): Map<string, SttProvider> {
  const providers = new Map<string, SttProvider>();
  providers.set(ProviderIds.WhisperX, new WhisperXProvider(cfg.whisperx, rootLogger));
  providers.set(ProviderIds.OpenAI, new OpenAIProvider(cfg.openai, rootLogger));
  providers.set(ProviderIds.Custom, new CustomHttpProvider(cfg.customHttp, rootLogger));
  return providers;
}

async function main(): Promise<void> {
  log.info("Loading configuration");
  const config = loadConfig();
  const configStore = new ConfigStore(config);

  // Initialize STT providers
  const sttProviders = buildSttProviders(config);

  // Initialize OpenClaw client
  const openclawClient = new OpenClawClient(
    {
      gatewayUrl: config.openclawGatewayUrl,
      authToken: config.openclawGatewayToken,
    },
    rootLogger,
  );

  // Create server with readiness gate closed
  const deps: ServerDeps = {
    configStore,
    sttProviders,
    openclawClient,
    logger: rootLogger,
    ready: false,
  };

  const server = createGatewayServer(deps);

  // OPS-03: Startup pre-checks with bounded timeout
  const startupTimeout = setTimeout(() => {
    log.error("Startup timed out after 30s");
    process.exit(1);
  }, 30_000);

  log.info("Running startup pre-checks");
  const activeProvider = sttProviders.get(config.sttProvider);
  const [sttHealth, clawHealth] = await Promise.all([
    activeProvider?.healthCheck() ??
      Promise.resolve({ healthy: false, message: "No active provider configured", latencyMs: 0 }),
    openclawClient.healthCheck(),
  ]);

  clearTimeout(startupTimeout);

  if (!sttHealth.healthy || !clawHealth.healthy) {
    log.error("Startup pre-check failed", { stt: sttHealth, openclaw: clawHealth });
    process.exit(1);
  }
  log.info("Startup pre-checks passed", { stt: sttHealth, openclaw: clawHealth });

  // Start listening — readiness gate opens after port is bound
  const serverConfig = configStore.get().server;
  server.listen(serverConfig.port, serverConfig.host, () => {
    deps.ready = true;
    log.info("Gateway API started", {
      port: serverConfig.port,
      host: serverConfig.host,
      sttProvider: configStore.get().sttProvider,
    });
  });

  // Graceful shutdown with bounded timeout
  const shutdown = (): void => {
    log.info("Shutting down");
    deps.ready = false;
    openclawClient.disconnect();
    server.close(() => {
      log.info("Server closed");
      process.exit(0);
    });
    // Force exit after 10 seconds if connections hang
    setTimeout(() => {
      log.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error("Fatal startup error", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
