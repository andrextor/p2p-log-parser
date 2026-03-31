import type { NormalizedLogData } from "@/types";
import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "../../common/strategies/LogExtractionStrategy";

export class CheckoutGrafanaJsonParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();

    // 1. Noise Filtering
    // A valid Grafana JSON line from the export typically looks like:
    // timestamp \t iso_date \t {JSON}
    // We expect the line to have a JSON payload
    const jsonStartIndex = trimmed.indexOf("{");
    if (jsonStartIndex === -1 || !/^\d+\s+\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
      return null;
    }

    try {
      // 2. Locate the JSON payload
      // Verify that the JSON part spans to the end of the line
      const lastBracketIndex = trimmed.lastIndexOf("}");
      if (lastBracketIndex === -1 || lastBracketIndex <= jsonStartIndex)
        return null;

      const jsonContent = trimmed.substring(
        jsonStartIndex,
        lastBracketIndex + 1,
      );

      // 3. Parse JSON
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;

      // 4. Extract core fields
      // Use timestamp from the start of the line (Unix ms or ISO)
      // The first part is usually Unix timestamp in ms
      const parts = trimmed.substring(0, jsonStartIndex).trim().split(/\s+/);
      const timestampIso = parts.length > 1 ? parts[1] : parts[0];

      const timestamp = String(
        parsed.datetime || parsed.timestamp || timestampIso,
      );

      const level = String(
        parsed.level_name || parsed.level || "INFO",
      ).toUpperCase();
      const message = String(parsed.message || "Grafana JSON Log");
      const context = (parsed.context || parsed) as Record<string, unknown>;

      return {
        timestamp,
        level,
        message,
        context,
        sourceType: "GRAFANA_JSON",
      };
    } catch {
      // JSON syntax error or other parsing issues
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
