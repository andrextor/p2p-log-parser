import type { NormalizedLogData } from "@/types";
import type { LogExtractionStrategy } from "../../common/strategies/LogExtractionStrategy";

export class CheckoutInsightsParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const regex = /^\s*(\d+)\s+([^\s]+)\s+(\{.*)$/;
    const match = line.match(regex);

    if (!match) return null;

    const [, _id, timestamp, jsonRaw] = match;

    try {
      const parsed = JSON.parse(jsonRaw) as Record<string, unknown>;
      const finalTime = String(parsed.datetime || timestamp);
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
    } catch {
      return null;
    }
  }
}
