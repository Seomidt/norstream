import type { RadioCountry } from '@norstream/app/src/sync/radioBrowser.js';
import { sortCountries } from '@norstream/app/src/sync/radioBrowser.js';
import type { AutoLibrary } from '../modules/radio-auto/index.js';

/**
 * Alle lande telefonen kender, ikke kun dem der er hentet.
 *
 * Landene med stationer paa telefonen beholder dem; de andre kommer med
 * uden stationer, og tjenesten bag bilen henter dem selv fra Radio Browser
 * naar bilen aabner landet. Foer stod kun de aabnede lande i bilen.
 * Raekkefoelgen er den samme som paa telefonen: Norden foerst, saa flest
 * stationer.
 */
export function withAllCountries(
  cached: AutoLibrary['countries'],
  known: readonly RadioCountry[],
): AutoLibrary['countries'] {
  const byCode = new Map(cached.map((c) => [c.code, c]));
  for (const country of known) {
    if (!byCode.has(country.code)) byCode.set(country.code, { code: country.code, name: country.name, flag: country.flag, stations: [] });
  }
  const order = sortCountries(
    [...byCode.values()].map((c) => ({
      code: c.code,
      name: c.name,
      flag: c.flag,
      stations: Math.max(c.stations.length, known.find((k) => k.code === c.code)?.stations ?? 0),
    })),
  );
  return order.map((o) => byCode.get(o.code)).filter((c): c is AutoLibrary['countries'][number] => c !== undefined);
}
