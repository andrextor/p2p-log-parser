import { NormalizedLogData } from "@/types";
import { LogExtractionStrategy } from "../../common/strategies/LogExtractionStrategy";

export class RestNewRelicParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();

    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const timestamp = String(
        parsed.timestamp || parsed.datetime || new Date().toISOString(),
      );
      const level = String(
        parsed.level || parsed.level_name || "INFO",
      ).toUpperCase();
      const message = String(parsed.message || "REST API Log");
      const context = (parsed.context || parsed) as Record<string, unknown>;

      return {
        timestamp,
        level,
        message,
        context,
        sourceType: "NEW_RELIC_JSON",
      };
    } catch {
      return null;
    }
  }
}
