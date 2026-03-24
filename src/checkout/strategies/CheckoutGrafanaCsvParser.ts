import type { NormalizedLogData } from "@/types";
import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "../../common/strategies/LogExtractionStrategy";

export class CheckoutGrafanaCsvParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();

    // 1. Noise Filtering
    // Ignore headers and non-log lines for CSV
    if (trimmed.startsWith('"Time"') || !trimmed.includes(',"{')) {
      return null;
    }

    try {
      // 2. Locate the JSON payload in the @message column
      // Grafana CloudWatch exports usually have: Time, __log__, __logstream__, @message (JSON), session_id, Value
      const startJsonMarker = ',"{';
      const startIndex = trimmed.indexOf(startJsonMarker);
      if (startIndex === -1) return null;

      // The JSON starts after the comma
      const jsonStart = startIndex + 1;

      // Find the end of the JSON. It's usually followed by a comma if there are more columns (session_id, Value)
      // or it's at the end of the line.
      // Since the JSON itself is quoted in the CSV: "{"message":...}"
      // but in this export it's: ... ,"{""message"":...}", ...

      const lastBracketIndex = trimmed.lastIndexOf('}"');
      if (lastBracketIndex === -1) return null;

      let jsonContent = trimmed.substring(jsonStart, lastBracketIndex + 2);

      // Remove outer quotes if they exist (CSV style)
      if (jsonContent.startsWith('"') && jsonContent.endsWith('"')) {
        jsonContent = jsonContent.substring(1, jsonContent.length - 1);
      }

      // 3. Unescape double-double quotes ("" -> ")
      jsonContent = jsonContent.replace(/""/g, '"');

      // 4. Parse JSON
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;

      // 5. Extract core fields
      // Use timestamp from the CSV first column if available, otherwise from JSON
      const timestampPart = trimmed
        .substring(0, startIndex)
        .split(",")[0]
        .replace(/"/g, "");
      const timestamp = String(
        parsed.datetime || parsed.timestamp || timestampPart,
      );

      const level = String(
        parsed.level_name || parsed.level || "INFO",
      ).toUpperCase();
      const message = String(parsed.message || "Grafana CSV Log");
      const context = (parsed.context || parsed) as Record<string, unknown>;

      return {
        timestamp,
        level,
        message,
        context,
        sourceType: "GRAFANA_CSV",
      };
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
