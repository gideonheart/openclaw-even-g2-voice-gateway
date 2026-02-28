/**
 * Gateway API — main entry point.
 *
 * Wires up all dependencies and starts the HTTP server.
 */

import { rootLogger } from "@voice-gateway/logging";
import { WhisperXProvider } from "@voice-gateway/stt-whisperx";
import { OpenAIProvider } from "@voice-gateway/stt-openai";
import { CustomHttpProvider } from "@voice-gateway/stt-custom-http";
import { OpenClawClient } from "@voice-gateway/openclaw-client";
import type { SttProvider } from "@voice-gateway/stt-contract";
import { ProviderIds } from "@voice-gateway/shared-types";
import { createGatewayServer } from "./server.js";
import { loadConfig } from "./config-loader.js";

const log = rootLogger.child({ component: "startup" });

async function main(): Promise<void> {
  log.info("Loading configuration");
  const config = loadConfig();

  // Initialize STT providers
  const sttProviders = new Map<string, SttProvider>();
  sttProviders.set(
    ProviderIds.WhisperX,
    new WhisperXProvider(config.whisperx, rootLogger),
  );
  sttProviders.set(
    ProviderIds.OpenAI,
    new OpenAIProvider(config.openai, rootLogger),
  );
  sttProviders.set(
    ProviderIds.Custom,
    new CustomHttpProvider(config.customHttp, rootLogger),
  );

  // Initialize OpenClaw client
  const openclawClient = new OpenClawClient(
    {
      gatewayUrl: config.openclawGatewayUrl,
      authToken: config.openclawGatewayToken,
    },
    rootLogger,
  );

  // Create server
  const server = createGatewayServer({
    config,
    sttProviders,
    openclawClient,
    logger: rootLogger,
  });

  // Start listening
  server.listen(config.server.port, config.server.host, () => {
    log.info("Gateway API started", {
      port: config.server.port,
      host: config.server.host,
      sttProvider: config.sttProvider,
    });
  });

  // Graceful shutdown
  const shutdown = (): void => {
    log.info("Shutting down");
    openclawClient.disconnect();
    server.close(() => {
      log.info("Server closed");
      process.exit(0);
    });
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
