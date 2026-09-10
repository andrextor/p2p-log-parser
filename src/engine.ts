import {
  type CheckoutFunnelSteps,
  CheckoutMetadataExtractor,
  type CheckoutParseMetadata,
  type CheckoutSessionMetadata,
} from "@/checkout/metadata/CheckoutMetadataExtractor";
import { CheckoutAwsCsvParser } from "@/checkout/strategies/CheckoutAwsCsvParser";
import { CheckoutGrafanaCsvParser } from "@/checkout/strategies/CheckoutGrafanaCsvParser";
import { CheckoutGrafanaJsonParser } from "@/checkout/strategies/CheckoutGrafanaJsonParser";
import { CheckoutInsightsParser } from "@/checkout/strategies/CheckoutInsightsParser";
import type {
  DomainMetadata,
  MetadataExtractor,
} from "@/common/metadata/MetadataExtractor";
import { LaravelLineParser } from "@/common/strategies/LaravelLineParser";
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
import { RestNewRelicCsvParser } from "./rest/strategies/RestNewRelicCsvParser";
import { RestNewRelicParser } from "./rest/strategies/RestNewRelicParser";
import { fromEpochMs, subMillis } from "./utils/time";

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
  CheckoutSessionMetadata,
  CheckoutFunnelSteps,
  RestParseMetadata,
  MicrositesParseMetadata,
};

export interface ParseResult {
  events: LogEvent[];
  groupedBySession?: Record<string, Record<string, LogEvent[]>>;
  metadata?: ParseMetadata;
  errors: { line: number; reason: string; content: string }[];
  stats: ParseStats;
}

/** Resumen del lote, para cabeceras y paneles sin recorrer los eventos. */
export interface ParseStats {
  total: number;
  byApp: Record<string, number>;
  byCategory: Record<string, number>;
  byLevel: Record<string, number>;
  /** Eventos cuyo `outcome` indica fallo. */
  errorCount: number;
  /**
   * Unidades de texto que ninguna estrategia convirtió en evento. Un número
   * alto suele significar que se eligió la aplicación equivocada, o que el
   * export trae un formato todavía no soportado. La fila de cabecera de un CSV
   * cuenta aquí: no produce evento, aunque sí se aprovecha para leer las
   * columnas por nombre.
   */
  unrecognized: number;
  timespan?: { from: string; to: string; ms: number };
}

function emptyStats(): ParseStats {
  return {
    total: 0,
    byApp: {},
    byCategory: {},
    byLevel: {},
    errorCount: 0,
    unrecognized: 0,
  };
}

function buildStats(events: LogEvent[], unrecognized: number): ParseStats {
  const stats = emptyStats();
  stats.total = events.length;
  stats.unrecognized = unrecognized;

  for (const event of events) {
    stats.byApp[event.appType] = (stats.byApp[event.appType] ?? 0) + 1;
    stats.byCategory[event.category] =
      (stats.byCategory[event.category] ?? 0) + 1;
    stats.byLevel[event.level] = (stats.byLevel[event.level] ?? 0) + 1;
    if (event.outcome?.isError) stats.errorCount++;
  }

  const dated = events.filter((e) => Number.isFinite(e.ts));
  const first = dated[0];
  const last = dated[dated.length - 1];
  if (first && last) {
    stats.timespan = {
      from: first.timestamp,
      to: last.timestamp,
      ms: last.ts - first.ts,
    };
  }

  return stats;
}

export class P2PParserEngine {
  private checkoutMapper: CheckoutMapper;
  private restMapper: RestMapper;
  private genericMapper: Record<AppType, GenericMapper>;

  private strategies: Record<AppType, LogExtractionStrategy[]> = {
    [AppTypes.CHECKOUT]: [
      new CheckoutGrafanaCsvParser(),
      new CheckoutGrafanaJsonParser(),
      new CheckoutInsightsParser(),
      new CheckoutAwsCsvParser(),
      new LaravelLineParser(),
    ],
    [AppTypes.REST]: [
      new RestNewRelicCsvParser(),
      new RestNewRelicParser(),
      new LaravelLineParser(),
    ],
    [AppTypes.MICROSITES]: [new LaravelLineParser()],
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

    this.genericMapper = {
      [AppTypes.CHECKOUT]: new GenericMapper(AppTypes.CHECKOUT),
      [AppTypes.REST]: new GenericMapper(AppTypes.REST),
      [AppTypes.MICROSITES]: new GenericMapper(AppTypes.MICROSITES),
    };

    this.mappers = {
      [AppTypes.CHECKOUT]: this.checkoutMapper,
      [AppTypes.REST]: this.restMapper,
      [AppTypes.MICROSITES]: this.genericMapper[AppTypes.MICROSITES],
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
    if (!raw) return { events: [], errors: [], stats: emptyStats() };

    const rows = this.sanitizeRaw(raw);
    const events: LogEvent[] = [];
    const errors: ParseResult["errors"] = [];
    let unrecognized = 0;

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
            let mapper: LogMapper = this.genericMapper[inferredApp];
            const preferredMapper = this.mappers[inferredApp];

            if (preferredMapper.canHandle(inferredData)) {
              mapper = preferredMapper;
            } else if (this.checkoutMapper.canHandle(inferredData)) {
              mapper = this.checkoutMapper;
            } else if (this.restMapper.canHandle(inferredData)) {
              mapper = this.restMapper;
            }

            events.push(mapper.map(inferredData, unit, index));
          } else {
            unrecognized++;
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
    const sortedEvents = events.sort((a, b) => {
      // Las marcas sin fecha válida se van al final en vez de romper el orden.
      const timeA = Number.isNaN(a.ts) ? Number.POSITIVE_INFINITY : a.ts;
      const timeB = Number.isNaN(b.ts) ? Number.POSITIVE_INFINITY : b.ts;

      if (timeA === timeB) {
        // Tie-break 1: Use microsecond precision if available
        const subA = subMillis(a.timestamp);
        const subB = subMillis(b.timestamp);
        if (subA !== subB) return subA - subB;

        // Tie-break 2: If timestamps are 100% identical, ensure Req comes before Res
        const isReqA =
          a.category.includes("REQ") || a.message.includes("HTTP Req");
        const isResA =
          a.category.includes("RES") || a.message.includes("HTTP Res");
        const isReqB =
          b.category.includes("REQ") || b.message.includes("HTTP Req");
        const isResB =
          b.category.includes("RES") || b.message.includes("HTTP Res");

        if (isReqA && isResB) return -1;
        if (isResA && isReqB) return 1;

        // Tie-break 3: Deterministic order by event ID
        return a.id.localeCompare(b.id);
      }
      return timeA - timeB;
    });

    this.pairExchanges(sortedEvents);

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

      // Group by minute: YYYY-MM-DD HH:mm
      const executionTime = Number.isNaN(event.ts)
        ? "unknown_time"
        : fromEpochMs(event.ts).substring(0, 16).replace("T", " ");

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
      stats: buildStats(sortedEvents, unrecognized),
    };
  }

  /**
   * Une cada petición con su respuesta y calcula la duración del intercambio.
   *
   * Una sola pasada sobre los eventos ya ordenados. Las peticiones abiertas se
   * guardan en cola por `pairKey` y se consumen en orden de llegada, de modo
   * que un reintento sobre la misma traza empareja con su propia respuesta y no
   * con la del intento anterior. Las que se quedan sin respuesta se marcan
   * `PENDING`: puede ser un fallo, o simplemente que el export está recortado.
   */
  private pairExchanges(events: LogEvent[]): void {
    const open = new Map<string, LogEvent[]>();

    for (const event of events) {
      if (!event.pairKey) continue;

      if (event.pairRole === "request") {
        const queue = open.get(event.pairKey);
        if (queue) queue.push(event);
        else open.set(event.pairKey, [event]);
        continue;
      }

      if (event.pairRole !== "response") continue;

      const request = open.get(event.pairKey)?.shift();
      if (!request) continue;

      const duration = event.ts - request.ts;
      if (Number.isFinite(duration) && duration >= 0) {
        request.durationMs = duration;
        event.durationMs = duration;
      }
    }

    for (const queue of open.values()) {
      for (const request of queue) {
        request.outcome = {
          isError: false,
          ...request.outcome,
          status: "PENDING",
        };
      }
    }
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
