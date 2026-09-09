import type { Correlation } from "@/types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function first(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    return String(value);
  }
  return undefined;
}

/**
 * Extrae los identificadores de correlación de un contexto de log.
 *
 * Las rutas no son heurísticas: salen del contrato de los emisores
 * (`CheckoutLogger::sessionContext`, `config/http-logger.php`, el formato
 * Atropos). Ver `docs/spec-v2-enriquecimiento.md` §1.
 */
export function buildCorrelation(
  context: unknown,
  extra?: unknown,
): Correlation {
  const ctx = asRecord(context);
  const ext = asRecord(extra);
  const data = asRecord(ctx.data);
  const payload = asRecord(ctx.payload);
  const request = asRecord(ctx.request);
  const body = Object.keys(asRecord(ctx.body)).length
    ? asRecord(ctx.body)
    : asRecord(request.body);

  const correlation: Correlation = {
    traceId: first(ctx.aws_request_id, ctx.id, ctx.messageId, ctx.requestId),
    sessionId: first(ctx.session_id, data.session_id, payload.session_id),
    transactionId: first(ctx.transaction_id, data.transaction_id),
    placetopayId: first(ctx.placetopay_id),
    reference: first(
      ctx.reference,
      asRecord(body.payment).reference,
      asRecord(body.subscription).reference,
    ),
    internalReference: first(ctx.internalReference, body.internalReference),
    provider: first(ctx.provider),
    operation: first(ctx.operation),
    tenant: first(ctx.TENANT_DOMAIN),
    siteId: first(ctx.site_id, data.site_id),
    login: first(asRecord(body.auth).login),
    tenantId: first(ext.tenantId, ctx.tenantId),
  };

  for (const key of Object.keys(correlation) as (keyof Correlation)[]) {
    if (correlation[key] === undefined) delete correlation[key];
  }

  return correlation;
}
