import type { NormalizedLogData } from "@/types";

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
 * Normalizes a log level from a parsed JSON object.
 * Priority: `level_name` → `level` → `defaultLevel`, always uppercased.
 */
export function normalizeLevel(
  parsed: Record<string, unknown>,
  defaultLevel = "INFO",
): string {
  return String(
    parsed.level_name ?? parsed.level ?? defaultLevel,
  ).toUpperCase();
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
  return {
    timestamp: resolveTimestamp(parsed, fallbackTimestamp),
    level: normalizeLevel(parsed),
    message: String(parsed.message ?? fallbackMessage),
    context: extractContext(parsed),
    sourceType,
  };
}
