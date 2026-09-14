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
    if (trimmed.startsWith('"Time"')) return null;

    // 2. Locate the JSON payload. La columna `@message` trae el JSON a pelo
    // (`,"{…}`) o, en los lambdas de Bref, como `LEVEL\tmensaje\t{…}`.
    const startIndex = trimmed.indexOf(',"{');
    const brefIndex = startIndex === -1 ? trimmed.indexOf("\t{") : -1;
    if (startIndex === -1 && brefIndex === -1) return null;

    try {
      const jsonStart = startIndex !== -1 ? startIndex + 2 : brefIndex + 1;
      const jsonEnd = trimmed.lastIndexOf("}");
      if (jsonEnd <= jsonStart) return null;

      let jsonContent = trimmed.substring(jsonStart, jsonEnd + 1);

      // 3. Normalize CSV double-quotes
      jsonContent = unescapeCsvDoubleQuotes(jsonContent);

      // 4. Parse JSON
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;

      // 5. Use timestamp from CSV first column as fallback
      const timestampPart = trimmed.split(",")[0].replace(/"/g, "");

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
        "Contains the JSON marker ',\"{' or a Bref `LEVEL\\tmessage\\t{` column.",
    };
  }
}
