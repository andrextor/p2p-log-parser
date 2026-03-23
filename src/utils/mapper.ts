export function buildEventId(
  ctx: Record<string, unknown>,
  index: number,
): string {
  const traceId = String(ctx.aws_request_id ?? ctx.transaction_id ?? "gen");
  return `${traceId}-${index}`;
}

export function extractTimestamp(
  data: Record<string, unknown>,
  line: string,
): string {
  if (data.datetime) return String(data.datetime);
  if (data.timestamp) return String(data.timestamp);
  return line.substring(0, 23).replace(/"/g, "");
}

export function normalizePath(path: string): string {
  return String(path)
    .replace(/%22|&quot|"/g, "")
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
