import type { NormalizedLogData } from "@/types";
import type { LogExtractionStrategy } from "../../common/strategies/LogExtractionStrategy";

export class CheckoutLocalParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const regex = /^\[(.*?)\]\s+\w+\.(\w+):\s+(.*)$/;
    const match = line.match(regex);

    if (!match) return null;

    const [, timestamp, level, contentRaw] = match;
    let message = contentRaw.trim();
    let context: Record<string, unknown> = {};

    // Multi-JSON Logic
    const foundObjects: Record<string, unknown>[] = [];
    let firstJsonIndex = -1;
    let bracketCount = 0;
    let startIndex = -1;

    for (let i = 0; i < contentRaw.length; i++) {
      const char = contentRaw[i];
      if (char === "{") {
        if (bracketCount === 0) startIndex = i;
        bracketCount++;
      } else if (char === "}") {
        bracketCount--;
        if (bracketCount === 0 && startIndex !== -1) {
          const candidate = contentRaw.substring(startIndex, i + 1);
          try {
            const parsed = JSON.parse(candidate) as Record<string, unknown>;
            foundObjects.push(parsed);
            if (firstJsonIndex === -1) firstJsonIndex = startIndex;
          } catch {
            // Ignore corrupted chunks
          }
          startIndex = -1;
        }
      }
      if (bracketCount < 0) bracketCount = 0;
    }

    if (foundObjects.length > 0) {
      context = Object.assign({}, ...foundObjects);
      message = contentRaw.substring(0, firstJsonIndex).trim();
    }

    // Checkout specific fallbacks
    if (!message && context) {
      if (context.action_method) {
        message = `Action: ${String(context.action_method)}`;
      } else if (context.type) {
        message = `Event: ${String(context.type)}`;
      } else {
        message = "Checkout Log Details";
      }
    }

    return {
      timestamp,
      level: level.toUpperCase(),
      message: message || "Local Log",
      context,
      sourceType: "LARAVEL_LOCAL",
    };
  }
}
