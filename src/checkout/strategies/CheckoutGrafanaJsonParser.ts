import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "@/common/strategies/LogExtractionStrategy";
import type { NormalizedLogData } from "@/types";
import { buildNormalizedLogData } from "@/utils/parsers";

export class CheckoutGrafanaJsonParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();

    // 1. Noise Filtering
    const jsonStartIndex = trimmed.indexOf("{");
    if (jsonStartIndex === -1 || !/^\d+\s+\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      return null;
    }

    try {
      // 2. Locate the JSON payload
      const lastBracketIndex = trimmed.lastIndexOf("}");
      if (lastBracketIndex === -1 || lastBracketIndex <= jsonStartIndex)
        return null;

      const jsonContent = trimmed.substring(
        jsonStartIndex,
        lastBracketIndex + 1,
      );

      // 3. Parse JSON
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;

      // 4. Extract timestamp from line prefix (Unix ms + ISO date)
      const parts = trimmed.substring(0, jsonStartIndex).trim().split(/\s+/);
      const timestampIso = parts.length > 1 ? parts[1] : parts[0];

      return buildNormalizedLogData(
        parsed,
        "GRAFANA_JSON",
        timestampIso,
        "Grafana JSON Log",
      );
    } catch {
      return null;
    }
  }

  getMetadata(): StrategyMetadata {
    return {
      name: "Grafana JSON Parser",
      description:
        "Parses logs exported from Grafana CloudWatch in JSON/text format.",
      detectionRule: "Starts with timestamp and contains a raw JSON payload.",
    };
  }
}
