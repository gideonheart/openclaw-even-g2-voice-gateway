/**
 * @voice-gateway/validation — runtime guards for external boundaries.
 */

export {
  validateAudioContentType,
  validateAudioSize,
  requireNonEmpty,
  validateUrl,
  validatePositiveInt,
  DEFAULT_MAX_AUDIO_BYTES,
} from "./guards.js";
