import { LaravelLineParser } from "@/common/strategies/LaravelLineParser";
import type {
  LogExtractionStrategy,
  StrategyMetadata,
} from "@/common/strategies/LogExtractionStrategy";
import type { NormalizedLogData } from "@/types";

/** Marca de tiempo con zona horaria explícita (offset u hora Zulu). */
const HAS_OFFSET = /([+-]\d{2}:?\d{2}|Z)$/;

/** Columnas de la exportación que aportan contexto útil al evento. */
const CARRIED_COLUMNS = ["filePath", "messageId", "hostname", "app", "tenant"];

/**
 * Divide una fila CSV respetando comillas y el escape por duplicación (`""`).
 */
function splitCsvRow(row: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];

    if (char === '"') {
      if (quoted && row[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (char === "," && !quoted) {
      fields.push(field);
      field = "";
      continue;
    }

    field += char;
  }

  fields.push(field);
  return fields;
}

/**
 * Exportación CSV de New Relic Logs.
 *
 * La primera columna es `message` y contiene la línea de Laravel completa, con
 * las comillas escapadas por duplicación; la segunda es la marca de tiempo en
 * epoch ms. El resto son metadatos de infraestructura, de los que se conservan
 * unos pocos (`filePath` identifica el canal de log de origen).
 *
 * La fila de cabecera se memoriza para poder leer las columnas por nombre: New
 * Relic no garantiza el orden entre consultas. Sin cabecera se cae a las dos
 * primeras posiciones, que sí son estables.
 */
export class RestNewRelicCsvParser implements LogExtractionStrategy {
  private columns: string[] | null = null;
  private readonly lineParser = new LaravelLineParser();

  parse(line: string): NormalizedLogData | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('"')) return null;

    const fields = splitCsvRow(trimmed);
    if (fields.length < 2) return null;

    if (fields[0] === "message" && fields.includes("timestamp")) {
      this.columns = fields;
      return null;
    }

    const read = (name: string): string | undefined => {
      const index = this.columns?.indexOf(name) ?? -1;
      return index >= 0 ? fields[index] : undefined;
    };

    const message = (read("message") ?? fields[0]).trim();
    if (!message) return null;

    const parsed = this.lineParser.parse(message);
    if (!parsed) return null;

    const epoch = this.readEpoch(read("timestamp") ?? fields[1]);

    return {
      ...parsed,
      // La marca del mensaje solo gana si trae zona horaria explícita; si no,
      // el epoch de New Relic es UTC inequívoco y con precisión de milisegundo,
      // y evita tener que suponer el offset.
      timestamp: HAS_OFFSET.test(parsed.timestamp)
        ? parsed.timestamp
        : epoch || parsed.timestamp,
      context: { ...parsed.context, ...this.carriedContext(read) },
      sourceType: "NEW_RELIC_CSV",
    };
  }

  getMetadata(): StrategyMetadata {
    return {
      name: "New Relic CSV Parser",
      description:
        "Parses New Relic Logs CSV exports whose `message` column holds a full Laravel log line.",
      detectionRule:
        "Quoted CSV row whose `message` column parses as a Laravel line (`[date] channel.LEVEL: ...`).",
    };
  }

  private readEpoch(value: string | undefined): string {
    const epoch = Number(value);
    return Number.isFinite(epoch) && epoch > 0
      ? new Date(epoch).toISOString()
      : "";
  }

  private carriedContext(
    read: (name: string) => string | undefined,
  ): Record<string, unknown> {
    const carried: Record<string, unknown> = {};
    for (const name of CARRIED_COLUMNS) {
      const value = read(name);
      if (value) carried[name] = value;
    }
    return carried;
  }
}
