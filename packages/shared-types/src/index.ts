/**
 * @voice-gateway/shared-types — canonical domain types for the voice gateway.
 */

export {
  type Brand,
  type TurnId,
  type SessionKey,
  type ProviderId,
  createTurnId,
  createSessionKey,
  createProviderId,
  ProviderIds,
} from "./branded.js";

export {
  GatewayError,
  UserError,
  OperatorError,
  ErrorCodes,
  type ErrorCode,
} from "./errors.js";

export type {
  AudioContentType,
  AudioPayload,
  SttResult,
  OpenClawOutbound,
  OpenClawInbound,
  ResponseSegment,
  TurnTiming,
  ProviderMeta,
  GatewayReply,
  VoiceTurnRequest,
  VoiceTurnResult,
} from "./voice-turn.js";

export type {
  GatewayConfig,
  WhisperXConfig,
  OpenAIConfig,
  CustomHttpConfig,
  ResponseMapping,
  ServerConfig,
  SafeGatewayConfig,
} from "./config.js";
