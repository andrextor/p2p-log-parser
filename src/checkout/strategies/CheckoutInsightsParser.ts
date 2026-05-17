import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "@/common/strategies/LogExtractionStrategy";
import type { NormalizedLogData } from "@/types";
import { buildNormalizedLogData } from "@/utils/parsers";

export class CheckoutInsightsParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const result = this.tryParseAsJsonWithAtMessage(line);
    if (result) return result;

    return this.tryParseAsRegex(line);
  }

  private tryParseAsJsonWithAtMessage(line: string): NormalizedLogData | null {
    if (!line.trim().startsWith("{")) return null;

    try {
      const json = JSON.parse(line) as Record<string, unknown>;
      if (!json["@message"]) return null;

      const parsed =
        typeof json["@message"] === "string"
          ? (JSON.parse(json["@message"]) as Record<string, unknown>)
          : (json["@message"] as Record<string, unknown>);

      return buildNormalizedLogData(
        parsed,
        "AWS_CSV",
        String(json["@timestamp"] ?? ""),
        "AWS Insights Log",
      );
    } catch {
      return null;
    }
  }

  private tryParseAsRegex(line: string): NormalizedLogData | null {
    const regex = /^\s*(\d+)\s+([^\s]+)\s+(\{.*)$/;
    const match = line.match(regex);
    if (!match) return null;

    const [, _id, timestamp, jsonRaw] = match;

    try {
      const parsed = JSON.parse(jsonRaw) as Record<string, unknown>;

      return buildNormalizedLogData(
        parsed,
        "AWS_CSV",
        timestamp,
        "AWS Insights Log",
      );
    } catch {
      return null;
    }
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
