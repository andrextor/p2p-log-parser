import type { LogLevel, NormalizedLogData } from "@/types";

/**
 * Normalizes CSV-exported JSON where double quotes are escaped by duplication.
 * AWS/Grafana CSV exports use `""` → `"`
 */
export function unescapeCsvDoubleQuotes(json: string): string {
  return json.replace(/""/g, '"');
}

/**
 * Resolves a timestamp from a parsed JSON object using a priority chain:
 * `datetime` → `timestamp` → `fallback`
 */
export function resolveTimestamp(
  parsed: Record<string, unknown>,
  fallback: string,
): string {
  return String(parsed.datetime ?? parsed.timestamp ?? fallback);
}

/**
 * Traduce un nivel numérico de Monolog por rangos, no por valor exacto.
 *
 * La escala es DEBUG=100, INFO=200, NOTICE=250, WARNING=300, ERROR=400,
 * CRITICAL=500, ALERT=550, EMERGENCY=600, y admite valores intermedios
 * personalizados. Comparar por umbral cubre cualquier número de la escala;
 * una tabla de valores exactos dejaba caer al default cosas como 450 o 275.
 */
function levelFromMonolog(value: number): LogLevel {
  if (value < 200) return "DEBUG";
  if (value < 300) return "INFO"; // incluye NOTICE (250)
  if (value < 400) return "WARNING";
  if (value < 500) return "ERROR";
  return "CRITICAL"; // incluye ALERT (550) y EMERGENCY (600)
}

/** Nombres PSR-3 que no están en `LogLevel` y hay que colapsar. */
const LEVEL_ALIASES: Record<string, LogLevel> = {
  NOTICE: "INFO",
  WARN: "WARNING",
  ALERT: "CRITICAL",
  EMERGENCY: "CRITICAL",
  FATAL: "CRITICAL",
};

const KNOWN_LEVELS: readonly LogLevel[] = [
  "DEBUG",
  "INFO",
  "WARNING",
  "ERROR",
  "CRITICAL",
];

/**
 * Normaliza un nivel de log a la unión `LogLevel`.
 * Prioridad: `level_name` → `level` → `defaultLevel`.
 *
 * Monolog emite `level` numérico (200, 400, 500…) cuando el export no incluye
 * `level_name`; sin este mapeo el nivel llegaba como la cadena `"200"`.
 */
export function normalizeLevel(
  parsed: Record<string, unknown>,
  defaultLevel: LogLevel = "INFO",
): LogLevel {
  const raw = String(parsed.level_name ?? parsed.level ?? defaultLevel)
    .trim()
    .toUpperCase();

  if (/^\d+$/.test(raw)) return levelFromMonolog(Number(raw));

  return (
    LEVEL_ALIASES[raw] ??
    KNOWN_LEVELS.find((level) => level === raw) ??
    defaultLevel
  );
}

/**
 * Extracts the context object from a parsed JSON record.
 * Uses `parsed.context` if present; otherwise falls back to the entire parsed object.
 */
export function extractContext(
  parsed: Record<string, unknown>,
): Record<string, unknown> {
  return (parsed.context ?? parsed) as Record<string, unknown>;
}

/**
 * Factory that builds a NormalizedLogData object with defaults.
 */
export function buildNormalizedLogData(
  parsed: Record<string, unknown>,
  sourceType: NormalizedLogData["sourceType"],
  fallbackTimestamp: string,
  fallbackMessage = "Log Event",
): NormalizedLogData {
  const extra = parsed.extra as Record<string, unknown> | undefined;

  return {
    timestamp: resolveTimestamp(parsed, fallbackTimestamp),
    level: normalizeLevel(parsed),
    message: String(parsed.message ?? fallbackMessage),
    context: extractContext(parsed),
    extra: extra && typeof extra === "object" ? extra : undefined,
    channel: parsed.channel ? String(parsed.channel) : undefined,
    sourceType,
  };
}
