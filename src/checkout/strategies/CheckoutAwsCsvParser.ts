import { NormalizedLogData } from "@/types";
import { LogExtractionStrategy } from "../../common/strategies/LogExtractionStrategy";

export class CheckoutAwsCsvParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();

    // 1. Noise Filtering
    // Ignore headers (@timestamp) and metadata lines
    if (trimmed.startsWith('"') || trimmed.startsWith("@")) {
      return null;
    }

    // 2. Search for the payload
    // The valid format is: DATE ... ,"{JSON}" ...
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

      // 4. CSV Normalization
      // AWS escapes double quotes by duplicating them. Convert them back.
      jsonContent = jsonContent.replace(/""/g, '"');

      // 5. Parsing
      const parsed = JSON.parse(jsonContent) as Record<string, unknown>;

      // 6. Clean Return
      const finalTime = String(parsed.datetime || timestamp);
      const level = String(parsed.level_name || "INFO");
      const message = String(parsed.message || "AWS CSV Log");
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
