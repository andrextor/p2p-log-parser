import type { Outcome, RestException } from "@/types";

/** Códigos de error de negocio que en realidad significan «sin error». */
const OK_BUSINESS_CODES = new Set(["0", "00", "0000"]);

/** Código HTTP incrustado en el texto de una excepción, p.ej. `` `503` ``. */
const STATUS_IN_TEXT = /`(\d{3})`/;

export interface OutcomeInput {
  /** Contexto del registro de log. */
  context: Record<string, unknown>;
  /** Payload de dominio donde buscar el error de negocio (Atropos, gateway…). */
  payload?: Record<string, unknown>;
  statusCode?: number | string | null;
  message?: string;
  /** `context.type` en Checkout: `request_not_valid`, `checkout.threeDs.process`… */
  subType?: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readException(input: OutcomeInput): RestException | undefined {
  const payload = asRecord(input.payload);
  const raw =
    input.context.exception ??
    payload.exception ??
    asRecord(payload.context).exception;

  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;

  return {
    class: e.class ? String(e.class) : undefined,
    message: e.message ? String(e.message) : undefined,
    file: e.file ? String(e.file) : undefined,
    line: e.line !== undefined ? Number(e.line) : undefined,
  };
}

/**
 * Error de negocio: el proveedor respondió, pero rechazando la operación.
 *
 * Los SDK ecuatorianos (Interdin, Diners) lo emiten como `dinError` con claves
 * en español; el resto usa `error` o el bloque `status` del gateway.
 */
function readBusinessError(
  input: OutcomeInput,
): { code: string; message: string } | undefined {
  const payload = asRecord(input.payload);
  const inner = asRecord(payload.context ?? payload.data);

  const source = asRecord(
    inner.dinError ??
      asRecord(inner.data).dinError ??
      payload.error ??
      asRecord(payload.data).dinError ??
      input.context.error,
  );

  const code = String(source.codigo ?? source.code ?? "");
  if (code && !OK_BUSINESS_CODES.has(code)) {
    return {
      code,
      message: String(
        source.mensaje ??
          source.message ??
          source.detalle ??
          "Failed operation",
      ),
    };
  }

  // Bloque `status` del gateway de Checkout: `{status, reason, message}`.
  const status = asRecord(
    asRecord(asRecord(payload.response).body).status ?? payload.status,
  );
  if (status.status && String(status.status).toUpperCase() !== "OK") {
    return {
      code: String(status.reason ?? status.status),
      message: String(status.message ?? status.status),
    };
  }

  return undefined;
}

function isValidationError(input: OutcomeInput): boolean {
  const exceptionReason = asRecord(input.context.exception).reason;

  return (
    input.subType === "request_not_valid" ||
    exceptionReason === "request_not_valid" ||
    (input.message ?? "").toLowerCase().includes("error validation")
  );
}

/**
 * Resuelve en un solo lugar «¿esto salió bien?», que hasta ahora se decidía por
 * separado en cada mapper y otra vez en la capa visual.
 *
 * El orden importa: una excepción de transporte tapa cualquier otra señal, y un
 * rechazo del proveedor es más informativo que el código HTTP que lo envuelve.
 */
export function resolveOutcome(input: OutcomeInput): Outcome {
  const httpStatus = Number(input.statusCode);
  const hasHttpStatus = Number.isFinite(httpStatus) && httpStatus > 0;

  if (isValidationError(input)) {
    return {
      isError: true,
      status: "REJECTED",
      kind: "validation",
      message: input.message,
    };
  }

  const exception = readException(input);
  if (exception) {
    const inText = (exception.message ?? "").match(STATUS_IN_TEXT);
    return {
      isError: true,
      status: "FAILED",
      kind: "exception",
      code: inText ? inText[1] : undefined,
      message: exception.message,
      httpStatus: hasHttpStatus ? httpStatus : undefined,
      exception,
    };
  }

  const business = readBusinessError(input);
  if (business) {
    return {
      isError: true,
      status: "REJECTED",
      kind: "business",
      code: business.code,
      message: business.message,
      httpStatus: hasHttpStatus ? httpStatus : undefined,
    };
  }

  if (hasHttpStatus && httpStatus >= 400) {
    return {
      isError: true,
      status: "FAILED",
      kind: "http",
      httpStatus,
      code: String(httpStatus),
      message: `HTTP ${httpStatus}`,
    };
  }

  return {
    isError: false,
    status: "OK",
    httpStatus: hasHttpStatus ? httpStatus : undefined,
  };
}
