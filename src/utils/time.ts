/**
 * Offset con el que se emiten los logs de producción de Placetopay.
 * Solo se aplica a marcas de tiempo que no traen offset propio (logs locales
 * de Laravel). Es un parámetro, no una constante rígida: si algún día llegan
 * exports de otra zona, se pasa explícitamente.
 */
export const DEFAULT_TZ_OFFSET = "-05:00";

/** `YYYY-MM-DD HH:mm:ss[.uuuuuu]` o su variante con `T`, siempre sin offset. */
const NAIVE_DATETIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/** Offset recortado a horas (`-05`), que `Date.parse` no acepta. */
const SHORT_OFFSET = /[+-]\d{2}$/;

/**
 * Convierte una marca de tiempo de log a epoch ms.
 *
 * Resuelve dos casos que `Date.parse` falla o resuelve de forma no determinista:
 * - `2025-12-28 22:14:01` — sin offset, `Date.parse` usa la zona de la máquina.
 * - `2025-12-28T22:14:01.362-05` — offset sin minutos, `Date.parse` da `NaN`.
 *
 * Devuelve `NaN` cuando no hay forma de interpretar el valor.
 */
export function toEpochMs(
  raw: string | number | null | undefined,
  offset: string = DEFAULT_TZ_OFFSET,
): number {
  if (raw === null || raw === undefined) return Number.NaN;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : Number.NaN;

  const value = raw.trim();
  if (!value) return Number.NaN;

  const naive = value.match(NAIVE_DATETIME);
  if (naive) return Date.parse(`${naive[1]}T${naive[2]}${offset}`);

  if (value.includes("T") && SHORT_OFFSET.test(value)) {
    return Date.parse(`${value}:00`);
  }

  return Date.parse(value);
}
