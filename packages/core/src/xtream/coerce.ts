/**
 * Fælles talkonvertering for rå Xtream-JSON. Interngt modul — eksporteres
 * ikke fra pakkens offentlige API.
 */

/** Fortolker en rå JSON-værdi som et heltal. Returnerer null hvis værdien ikke er et endeligt tal. */
export function toInteger(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Fortolker en rå JSON-værdi som et boolsk flag, hvor kun værdien 1
 * (som tal eller numerisk streng) regnes for sand. Typechecker værdien
 * før konvertering, så fx `true` eller `[1]` — som `Number(...)` ellers
 * ville coerce til 1 — korrekt afvises som ikke-sande.
 */
export function truthyFlag(value: unknown): boolean {
  return toInteger(value) === 1;
}
