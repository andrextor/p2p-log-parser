import type { Correlation } from "@/types";
import { buildCorrelation } from "./correlation";
import { toEpochMs } from "./time";

/** FNV-1a de 32 bits en base36. Suficiente para desambiguar dentro de una traza. */
function hash32(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Id estable de evento: `{traceId}-{hash(seed)}`.
 *
 * El `seed` debe ser el contenido del evento (marca de tiempo + mensaje), no su
 * posición en el fichero: así el mismo log recibe el mismo id aunque se exporte
 * con otro recorte o en otro orden.
 */
export function buildEventId(
  ctx: Record<string, unknown>,
  seed: string,
): string {
  const traceId = String(
    ctx.aws_request_id ?? ctx.id ?? ctx.transaction_id ?? "gen",
  );
  return `${traceId}-${hash32(seed)}`;
}

export function extractTimestamp(
  data: Record<string, unknown>,
  line: string,
): string {
  if (data.datetime) return String(data.datetime);
  if (data.timestamp) return String(data.timestamp);
  if (line.length < 23) return new Date().toISOString();
  return line.substring(0, 23).replace(/"/g, "");
}

export function normalizePath(path: string): string {
  return String(path)
    .replace(/%22|&quot;|"/g, "")
    .replace(/\/+$/, "");
}

export function extractHttpFromMessage(message: string): {
  method?: string;
  path?: string;
} {
  const match = String(message).match(
    /\b(GET|POST|PUT|PATCH|DELETE)\s+([^\s]+)/i,
  );
  if (!match) return {};

  return {
    method: match[1],
    path: normalizePath(match[2]),
  };
}

/**
 * Campos comunes que todo mapper debe resolver igual: id estable, epoch ms y
 * correlación. Se usa con spread al construir el `LogEvent`.
 */
export function buildEventBase(
  ctx: Record<string, unknown>,
  timestamp: string,
  message: string,
  extra?: Record<string, unknown>,
): { id: string; ts: number; correlation: Correlation } {
  const ts = toEpochMs(timestamp);
  return {
    id: buildEventId(ctx, `${ts}|${message}`),
    ts,
    correlation: buildCorrelation(ctx, extra),
  };
}
