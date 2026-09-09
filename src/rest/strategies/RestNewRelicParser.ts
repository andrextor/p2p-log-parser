import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "@/common/strategies/LogExtractionStrategy";
import type { NormalizedLogData } from "@/types";
import { buildNormalizedLogData } from "@/utils/parsers";

/**
 * Claves que delatan un registro de log estructurado. Sin esta comprobación la
 * estrategia aceptaba *cualquier* objeto JSON y se apropiaba de líneas que no
 * eran logs.
 */
const RECORD_KEYS = ["context", "level", "level_name", "datetime", "timestamp"];

export class RestNewRelicParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (!this.looksLikeLogRecord(parsed)) return null;

      // Sin marca de tiempo utilizable se deja vacía: `ts` quedará NaN y el
      // evento se ordena al final. Inventar `Date.now()` falseaba la cronología.
      return buildNormalizedLogData(
        parsed,
        "NEW_RELIC_JSON",
        "",
        "REST API Log",
      );
    } catch {
      return null;
    }
  }

  getMetadata(): StrategyMetadata {
    return {
      name: "New Relic Parser",
      description: "Parses structured JSON log records from New Relic.",
      detectionRule:
        "JSON object with `message` plus one of context/level/level_name/datetime/timestamp, or with provider+action+operation (Atropos).",
    };
  }

  private looksLikeLogRecord(parsed: Record<string, unknown>): boolean {
    if ("message" in parsed && RECORD_KEYS.some((key) => key in parsed)) {
      return true;
    }
    // Contexto Atropos suelto, sin envoltorio de registro.
    return "provider" in parsed && "action" in parsed && "operation" in parsed;
  }
}
