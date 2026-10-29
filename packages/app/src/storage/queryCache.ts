/**
 * En lille cache i hukommelsen for RENE opslag der kun aendrer sig ved en synk
 * (lande, kategorier, VOD-lister). Fane-skift afmonterer skaermene og tvinger
 * dem til at slaa alt op forfra; med den her henter en revisit fra hukommelsen i
 * stedet — uden at roere fokus eller panelets ene forbindelse (derfor en cache
 * og ikke "hold skaermen i live", som ville bryde begge dele paa tv).
 *
 * Gyldigheden foelger et epoke-tal: naar kanaler/VOD hentes forfra, eller
 * brugeren skjuler/viser et land, hoppes epoken og alt gammelt kasseres.
 */
let epoch = 0;
const cache = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();

/** Faelles revision til afledte snapshots af kanal- og katalogdata. */
export function queryCacheRevision(): number { return epoch; }

/** Kaster alt cachet vaek. Kaldes naar de underliggende data er aendret. */
export function invalidateQueryCache(): void {
  epoch += 1;
  cache.clear();
}

/**
 * Henter fra cachen, eller koerer `load` og gemmer resultatet — som et loefte,
 * saa to samtidige kald deler ét opslag (det halverer ogsaa dobbelt-loads).
 * Fejler `load`, kastes den vaek igen, saa naeste kald proever forfra.
 */
export async function cachedQuery<T>(key: string, load: () => Promise<T>, maxAgeMs = Infinity): Promise<T> {
  const full = `${epoch}:${key}`;
  const hit = cache.get(full);
  if (hit !== undefined && Date.now() < hit.expiresAt) return hit.promise as Promise<T>;
  const promise = load();
  const entry = { promise, expiresAt: Date.now() + Math.max(0, maxAgeMs) };
  cache.set(full, entry);
  try {
    return (await promise) as T;
  } catch (cause) {
    if (cache.get(full) === entry) cache.delete(full);
    throw cause;
  }
}
