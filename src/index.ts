// Export the Core Engine
export { P2PParserEngine } from "./engine";
export type {
  P2PParserEngineConfig,
  ParseResult,
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

// Strategy and Metadata types
export type { StrategyMetadata } from "./common/strategies/LogExtractionStrategy";

// Mapper interfaces (for custom mappers)
export type { LogMapper } from "./common/mappers/BaseMapper";

// Utility functions (for custom mappers/strategies)
export {
  buildEventId,
  extractTimestamp,
  normalizePath,
  extractHttpFromMessage,
} from "./utils/mapper";
