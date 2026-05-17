import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "@/common/strategies/LogExtractionStrategy";
import type { NormalizedLogData } from "@/types";
import {
  buildNormalizedLogData,
  unescapeCsvDoubleQuotes,
} from "@/utils/parsers";

export class CheckoutAwsCsvParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();

    // 1. Noise Filtering
    if (trimmed.startsWith('"') || trimmed.startsWith("@")) {
      return null;
    }

    // 2. Search for the payload
    const jsonMarker = ',"{';
    const markerIndex = trimmed.indexOf(jsonMarker);

    if (markerIndex === -1 || !/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return null;
    }

    try {
      // 3. Extraction
      const timestamp = trimmed.substring(0, markerIndex).trim();
      const startJson = markerIndex + 2;
      const endJson = trimmed.lastIndexOf("}");

      if (endJson === -1 || endJson <= startJson) return null;

      let jsonContent = trimmed.substring(startJson, endJson + 1);

      // 4. Normalize CSV double-quotes
      jsonContent = unescapeCsvDoubleQuotes(jsonContent);

      // 5. Parse and build
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;

      return buildNormalizedLogData(
        parsed,
        "AWS_CSV",
        timestamp,
        "AWS CSV Log",
      );
    } catch {
      return null;
    }
  }

  getMetadata(): StrategyMetadata {
    return {
      name: "AWS CSV Parser",
      description: "Parses logs from AWS CloudWatch CSV exports.",
      detectionRule:
        "Starts with date (YYYY-MM-DD) and contains JSON marker ',\"{'.",
    };
  }
}
