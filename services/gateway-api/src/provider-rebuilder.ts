/**
 * Runtime STT provider re-initialization on config change.
 *
 * Registers a ConfigStore listener that rebuilds STT provider instances
 * when their configuration section changes. The Map is mutated in place
 * so all handlers automatically see updated providers on the next request.
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
 * Register a config-change listener that rebuilds STT providers whose
 * config section was included in the patch.
 */
export function registerProviderRebuilder(
  configStore: ConfigStore,
  sttProviders: Map<string, SttProvider>,
  logger: Logger,
): void {
  const log = logger.child({ component: "provider-rebuilder" });

  configStore.onChange((patch: ValidatedSettingsPatch, cfg: Readonly<GatewayConfig>) => {
    if (patch.whisperx !== undefined) {
      sttProviders.set(ProviderIds.WhisperX, new WhisperXProvider(cfg.whisperx, logger));
      log.info("Rebuilt WhisperX provider after config change");
    }

    if (patch.openai !== undefined) {
      sttProviders.set(ProviderIds.OpenAI, new OpenAIProvider(cfg.openai, logger));
      log.info("Rebuilt OpenAI provider after config change");
    }

    if (patch.customHttp !== undefined) {
      sttProviders.set(ProviderIds.Custom, new CustomHttpProvider(cfg.customHttp, logger));
      log.info("Rebuilt Custom HTTP provider after config change");
    }
  });
}
