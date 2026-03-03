/**
 * Gateway API entry point.
 *
 * Wires all dependencies, runs startup pre-checks, opens the HTTP
 * server, and handles graceful shutdown on SIGTERM/SIGINT.
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
import { registerProviderRebuilder } from "./provider-rebuilder.js";
import { registerOpenClawRebuilder } from "./openclaw-rebuilder.js";

const log = rootLogger.child({ component: "startup" });

/** Build the initial set of STT providers from config. */
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

  // Initialize STT providers and OpenClaw client
  const sttProviders = buildSttProviders(config);
  const openclawClient = new OpenClawClient(
    { gatewayUrl: config.openclawGatewayUrl, authToken: config.openclawGatewayToken },
    rootLogger,
  );

  // Assemble server deps with readiness gate closed
  const deps: ServerDeps = {
    configStore,
    sttProviders,
    openclawClient,
    logger: rootLogger,
    ready: false,
  };

  // Register hot-reload listeners
  registerProviderRebuilder(configStore, sttProviders, rootLogger);
  registerOpenClawRebuilder(configStore, deps, rootLogger);

  const server = createGatewayServer(deps);

  // Startup pre-checks with bounded 30s timeout
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

  // Start listening -- readiness gate opens after port is bound
  const serverCfg = configStore.get().server;
  server.listen(serverCfg.port, serverCfg.host, () => {
    deps.ready = true;
    log.info("Gateway API started", {
      port: serverCfg.port,
      host: serverCfg.host,
      sttProvider: configStore.get().sttProvider,
    });
  });

  // Graceful shutdown
  const shutdown = (): void => {
    log.info("Shutting down");
    deps.ready = false;
    deps.openclawClient.disconnect();
    server.close(() => {
      log.info("Server closed");
      process.exit(0);
    });
    // Force exit after 10s if connections hang
    setTimeout(() => {
      log.warn("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log.error("Fatal startup error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
