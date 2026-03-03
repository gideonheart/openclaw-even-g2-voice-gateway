/**
 * Runtime OpenClaw client re-initialization on config change.
 *
 * Registers a ConfigStore listener that rebuilds the OpenClaw client
 * when openclawGatewayUrl or openclawGatewayToken changes. The deps
 * object is mutated in place so handlers see the new client immediately.
 */

import { OpenClawClient } from "@voice-gateway/openclaw-client";
import type { GatewayConfig } from "@voice-gateway/shared-types";
import type { Logger } from "@voice-gateway/logging";
import type { ConfigStore, ValidatedSettingsPatch } from "./config-store.js";

/** Subset of deps that holds the mutable OpenClaw client reference. */
interface OpenClawDeps {
  openclawClient: OpenClawClient;
}

/**
 * Register a config-change listener that rebuilds the OpenClaw client
 * when its connection config changes.
 *
 * On rebuild: disconnect old client, create new client with updated
 * config, swap reference on deps. Does NOT eagerly connect -- the
 * client's sendTranscript() handles lazy connection.
 */
export function registerOpenClawRebuilder(
  configStore: ConfigStore,
  deps: OpenClawDeps,
  logger: Logger,
): void {
  const log = logger.child({ component: "openclaw-rebuilder" });

  configStore.onChange((patch: ValidatedSettingsPatch, cfg: Readonly<GatewayConfig>) => {
    if (patch.openclawGatewayUrl === undefined && patch.openclawGatewayToken === undefined) {
      return; // Nothing relevant changed
    }

    // Disconnect old client (rejects pending turns gracefully)
    deps.openclawClient.disconnect();

    // Create and swap in the new client
    deps.openclawClient = new OpenClawClient(
      { gatewayUrl: cfg.openclawGatewayUrl, authToken: cfg.openclawGatewayToken },
      logger,
    );

    log.info("Rebuilt OpenClaw client after config change", {
      urlChanged: patch.openclawGatewayUrl !== undefined,
      tokenChanged: patch.openclawGatewayToken !== undefined,
    });
  });
}
