import type { LogCategory } from "@/types";

/**
 * Fase de un log de Checkout, deducida del prefijo `«{sujeto} trace:»`.
 *
 * El equipo de `redirection` usa esa convención de forma consistente: ocho
 * sujetos cubren más de cuarenta mensajes distintos. Clasificar por el prefijo
 * es determinista, mientras que adivinar la categoría por palabras sueltas del
 * mensaje («update», «save», «db») fallaba en cuanto cambiaba la redacción.
 */
export interface TracePhase {
  label: string;
  category: LogCategory;
}

export const CHECKOUT_TRACE_PHASES: Record<string, TracePhase> = {
  Session: { label: "Session", category: "BACKEND_LOG" },
  "Get session": { label: "Session query", category: "BACKEND_LOG" },
  "Define session": { label: "Session definition", category: "DB_OP" },
  "Update session state": { label: "Session state update", category: "DB_OP" },
  "Update transaction": { label: "Transaction update", category: "DB_OP" },
  "Notify session": { label: "Session notification", category: "NOTIFICATION" },
  "Transaction notification": {
    label: "Transaction notification",
    category: "NOTIFICATION",
  },
  "Session expires": { label: "Session expiration", category: "BACKEND_LOG" },
};

const TRACE_MESSAGE = /^([A-Z][A-Za-z ]*?) trace:\s*(.+)$/;

export interface TraceParts {
  phase: string;
  step: string;
  category: LogCategory;
}

/** Separa `«Update transaction trace: Transaction resolved»` en fase y paso. */
export function readTracePhase(message: string): TraceParts | null {
  const match = message.match(TRACE_MESSAGE);
  if (!match) return null;

  const known = CHECKOUT_TRACE_PHASES[match[1]];
  return {
    phase: known?.label ?? match[1],
    step: match[2].trim(),
    category: known?.category ?? "BACKEND_LOG",
  };
}
