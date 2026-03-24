import {
  CheckoutMetadataExtractor,
  type CheckoutParseMetadata,
} from "@/checkout/metadata/CheckoutMetadataExtractor";
import { CheckoutAwsCsvParser } from "@/checkout/strategies/CheckoutAwsCsvParser";
import { CheckoutInsightsParser } from "@/checkout/strategies/CheckoutInsightsParser";
import { CheckoutLocalParser } from "@/checkout/strategies/CheckoutLocalParser";
import { CheckoutNewRelicParser } from "@/checkout/strategies/CheckoutNewRelicParser";
import type {
  DomainMetadata,
  MetadataExtractor,
} from "@/common/metadata/MetadataExtractor";
import type { StrategyMetadata } from "@/common/strategies/LogExtractionStrategy";
import {
  MicrositesMetadataExtractor,
  type MicrositesParseMetadata,
} from "@/microsites/metadata/MicrositesMetadataExtractor";
import {
  RestMetadataExtractor,
  type RestParseMetadata,
} from "@/rest/metadata/RestMetadataExtractor";
import {
  type AppType,
  AppTypes,
  type LogEvent,
  type NormalizedLogData,
} from "@/types";
import type { CheckoutActionDetail } from "./checkout/constants/CheckoutActions";
import { mergeCheckoutActions } from "./checkout/constants/CheckoutActions";
import { CheckoutMapper } from "./checkout/mappers/CheckoutMapper";
import type { LogMapper } from "./common/mappers/BaseMapper";
import { GenericMapper } from "./common/mappers/GenericMapper";
import type { LogExtractionStrategy } from "./common/strategies/LogExtractionStrategy";
import type { RestActionDetail } from "./rest/constants/RestActions";
import { mergeRestActions } from "./rest/constants/RestActions";
import { RestMapper } from "./rest/mappers/RestMapper";
import { RestNewRelicParser } from "./rest/strategies/RestNewRelicParser";

export interface P2PParserEngineConfig {
  customCheckoutActions?: Record<string, CheckoutActionDetail>;
  customRestActions?: Record<string, RestActionDetail>;
}

export type ParseMetadata =
  | CheckoutParseMetadata
  | RestParseMetadata
  | MicrositesParseMetadata;

export type {
  DomainMetadata,
  CheckoutParseMetadata,
  RestParseMetadata,
  MicrositesParseMetadata,
};

export interface ParseResult {
  events: LogEvent[];
  groupedBySession?: Record<string, Record<string, LogEvent[]>>;
  metadata?: ParseMetadata;
  errors: { line: number; reason: string; content: string }[];
}

export class P2PParserEngine {
  private checkoutMapper: CheckoutMapper;
  private restMapper: RestMapper;
  private genericMapper = new GenericMapper();

  private strategies: Record<AppType, LogExtractionStrategy[]> = {
    [AppTypes.CHECKOUT]: [
      new CheckoutNewRelicParser(),
      new CheckoutInsightsParser(),
      new CheckoutAwsCsvParser(),
      new CheckoutLocalParser(),
    ],
    [AppTypes.REST]: [new RestNewRelicParser()],
    [AppTypes.MICROSITES]: [new CheckoutLocalParser()],
  };

  private mappers: Record<AppType, LogMapper>;
  private metadataExtractors: Record<AppType, MetadataExtractor>;

  constructor(config?: P2PParserEngineConfig) {
    const checkoutActions = config?.customCheckoutActions
      ? mergeCheckoutActions(config.customCheckoutActions)
      : undefined;

    const restActions = config?.customRestActions
      ? mergeRestActions(config.customRestActions)
      : undefined;

    this.checkoutMapper = new CheckoutMapper(checkoutActions);
    this.restMapper = new RestMapper(restActions);

    this.mappers = {
      [AppTypes.CHECKOUT]: this.checkoutMapper,
      [AppTypes.REST]: this.restMapper,
      [AppTypes.MICROSITES]: this.genericMapper,
    };

    this.metadataExtractors = {
      [AppTypes.CHECKOUT]: new CheckoutMetadataExtractor(),
      [AppTypes.REST]: new RestMetadataExtractor(),
      [AppTypes.MICROSITES]: new MicrositesMetadataExtractor(),
    };
  }

  /**
   * Orchestrates the parsing of a raw multi-line string.
   */
  public parse(
    raw: string,
    activeType: AppType | "ALL" = AppTypes.CHECKOUT,
  ): ParseResult {
    if (!raw) return { events: [], errors: [] };

    const rows = this.sanitizeRaw(raw);
    const events: LogEvent[] = [];
    const errors: ParseResult["errors"] = [];

    const allApps = Object.values(AppTypes) as AppType[];
    const appPriority =
      activeType === "ALL"
        ? [AppTypes.REST, AppTypes.CHECKOUT, AppTypes.MICROSITES]
        : [activeType as AppType, ...allApps.filter((t) => t !== activeType)];

    rows.forEach((line, index) => {
      try {
        const units = this.splitLogicalUnits(line);

        for (const unit of units) {
          let unitParsed = false;
          let inferredData: NormalizedLogData | null = null;
          let inferredApp: AppType | null = null;

          // 1. Detection
          for (const appType of appPriority) {
            const strats = this.strategies[appType] || [];
            for (const strategy of strats) {
              const parsed = strategy.parse(unit);
              if (parsed) {
                inferredData = parsed;
                inferredApp = appType;
                unitParsed = true;
                break;
              }
            }
            if (unitParsed) break;
          }

          // 2. Mapping
          if (inferredData && inferredApp) {
            let mapper = this.genericMapper as LogMapper;
            const preferredMapper = this.mappers[inferredApp];

            if (preferredMapper.canHandle(inferredData)) {
              mapper = preferredMapper;
            } else if (this.checkoutMapper.canHandle(inferredData)) {
              mapper = this.checkoutMapper;
            } else if (this.restMapper.canHandle(inferredData)) {
              mapper = this.restMapper;
            }

            events.push(mapper.map(inferredData, unit, index));
          }
        }
      } catch (err) {
        errors.push({
          line: index + 1,
          reason: err instanceof Error ? err.message : "Unknown parsing error",
          content: line.slice(0, 80),
        });
      }
    });

    // 3. Chronological sorting guarantees
    const sortedEvents = events.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    // 4. Session grouping and metadata
    const groupedBySession: Record<string, Record<string, LogEvent[]>> = {};
    const sessionIds = new Set<string>();

    for (const event of sortedEvents) {
      let sessionId = "unknown";
      if (
        event.details &&
        "sessionId" in event.details &&
        event.details.sessionId
      ) {
        sessionId = String(event.details.sessionId);
      }

      const eventDate = new Date(event.timestamp);
      // Group by minute: YYYY-MM-DD HH:mm
      const executionTime = Number.isNaN(eventDate.getTime())
        ? "unknown_time"
        : eventDate.toISOString().substring(0, 16).replace("T", " ");

      if (!groupedBySession[sessionId]) {
        groupedBySession[sessionId] = {};
      }
      if (!groupedBySession[sessionId][executionTime]) {
        groupedBySession[sessionId][executionTime] = [];
      }
      groupedBySession[sessionId][executionTime].push(event);

      if (sessionId !== "unknown") {
        sessionIds.add(sessionId);
      }
    }

    const metadata = this.extractMetadata(sortedEvents, activeType);

    return {
      events: sortedEvents,
      groupedBySession,
      metadata,
      errors,
    };
  }

  private extractMetadata(
    events: LogEvent[],
    activeType: AppType | "ALL",
  ): ParseMetadata | undefined {
    if (activeType === "ALL") {
      const priority: AppType[] = [
        AppTypes.CHECKOUT,
        AppTypes.REST,
        AppTypes.MICROSITES,
      ];
      for (const appType of priority) {
        const result = this.metadataExtractors[appType].extract(events);
        if (result) return result as ParseMetadata;
      }
      return undefined;
    }

    const extractor = this.metadataExtractors[activeType];
    return extractor
      ? (extractor.extract(events) as ParseMetadata | undefined)
      : undefined;
  }

  /**
   * Returns a map of supported log formats per application type.
   * Useful for integrators to understand detection rules.
   */
  public getSupportedFormats(): Record<AppType, StrategyMetadata[]> {
    const formats: Record<string, StrategyMetadata[]> = {};
    for (const [type, strategies] of Object.entries(this.strategies)) {
      formats[type] = strategies.map((s) => s.getMetadata());
    }
    return formats as Record<AppType, StrategyMetadata[]>;
  }

  private splitLogicalUnits(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          return arr.map((obj) => JSON.stringify(obj));
        }
      } catch {
        return [line];
      }
    }

    return [line];
  }

  private sanitizeRaw(raw: string): string[] {
    return raw
      .trim()
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => {
        return (
          l &&
          l !== '"' &&
          !l.startsWith("@timestamp") &&
          !l.includes("fields.message")
        );
      });
  }
}
