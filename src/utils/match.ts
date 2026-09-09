import type { LogEvent } from "@/types";

/**
 * Decide si un evento pertenece a la traza que se está siguiendo.
 *
 * Antes cada mapper traía su propia versión de esto —y ninguna se llamaba,
 * porque el motor no las usaba—, así que la capa visual acababa reescribiéndolo
 * con su propia lista de rutas donde buscar. Con `correlation` ya resuelta, la
 * comparación es una sola: el id del evento, cualquiera de sus identificadores
 * de correlación, o la clave del intercambio.
 */
export function matchEvent(
  event: LogEvent,
  targetId: string | number,
): boolean {
  const target = String(targetId).trim().toLowerCase();
  if (!target) return false;

  if (event.id.toLowerCase() === target) return true;
  if (event.pairKey?.toLowerCase() === target) return true;

  for (const value of Object.values(event.correlation)) {
    if (value !== undefined && String(value).toLowerCase() === target) {
      return true;
    }
  }

  return false;
}
