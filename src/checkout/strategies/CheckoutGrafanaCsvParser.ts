import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "@/common/strategies/LogExtractionStrategy";
import type { NormalizedLogData } from "@/types";
import {
  buildNormalizedLogData,
  unescapeCsvDoubleQuotes,
} from "@/utils/parsers";

export class CheckoutGrafanaCsvParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();

    // 1. Noise Filtering
    if (trimmed.startsWith('"Time"') || !trimmed.includes(',"{')) {
      return null;
    }

    try {
      // 2. Locate the JSON payload
      const startJsonMarker = ',"{';
      const startIndex = trimmed.indexOf(startJsonMarker);
      if (startIndex === -1) return null;

      const jsonStart = startIndex + 1;
      const lastBracketIndex = trimmed.lastIndexOf('}"');
      if (lastBracketIndex === -1) return null;

      let jsonContent = trimmed.substring(jsonStart, lastBracketIndex + 2);

      // Remove outer CSV quotes
      if (jsonContent.startsWith('"') && jsonContent.endsWith('"')) {
        jsonContent = jsonContent.substring(1, jsonContent.length - 1);
      }

      // 3. Normalize CSV double-quotes
      jsonContent = unescapeCsvDoubleQuotes(jsonContent);

      // 4. Parse JSON
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;

      // 5. Use timestamp from CSV first column as fallback
      const timestampPart = trimmed
        .substring(0, startIndex)
        .split(",")[0]
        .replace(/"/g, "");

      return buildNormalizedLogData(
        parsed,
        "GRAFANA_CSV",
        timestampPart,
        "Grafana CSV Log",
      );
    } catch {
      return null;
    }
  }

  getMetadata(): StrategyMetadata {
    return {
      name: "Grafana CSV Parser",
      description:
        "Parses logs exported from Grafana CloudWatch in CSV format.",
      detectionRule:
        "Contains the JSON marker ',\"{' and starts with standard CSV headers or date.",
    };
  }
}
