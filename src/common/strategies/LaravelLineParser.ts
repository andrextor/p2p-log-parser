import type { NormalizedLogData } from "@/types";
import { normalizeLevel } from "@/utils/parsers";
import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "./LogExtractionStrategy";

/** `[fecha] canal.NIVEL: mensaje {context} {extra}` — LineFormatter de Monolog. */
const LARAVEL_LINE = /^\[(.*?)\]\s+([\w-]+)\.(\w+):\s+(.*)$/;

/**
 * Parsea una línea de log de Laravel/Monolog.
 *
 * A diferencia de la versión anterior, **no fusiona** todos los objetos JSON de
 * la línea: el LineFormatter escribe `{context}` y luego `{extra}`, y mezclarlos
 * hacía que campos de `extra` (como `tenantId`) aparecieran como si fueran
 * contexto de la aplicación.
 */
export class LaravelLineParser implements LogExtractionStrategy {
  parse(line: string): NormalizedLogData | null {
    const match = line.match(LARAVEL_LINE);
    if (!match) return null;

    const [, timestamp, channel, level, contentRaw] = match;
    const blocks = this.extractJsonBlocks(contentRaw);

    const [context = {}, ...rest] = blocks.objects;
    const extra = rest.length ? Object.assign({}, ...rest) : undefined;

    const message =
      blocks.firstIndex === -1
        ? contentRaw.trim()
        : contentRaw.substring(0, blocks.firstIndex).trim();

    return {
      timestamp,
      level: normalizeLevel({ level_name: level }),
      message: message || this.fallbackMessage(context),
      context,
      extra,
      channel,
      sourceType: "LARAVEL_LOCAL",
    };
  }

  getMetadata(): StrategyMetadata {
    return {
      name: "Laravel Line Parser",
      description:
        "Parses Laravel/Monolog line logs, keeping `context` and `extra` separate.",
      detectionRule: "/^\\[(.*?)\\]\\s+([\\w-]+)\\.(\\w+):\\s+(.*)$/",
    };
  }

  /** Recorre la línea contando llaves para aislar cada objeto JSON completo. */
  private extractJsonBlocks(content: string): {
    objects: Record<string, unknown>[];
    firstIndex: number;
  } {
    const objects: Record<string, unknown>[] = [];
    let firstIndex = -1;
    let depth = 0;
    let start = -1;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (char === "{") {
        if (depth === 0) start = i;
        depth++;
        continue;
      }

      if (char !== "}" || depth === 0) continue;

      depth--;
      if (depth !== 0 || start === -1) continue;

      try {
        objects.push(
          JSON.parse(content.substring(start, i + 1)) as Record<
            string,
            unknown
          >,
        );
        if (firstIndex === -1) firstIndex = start;
      } catch {
        // Fragmento corrupto o truncado: se ignora, la línea sigue siendo útil.
      }
      start = -1;
    }

    return { objects, firstIndex };
  }

  private fallbackMessage(context: Record<string, unknown>): string {
    if (context.action_method)
      return `Action: ${String(context.action_method)}`;
    if (context.type) return `Event: ${String(context.type)}`;
    return "Log";
  }
}
