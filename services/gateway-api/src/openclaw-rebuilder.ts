/**
 * Runtime OpenClaw client re-initialization on config change.
 *
 * Registers a ConfigStore listener that rebuilds the OpenClaw client
 * when openclawGatewayUrl or openclawGatewayToken changes. The deps
 * object is mutated in place so all handlers automatically see the
 * updated client on the next request.
 */

import { OpenClawClient } from "@voice-gateway/openclaw-client";
import type { GatewayConfig } from "@voice-gateway/shared-types";
import type { Logger } from "@voice-gateway/logging";
import type { ConfigStore, ValidatedSettingsPatch } from "./config-store.js";

interface OpenClawDeps {
  openclawClient: OpenClawClient;
}

/**
 * Registers a ConfigStore listener that rebuilds the OpenClaw client
 * when openclawGatewayUrl or openclawGatewayToken changes.
 *
 * On rebuild: (1) disconnects old client (rejects pending turns),
 * (2) creates new client with updated config, (3) swaps the reference
 * on deps so the next request uses the new client.
 *
 * Does NOT eagerly connect -- sendTranscript() handles lazy connection.
 */
export function registerOpenClawRebuilder(
  configStore: ConfigStore,
  deps: OpenClawDeps,
  logger: Logger,
): void {
  const rebuildLog = logger.child({ component: "openclaw-rebuilder" });

  configStore.onChange((patch: ValidatedSettingsPatch, newConfig: Readonly<GatewayConfig>) => {
    if (patch.openclawGatewayUrl !== undefined || patch.openclawGatewayToken !== undefined) {
      // Disconnect old client -- this rejects pending turns gracefully
      deps.openclawClient.disconnect();

      // Create new client with updated config
      const newClient = new OpenClawClient(
        {
          gatewayUrl: newConfig.openclawGatewayUrl,
          authToken: newConfig.openclawGatewayToken,
        },
        logger,
      );

      // Swap the reference so all handlers see the new client
      deps.openclawClient = newClient;

      rebuildLog.info("Rebuilt OpenClaw client after config change", {
        urlChanged: patch.openclawGatewayUrl !== undefined,
        tokenChanged: patch.openclawGatewayToken !== undefined,
      });
    }
  });
}
