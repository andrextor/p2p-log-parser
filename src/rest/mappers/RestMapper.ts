import { RAW_STREAM_MAX_LENGTH } from "@/common/constants";
import type { LogMapper } from "@/common/mappers/BaseMapper";
import { resolveOutcome } from "@/common/outcome";
import {
  AppTypes,
  type LogCategory,
  type LogEvent,
  type NormalizedLogData,
  type Outcome,
  type RestDetails,
} from "@/types";
import { buildEventBase } from "@/utils/mapper";
import {
  DEFAULT_REST_ACTION_MAP,
  type RestActionDetail,
  findRestAction,
} from "../constants/RestActions";
import {
  CHANNEL_PROVIDERS,
  describeOperation,
  isRequestAction,
} from "../constants/RestOperations";

/** Mensajes que emite `placetopay/guzzle-logger`. */
const GUZZLE_MESSAGES = ["HTTP Req", "HTTP Res", "HTTP Except", "HTTP Stats"];

/** Mensajes que emite el carrier SOAP heredado (Diners). */
const SOAP_MESSAGES = ["REQUEST", "RESPONSE", "RESPONSE Fault"];

const LARAVEL_TAG = /^\[([A-Z][\w -]*)\](?:\[([A-Z_]+)\])?/;

interface Shape {
  /** Payload efectivo: contexto Atropos o JSON incrustado en el mensaje. */
  payload: Record<string, unknown>;
  /** Sub-contexto Atropos: `{method, endpoint, data|exception}`. */
  inner: Record<string, unknown>;
  provider: string;
  operation: string;
  action: string;
  isLaravel: boolean;
}

interface Resolution {
  message: string;
  category: LogCategory;
  statusCode?: number | string | null;
  transport?: RestDetails["transport"];
  requestBody?: unknown;
  responseBody?: unknown;
  /** Lado del intercambio, cuando la ida y la vuelta son registros distintos. */
  role?: LogEvent["pairRole"];
  durationMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export class RestMapper implements LogMapper {
  private readonly actionMap: Record<string, RestActionDetail>;

  constructor(
    actionMap: Record<string, RestActionDetail> = DEFAULT_REST_ACTION_MAP,
  ) {
    this.actionMap = actionMap;
  }

  canHandle(data: NormalizedLogData): boolean {
    const msg = String(data.message ?? "");
    const ctx = asRecord(data.context);
    const isLaravelFile = String(ctx.filePath ?? "").includes("laravel.log");
    const hasLaravelPattern =
      /production\.(INFO|ALERT|WARNING|CRITICAL|ERROR|NOTICE|DEBUG)/.test(msg);
    // Log del middleware `HttpLogger`: la petición entrante va serializada en
    // el mensaje, sin `provider` ni canal que delaten el dominio.
    const isInboundHttp =
      ctx.method !== undefined &&
      ctx.uri !== undefined &&
      ctx.responseStatusCode !== undefined;

    return !!(
      data.sourceType === "NEW_RELIC_JSON" ||
      (data.channel && data.channel in CHANNEL_PROVIDERS) ||
      (ctx.provider && ctx.action) ||
      isInboundHttp ||
      isLaravelFile ||
      hasLaravelPattern ||
      msg.includes("RestSdk") ||
      msg.includes("INTERDIN")
    );
  }

  map(data: NormalizedLogData, _rawLine: string, _index: number): LogEvent {
    const msgRaw = data.message ?? "";
    const shape = this.readShape(data);

    const resolved =
      this.resolveAtropos(shape) ??
      this.resolveGuzzle(msgRaw, shape) ??
      this.resolveInboundHttp(shape) ??
      this.resolveSoap(msgRaw, shape) ??
      this.resolveApplicationLog(msgRaw, shape);

    const outcome = resolveOutcome({
      context: asRecord(data.context),
      payload: shape.payload,
      statusCode: resolved.statusCode,
      message: msgRaw,
    });
    const failure = this.resolveFailure(shape, outcome, resolved);

    const message = failure?.message ?? resolved.message;
    const category = failure?.category ?? resolved.category;
    const statusCode = failure?.statusCode ?? resolved.statusCode ?? null;
    const level = category === "ERROR" ? "ERROR" : data.level;

    const details: RestDetails = {
      provider: shape.provider,
      operation: shape.operation || null,
      action: shape.action || null,
      channel: data.channel ?? null,
      simulator: shape.payload.simulatorMode === true ? true : undefined,
      transport: resolved.transport,
      tag: this.readTag(msgRaw),
      method: this.readMethod(shape),
      endpoint: this.readEndpoint(shape, data),
      statusCode,
      requestBody: resolved.requestBody,
      responseBody: resolved.responseBody,
      awsRequestId: String(
        asRecord(data.context).messageId ?? shape.payload.id ?? "",
      ),
      payload: Object.keys(shape.payload).length
        ? shape.payload
        : { raw: msgRaw },
      exception: outcome.exception,
      source: "BACKEND",
      isLaravel: shape.isLaravel,
      rawTitle: msgRaw || undefined,
    };

    const base = buildEventBase(
      asRecord(data.context),
      data.timestamp,
      message,
      data.extra,
    );

    return {
      ...base,
      timestamp: data.timestamp,
      level,
      message,
      category,
      appType: AppTypes.REST,
      details,
      context: data.context,
      outcome,
      pairKey: this.buildPairKey(
        base.correlation.traceId,
        shape,
        resolved.role,
      ),
      pairRole: resolved.role,
      durationMs: resolved.durationMs,
      rawStream: msgRaw.slice(0, RAW_STREAM_MAX_LENGTH),
    };
  }

  // ── Lectura de la forma del registro ──

  /**
   * Determina de dónde salen los datos estructurados.
   *
   * Los logs de SDK (Atropos) los traen en `context`; los exports donde la línea
   * entera quedó serializada dentro del texto los traen incrustados en el
   * mensaje. Antes solo se miraba el mensaje, así que un registro bien formado
   * de New Relic perdía toda la estructura.
   */
  private readShape(data: NormalizedLogData): Shape {
    const ctx = asRecord(data.context);
    const embedded = asRecord(this.parseInternalJson(data.message ?? ""));

    const payload = ctx.provider && ctx.action ? ctx : { ...ctx, ...embedded };

    const inner = asRecord(payload.context ?? payload.data);
    const isLaravel = String(data.message ?? "").includes("production.");

    const provider = String(
      payload.provider ??
        payload.TENANT_DOMAIN ??
        payload.service ??
        (data.channel ? CHANNEL_PROVIDERS[data.channel] : undefined) ??
        (isLaravel ? "LARAVEL" : "API_REST"),
    );

    return {
      payload,
      inner,
      provider,
      operation: payload.operation ? String(payload.operation) : "",
      action: payload.action ? String(payload.action) : "",
      isLaravel,
    };
  }

  // ── Cascada de formatos ──

  /** Formato canónico de los SDK de proveedor (Atropos/Tangram). */
  private resolveAtropos(shape: Shape): Resolution | null {
    // Se mira `payload.provider`, no `shape.provider`: este último trae un
    // valor por defecto y haría que cualquier log con `action` pareciera Atropos.
    if (!shape.action || !(shape.payload.provider || shape.operation)) {
      return null;
    }
    if (GUZZLE_MESSAGES.includes(shape.action)) return null;

    const isRequest = isRequestAction(shape.action);
    const label = this.describeOperation(shape.operation);
    const actionLabel = shape.action.toUpperCase().replace(/-/g, " ");

    const body = asRecord(this.readDinBody(shape));
    const records = Number(body.recordsCount ?? 0);
    const suffix = !isRequest && records > 0 ? ` (${records} records)` : "";

    return {
      message: `${label} | ${actionLabel}${suffix}`,
      category: isRequest ? "HTTP_REQ_OUT" : "HTTP_RES",
      role: isRequest ? "request" : "response",
      transport: this.readTransport(shape),
      requestBody: isRequest ? shape.inner.data : undefined,
      responseBody: isRequest ? undefined : shape.inner.data,
    };
  }

  /** `HTTP Req` / `HTTP Res` / `HTTP Except` / `HTTP Stats` de guzzle-logger. */
  private resolveGuzzle(msgRaw: string, shape: Shape): Resolution | null {
    const marker = GUZZLE_MESSAGES.find((m) => msgRaw.includes(m));
    if (!marker) return null;

    const request = asRecord(shape.payload.request);
    const response = asRecord(shape.payload.response);
    const url = String(request.url ?? response.url ?? shape.payload.uri ?? "");

    if (marker === "HTTP Stats") {
      // `time` viene en segundos. El registro no lleva identificador de traza,
      // así que la duración se queda en el propio evento: no hay forma fiable
      // de atribuirla a un intercambio concreto.
      const seconds = Number(shape.payload.time);
      return {
        message: `Transfer statistics${url ? ` · ${url}` : ""}`,
        category: "BACKEND_LOG",
        transport: "http",
        durationMs: Number.isFinite(seconds)
          ? Math.round(seconds * 1000)
          : undefined,
      };
    }

    if (marker === "HTTP Except") {
      return {
        message: "HTTP transport failure",
        category: "ERROR",
        transport: "http",
      };
    }

    const isRequest = marker === "HTTP Req";
    return {
      message: `${shape.provider} | HTTP ${isRequest ? "Request" : "Response"}`,
      category: isRequest ? "HTTP_REQ_OUT" : "HTTP_RES",
      statusCode: (response.status_code as number) ?? null,
      role: isRequest ? "request" : "response",
      transport: "http",
      requestBody: request.body,
      responseBody: response.body,
    };
  }

  /**
   * Log del middleware `HttpLogger` de rest-services (canal `http`): el mensaje
   * es un JSON con la petición entrante y su código de respuesta.
   */
  private resolveInboundHttp(shape: Shape): Resolution | null {
    const p = shape.payload;
    if (!p.method || !p.uri || p.responseStatusCode === undefined) return null;

    return {
      message: `API ${String(p.method).toUpperCase()} ${String(p.uri)}`,
      category: "HTTP_REQ_IN",
      statusCode: p.responseStatusCode as number,
      transport: "http",
      requestBody: p.bodyRequest,
      responseBody: p.bodyResponse,
    };
  }

  /** Carrier SOAP heredado: `REQUEST` / `RESPONSE` / `RESPONSE Fault`. */
  private resolveSoap(msgRaw: string, shape: Shape): Resolution | null {
    const trimmed = msgRaw.trim();
    if (!SOAP_MESSAGES.includes(trimmed)) return null;

    const isRequest = trimmed === "REQUEST";
    const reference = shape.payload.reference
      ? ` · ${String(shape.payload.reference)}`
      : "";

    return {
      message: `${shape.provider} SOAP ${isRequest ? "Request" : "Response"}${reference}`,
      category:
        trimmed === "RESPONSE Fault"
          ? "ERROR"
          : isRequest
            ? "HTTP_REQ_OUT"
            : "HTTP_RES",
      transport: "soap",
      requestBody: isRequest ? shape.payload.request : undefined,
      responseBody: isRequest ? undefined : shape.payload.result,
    };
  }

  /** Log de aplicación Laravel, con o sin etiqueta `[TAG]`. */
  private resolveApplicationLog(msgRaw: string, shape: Shape): Resolution {
    const text = shape.isLaravel ? this.parseLaravelMessage(msgRaw) : msgRaw;
    const known = findRestAction(text || msgRaw, this.actionMap);

    return {
      message: known?.message ?? text ?? "Trace event",
      category: known?.category ?? "APPLICATION_LOG",
      transport: "internal",
    };
  }

  // ── Errores ──

  /** Traduce el `Outcome` al mensaje y la categoría que muestra el consumidor. */
  private resolveFailure(
    shape: Shape,
    outcome: Outcome,
    resolved: Resolution,
  ): Resolution | null {
    if (!outcome.isError) return null;

    if (outcome.kind === "exception") {
      return {
        message: `Critical Failure [${shape.provider}]: ${(outcome.message ?? "").substring(0, 60)}...`,
        category: "ERROR",
        statusCode: outcome.code ?? 500,
      };
    }

    if (outcome.kind === "business") {
      return {
        message: `${shape.provider} | Error ${outcome.code}: ${outcome.message}`,
        category: "ERROR",
        statusCode: outcome.code ?? null,
      };
    }

    return { ...resolved, category: "ERROR" };
  }

  /**
   * Identifica el intercambio. Sin traza no hay forma fiable de emparejar, así
   * que se prefiere no emparejar antes que unir eventos que no van juntos.
   */
  private buildPairKey(
    traceId: string | undefined,
    shape: Shape,
    role: LogEvent["pairRole"],
  ): string | undefined {
    if (!role || !traceId) return undefined;
    return `${traceId}|${shape.provider}|${shape.operation}`;
  }

  // ── Lecturas puntuales ──

  /**
   * El mapa de acciones sigue teniendo prioridad sobre el catálogo para que los
   * integradores puedan sobrescribir la etiqueta de una operación vía
   * `customRestActions`.
   */
  private describeOperation(operation: string): string {
    if (!operation) return "API Operation";
    return this.actionMap[operation]?.message ?? describeOperation(operation);
  }

  private readTransport(shape: Shape): RestDetails["transport"] {
    if (shape.inner.soapOptions || shape.payload.soapOptions) return "soap";
    if (shape.inner.iso8583 || shape.payload.iso8583) return "iso8583";
    if (shape.inner.endpoint || shape.inner.method) return "http";
    return undefined;
  }

  private readDinBody(shape: Shape): unknown {
    return (
      asRecord(shape.inner.data).dinBody ??
      asRecord(shape.payload.data).dinBody ??
      asRecord(shape.inner).dinBody
    );
  }

  private readMethod(shape: Shape): string | null {
    const method = shape.inner.method ?? shape.payload.method;
    return method ? String(method).toUpperCase() : null;
  }

  private readEndpoint(shape: Shape, data: NormalizedLogData): string | null {
    const endpoint =
      shape.inner.endpoint ??
      shape.payload.endpoint ??
      shape.payload.uri ??
      asRecord(shape.payload.request).url ??
      asRecord(shape.payload.response).url ??
      asRecord(data.context).filePath;

    return endpoint ? String(endpoint) : null;
  }

  private readTag(msgRaw: string): string | null {
    const match = msgRaw.match(LARAVEL_TAG);
    if (!match) return null;
    return match[2] ? `${match[1]}/${match[2]}` : match[1];
  }

  private parseLaravelMessage(msgRaw: string): string {
    const parts = msgRaw.split("production.");
    if (!parts[1]) return "";

    const levelAndMsg = parts[1].split(": ");
    const messageWithJson = levelAndMsg[1] ?? "";
    const jsonStart = messageWithJson.indexOf("{");

    return jsonStart !== -1
      ? messageWithJson.substring(0, jsonStart).trim()
      : messageWithJson.trim();
  }

  // ── Reparación de JSON incrustado ──

  private parseInternalJson(message: string): unknown {
    if (typeof message !== "string") return null;
    const jsonStart = message.indexOf("{");
    if (jsonStart === -1) return null;

    let rawJson = message.substring(jsonStart).trim();

    if (rawJson.includes("(truncated...)")) {
      rawJson = rawJson.split("(truncated...)")[0].trim();
    }

    if (rawJson.includes("} {")) {
      rawJson = `${rawJson.split("} {")[0]}}`;
    }

    try {
      return JSON.parse(rawJson);
    } catch {
      return this.tryFixTruncatedJson(rawJson);
    }
  }

  private tryFixTruncatedJson(jsonStr: string): unknown {
    try {
      let fixed = jsonStr;
      const openBraces = (fixed.match(/\{/g) || []).length;
      const closeBraces = (fixed.match(/\}/g) || []).length;
      if (openBraces > closeBraces) {
        fixed += "}".repeat(openBraces - closeBraces);
      }
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}
