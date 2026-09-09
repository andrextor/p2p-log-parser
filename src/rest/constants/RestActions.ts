import type { LogCategory } from "@/types";

export interface RestActionDetail {
  message: string;
  category: LogCategory;
  source: "BACKEND";
}

/**
 * Fragmentos de mensajes de log de la aplicación Laravel (`rest-services`).
 *
 * Ojo: estas claves son **texto de mensajes**, no operaciones de SDK. Las
 * operaciones viven en `RestOperations.ts`; mezclarlas en un solo mapa provocaba
 * colisiones entre un `operation` y un fragmento de mensaje homónimo.
 */
export const DEFAULT_REST_ACTION_MAP: Record<string, RestActionDetail> = {
  "no bin information": {
    message: "BIN information not found",
    category: "BACKEND_LOG",
    source: "BACKEND",
  },
  "Error resolving credit types": {
    message: "Failed resolving credit types",
    category: "ERROR",
    source: "BACKEND",
  },
  "Sending SMS": {
    message: "SMS Messaging Management",
    category: "NOTIFICATION",
    source: "BACKEND",
  },
  "loading invoices": {
    message: "Invoice Processing",
    category: "BACKEND_LOG",
    source: "BACKEND",
  },
};

export function mergeRestActions(
  custom: Record<string, RestActionDetail>,
): Record<string, RestActionDetail> {
  return { ...DEFAULT_REST_ACTION_MAP, ...custom };
}

/** Busca el primer fragmento conocido contenido en el mensaje. */
export function findRestAction(
  message: string,
  actionMap: Record<string, RestActionDetail>,
): RestActionDetail | null {
  const haystack = message.toLowerCase();
  for (const [fragment, detail] of Object.entries(actionMap)) {
    if (haystack.includes(fragment.toLowerCase())) return detail;
  }
  return null;
}
