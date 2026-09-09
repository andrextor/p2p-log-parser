// Export the Core Engine
export { P2PParserEngine } from "./engine";
export type {
  P2PParserEngineConfig,
  ParseResult,
  ParseStats,
  ParseMetadata,
  DomainMetadata,
  CheckoutParseMetadata,
  RestParseMetadata,
  MicrositesParseMetadata,
} from "./engine";

// Export domain types commonly used by clients
export * from "./types";

// Export action detail types + merge helpers for custom action maps
export type { CheckoutActionDetail } from "./checkout/constants/CheckoutActions";
export { mergeCheckoutActions } from "./checkout/constants/CheckoutActions";
export type { RestActionDetail } from "./rest/constants/RestActions";
export { mergeRestActions } from "./rest/constants/RestActions";
export {
  REST_OPERATION_LABELS,
  CHANNEL_PROVIDERS,
  describeOperation,
  isRequestAction,
} from "./rest/constants/RestOperations";
export type {
  RestErrorSummary,
  RestExchangeSummary,
} from "./rest/metadata/RestMetadataExtractor";

// Strategy and Metadata types
export type { StrategyMetadata } from "./common/strategies/LogExtractionStrategy";

// Mapper interfaces (for custom mappers)
export type { LogMapper } from "./common/mappers/BaseMapper";

// Strategies reusable by integrators
export { LaravelLineParser } from "./common/strategies/LaravelLineParser";
export { RestNewRelicCsvParser } from "./rest/strategies/RestNewRelicCsvParser";

// Utility functions (for custom mappers/strategies)
export {
  buildEventBase,
  buildEventId,
  extractTimestamp,
  normalizePath,
  extractHttpFromMessage,
} from "./utils/mapper";
export { resolveOutcome } from "./common/outcome";
export { matchEvent } from "./utils/match";
export { buildCorrelation } from "./utils/correlation";
export { toEpochMs, DEFAULT_TZ_OFFSET } from "./utils/time";
