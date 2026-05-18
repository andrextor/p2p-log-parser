import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "@/common/strategies/LogExtractionStrategy";
import type { NormalizedLogData } from "@/types";
import { buildNormalizedLogData } from "@/utils/parsers";

export class RestNewRelicParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;

      return buildNormalizedLogData(
        parsed,
        "NEW_RELIC_JSON",
        new Date().toISOString(),
        "REST API Log",
      );
    } catch {
      return null;
    }
  }

  getMetadata(): StrategyMetadata {
    return {
      name: "New Relic Parser",
      description: "Parses structured JSON logs from New Relic.",
      detectionRule: "Valid JSON object starting with '{' and ending with '}'.",
    };
  }
}
