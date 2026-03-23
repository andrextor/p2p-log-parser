import {
  type AppType,
  AppTypes,
  type LogEvent,
  type NormalizedLogData,
} from "@/types";
import { CheckoutMapper } from "./checkout/mappers/CheckoutMapper";
import { CheckoutAwsCsvParser } from "./checkout/strategies/CheckoutAwsCsvParser";
import { CheckoutInsightsParser } from "./checkout/strategies/CheckoutInsightsParser";
import { CheckoutLocalParser } from "./checkout/strategies/CheckoutLocalParser";
import type { LogMapper } from "./common/mappers/BaseMapper";
import { GenericMapper } from "./common/mappers/GenericMapper";
import type { LogExtractionStrategy } from "./common/strategies/LogExtractionStrategy";
import { RestNewRelicParser } from "./rest/strategies/RestNewRelicParser";

export interface ParseMetadata {
  totalSessions: number;
  sessionIds: string[];
  totalEvents: number;
}

export interface ParseResult {
  events: LogEvent[];
  groupedBySession?: Record<string, LogEvent[]>;
  metadata?: ParseMetadata;
  errors: { line: number; reason: string; content: string }[];
}

export class P2PParserEngine {
  private checkoutMapper = new CheckoutMapper();
  private genericMapper = new GenericMapper();

  private strategies: Record<AppType, LogExtractionStrategy[]> = {
    [AppTypes.CHECKOUT]: [
      new CheckoutInsightsParser(),
      new CheckoutAwsCsvParser(),
      new CheckoutLocalParser(),
    ],
    [AppTypes.REST]: [new RestNewRelicParser()],
    [AppTypes.MICROSITES]: [new CheckoutLocalParser()],
  };

  private mappers: Record<AppType, LogMapper> = {
    [AppTypes.CHECKOUT]: this.checkoutMapper,
    [AppTypes.REST]: this.genericMapper,
    [AppTypes.MICROSITES]: this.genericMapper,
  };

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
    const groupedBySession: Record<string, LogEvent[]> = {};
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

      if (!groupedBySession[sessionId]) {
        groupedBySession[sessionId] = [];
      }
      groupedBySession[sessionId].push(event);

      if (sessionId !== "unknown") {
        sessionIds.add(sessionId);
      }
    }

    let metadata: ParseMetadata | undefined;
    if (sessionIds.size > 1) {
      metadata = {
        totalSessions: sessionIds.size,
        sessionIds: Array.from(sessionIds),
        totalEvents: sortedEvents.length,
      };
    }

    return {
      events: sortedEvents,
      groupedBySession,
      metadata,
      errors,
    };
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
