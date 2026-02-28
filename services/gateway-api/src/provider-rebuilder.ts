/**
 * PIPE-07: Runtime STT provider re-initialization on config change.
 *
 * Registers a ConfigStore listener that rebuilds STT provider instances
 * when their config section changes. The Map is mutated in place so all
 * handlers automatically see updated providers on the next request.
 */

import { WhisperXProvider } from "@voice-gateway/stt-whisperx";
import { OpenAIProvider } from "@voice-gateway/stt-openai";
import { CustomHttpProvider } from "@voice-gateway/stt-custom-http";
import type { SttProvider } from "@voice-gateway/stt-contract";
import type { GatewayConfig } from "@voice-gateway/shared-types";
import { ProviderIds } from "@voice-gateway/shared-types";
import type { Logger } from "@voice-gateway/logging";
import type { ConfigStore, ValidatedSettingsPatch } from "./config-store.js";

/**
 * Registers a ConfigStore listener that rebuilds STT provider instances
 * when their config section changes. The Map is mutated in place so all
 * handlers automatically see updated providers on the next request.
 */
export function registerProviderRebuilder(
  configStore: ConfigStore,
  sttProviders: Map<string, SttProvider>,
  logger: Logger,
): void {
  const rebuildLog = logger.child({ component: "provider-rebuilder" });

  configStore.onChange((patch: ValidatedSettingsPatch, newConfig: Readonly<GatewayConfig>) => {
    if (patch.whisperx !== undefined) {
      sttProviders.set(ProviderIds.WhisperX, new WhisperXProvider(newConfig.whisperx, logger));
      rebuildLog.info("Rebuilt WhisperX provider after config change");
    }
    if (patch.openai !== undefined) {
      sttProviders.set(ProviderIds.OpenAI, new OpenAIProvider(newConfig.openai, logger));
      rebuildLog.info("Rebuilt OpenAI provider after config change");
    }
    if (patch.customHttp !== undefined) {
      sttProviders.set(ProviderIds.Custom, new CustomHttpProvider(newConfig.customHttp, logger));
      rebuildLog.info("Rebuilt Custom HTTP provider after config change");
    }
  });
}
