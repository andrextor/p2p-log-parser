// --- 1. APPLICATION IDENTIFIERS ---

export const AppTypes = {
  CHECKOUT: "checkout",
  MICROSITES: "micrositios",
  REST: "rest",
} as const;

export type AppType = (typeof AppTypes)[keyof typeof AppTypes];

export const AppNames: Record<AppType, string> = {
  [AppTypes.CHECKOUT]: "Checkout",
  [AppTypes.MICROSITES]: "Microsites",
  [AppTypes.REST]: "Core REST API",
};

// --- 2. RAW DATA STRUCTURES (Parsers) ---

export type LogLevel = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export interface NormalizedLogData {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
  /** Bloque `extra` de Monolog, que NO debe fusionarse con `context`. */
  extra?: Record<string, unknown>;
  /** Canal Monolog (`production`, `interdin`, `http`…): pista de proveedor. */
  channel?: string;
  sourceType:
    | "AWS_CSV"
    | "LARAVEL_LOCAL"
    | "NEW_RELIC_JSON"
    | "NEW_RELIC_CSV"
    | "GRAFANA_CSV"
    | "GRAFANA_JSON";
}

export type LogCategory =
  | "HTTP_REQ_OUT"
  | "HTTP_REQ_IN"
  | "HTTP_RES"
  | "DB_OP"
  | "NOTIFICATION"
  | "RETURN_NOTIFICATION"
  | "BROWSER_LOAD"
  | "USER_ACTION"
  | "BACKEND_LOG"
  | "APPLICATION_LOG"
  | "ERROR"
  | "PAYMENT"
  | "GENERIC";

// --- 3. DOMAIN DETAILS POLYMORPHISM ---

export interface BaseDetails {
  method?: string | null;
  endpoint?: string | null;
  statusCode?: number | string | null;
  payload?: unknown;
  source?: string | null;
  title?: string;
  rawTitle?: string;
}

export interface CheckoutDetails extends BaseDetails {
  url?: string;
  /** Fase del flujo, deducida del prefijo `«{sujeto} trace:»`. */
  phase?: string;
  /** Paso concreto dentro de la fase. */
  step?: string;
  duration?: string;
  sessionId?: string | number;
  transactionId?: string | number;
  subType?: string | null;
  awsRequestId?: string | null;
  provider?: string | null;
}

export interface RestException {
  class?: string;
  message?: string;
  file?: string;
  line?: number;
}

export interface RestDetails extends BaseDetails {
  provider?: string | null;
  /** Operación del SDK: `sale`, `createOTP`, `creditType`… */
  operation?: string | null;
  /** Acción Atropos: `request`, `response`, `request-decrypted`… */
  action?: string | null;
  /** Canal Monolog del registro; identifica al proveedor cuando falta `provider`. */
  channel?: string | null;
  /** `true` cuando el SDK corrió contra el simulador y no contra el proveedor real. */
  simulator?: boolean;
  transport?: "http" | "soap" | "iso8583" | "internal";
  /** Etiqueta de log de aplicación: `[KOUNT]`, `[SUBSCRIPTION][PAYMENT_PROCESS]`… */
  tag?: string | null;
  requestBody?: unknown;
  responseBody?: unknown;
  awsRequestId?: string | null;
  exception?: RestException;
  isLaravel?: boolean;
}

export interface MicrositesDetails extends BaseDetails {
  siteId: string | number;
  formName?: string;
  sessionId?: string | number;
}

export type AppLogDetails = CheckoutDetails | RestDetails | MicrositesDetails;

// --- 4. CORRELATION ---

/**
 * Identificadores que permiten seguir un mismo flujo entre eventos y apps.
 * Todos los campos son opcionales: se rellenan solo cuando el log los trae.
 */
export interface Correlation {
  /** Id de traza: `aws_request_id`, id de Atropos, `messageId` o `requestId`. */
  traceId?: string;
  sessionId?: string;
  transactionId?: string;
  placetopayId?: string;
  reference?: string;
  internalReference?: string;
  provider?: string;
  operation?: string;
  /** `TENANT_DOMAIN`, p.ej. `checkout.placetopay.ec`. */
  tenant?: string;
  tenantId?: string;
  siteId?: string;
  login?: string;
}

// --- 5. OUTCOME ---

/**
 * Resultado de la operación que el evento representa, resuelto por el parser.
 * Los mappers integrados siempre lo rellenan; es opcional para que un
 * integrador pueda construir un `LogEvent` a mano.
 */
export interface Outcome {
  isError: boolean;
  status?: "OK" | "FAILED" | "REJECTED" | "PENDING";
  /**
   * Origen del fallo: excepción de transporte, rechazo de negocio del
   * proveedor, código HTTP, o validación de la petición.
   */
  kind?: "exception" | "business" | "http" | "validation";
  httpStatus?: number;
  /** Código del proveedor (`dinError.codigo`) o el HTTP cuando no hay otro. */
  code?: string;
  message?: string;
  exception?: RestException;
}

// --- 6. FINAL EVENT MODEL ---

export interface LogEvent {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  category: LogCategory;
  appType: AppType;
  details: AppLogDetails;
  context: unknown;
  rawStream?: string;

  /** Epoch ms UTC. Permite ordenar y agrupar sin volver a parsear `timestamp`. */
  ts: number;
  /** Identificadores derivados del log, ya resueltos para el consumidor. */
  correlation: Correlation;
  /** Resultado de la operación, para no re-derivarlo en la capa visual. */
  outcome?: Outcome;

  /**
   * Clave que une la ida y la vuelta de un mismo intercambio. La fija el
   * mapper, que es quien sabe si el registro es petición o respuesta.
   */
  pairKey?: string;
  pairRole?: "request" | "response";
  /** Milisegundos entre la petición y su respuesta; presente en ambas. */
  durationMs?: number;
}
