import { listRadioFavorites, listRadioStations } from '@norstream/app/src/storage/radio.js';
import { getSetting } from '@norstream/app/src/storage/settings.js';
import type { SqlDatabase } from '@norstream/app/src/storage/types.js';
import type { RadioCountry, RadioStation } from '@norstream/app/src/sync/radioBrowser.js';
import { radioCountryName, sortCountries } from '@norstream/app/src/sync/radioBrowser.js';
import { countryFlag } from '@norstream/core';
import { setLibrary } from '../modules/radio-auto/index.js';
import type { AutoLibrary, AutoStation } from '../modules/radio-auto/index.js';

/**
 * Det bilen kan bladre i, skrevet til disken.
 *
 * Favoritterne, og de lande hvis stationer allerede ligger paa telefonen
 * (dem man har aabnet i appen). Tjenesten bag Android Auto henter intet
 * selv; den laeser filen. Kaldes ved start og hver gang man er tilbage
 * paa listen, saa en ny favorit er i bilen naeste gang.
 */
export function toAutoStation(station: RadioStation): AutoStation {
  return { id: station.id, name: station.name, url: station.url, logoUrl: station.logoUrl, country: station.country };
}

export async function buildAutoLibrary(db: SqlDatabase): Promise<AutoLibrary> {
  const favourites = (await listRadioFavorites(db)).map(toAutoStation);
  const cached = await db.getAllAsync<{ country: string }>(
    'SELECT DISTINCT country FROM radio_stations WHERE rank < 100000 ORDER BY country',
  );
  const known = new Map<string, RadioCountry>();
  const stored = await getSetting(db, 'radio_countries');
  if (stored !== null) {
    try {
      for (const entry of JSON.parse(stored) as RadioCountry[]) known.set(entry.code, entry);
    } catch {
      // Uden navne; koden bruges.
    }
  }
  const countries: AutoLibrary['countries'] = [];
  for (const row of cached) {
    const stations = (await listRadioStations(db, row.country)).map(toAutoStation);
    if (stations.length === 0) continue;
    const meta = known.get(row.country);
    countries.push({
      code: row.country,
      name: meta?.name ?? radioCountryName(row.country),
      flag: meta?.flag ?? countryFlag(row.country),
      stations,
    });
  }
  const order = sortCountries(countries.map((c) => ({ code: c.code, name: c.name, flag: c.flag, stations: c.stations.length })));
  countries.sort((a, b) => order.findIndex((o) => o.code === a.code) - order.findIndex((o) => o.code === b.code));
  return { favourites, countries };
}

export async function syncAutoLibrary(db: SqlDatabase): Promise<void> {
  try {
    await setLibrary(await buildAutoLibrary(db));
  } catch {
    // Bilen faar den gamle liste; naeste gang lykkes det.
  }
}
