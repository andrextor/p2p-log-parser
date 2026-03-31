import type { NormalizedLogData } from "@/types";
import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "../../common/strategies/LogExtractionStrategy";

export class CheckoutInsightsParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    let parsed: Record<string, unknown> | null = null;
    let timestampStr = "";

    try {
      if (line.trim().startsWith("{")) {
        const json = JSON.parse(line) as Record<string, unknown>;
        if (json["@message"]) {
          parsed =
            typeof json["@message"] === "string"
              ? (JSON.parse(json["@message"]) as Record<string, unknown>)
              : (json["@message"] as Record<string, unknown>);
          timestampStr = String(json["@timestamp"] || "");
        }
      }
    } catch {
      // Fallback to regex if JSON parse fails
    }

    if (!parsed) {
      const regex = /^\s*(\d+)\s+([^\s]+)\s+(\{.*)$/;
      const match = line.match(regex);

      if (!match) return null;

      const [, _id, timestamp, jsonRaw] = match;
      timestampStr = timestamp;

      try {
        parsed = JSON.parse(jsonRaw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    if (!parsed) return null;

    const finalTime = String(parsed.datetime || timestampStr);
    const level = String(parsed.level_name || "INFO");
    const message = String(parsed.message || "AWS Insights Log");
    const context = (parsed.context || parsed) as Record<string, unknown>;

    return {
      timestamp: finalTime,
      level,
      message,
      context,
      sourceType: "AWS_CSV",
    };
  }

  getMetadata(): StrategyMetadata {
    return {
      name: "AWS Insights Parser",
      description: "Parses logs from CloudWatch Insights format.",
      detectionRule:
        "/^\\s*(\\d+)\\s+([^\\s]+)\\s+({.*)$/ or JSON with @message",
    };
  }
}
