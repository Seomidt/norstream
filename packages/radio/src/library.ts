import { listRadioFavorites, listRadioStations, rememberRadioStation, setRadioFavorite } from '@norstream/app/src/storage/radio.js';
import { getSetting } from '@norstream/app/src/storage/settings.js';
import type { SqlDatabase } from '@norstream/app/src/storage/types.js';
import type { RadioCountry, RadioStation } from '@norstream/app/src/sync/radioBrowser.js';
import { radioCountryName, radioLogoUrls } from '@norstream/app/src/sync/radioBrowser.js';
import { countryFlag } from '@norstream/core';
import { clearPendingFavourites, clearPendingSongs, pendingFavourites, pendingSongs, setLibrary } from '../modules/radio-auto/index.js';
import { saveSong } from '@norstream/app/src/storage/savedSongs.js';
import { withAllCountries } from './countries.js';
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
  const logoUrls = radioLogoUrls(station);
  return { id: station.id, name: station.name, url: station.url, logoUrl: logoUrls[0] ?? null, logoUrls, country: station.country };
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
  return { favourites, countries: withAllCountries(countries, [...known.values()]) };
}

/**
 * Favoritter slaaet til eller fra i bilen foeres ind i databasen. Svarer
 * med om noget aendrede sig, saa listen kan laeses igen.
 */
export async function applyCarFavourites(db: SqlDatabase): Promise<boolean> {
  const pending = pendingFavourites();
  if (pending.length === 0) return false;
  for (const entry of pending) {
    if (entry.on) {
      await rememberRadioStation(db, {
        id: entry.id,
        name: entry.name,
        country: entry.country,
        url: entry.url,
        logoUrl: entry.logoUrls[0] ?? null,
        homepage: null,
        votes: 0,
        codec: '',
        bitrate: 0,
        tags: [],
      });
    }
    await setRadioFavorite(db, entry.id, entry.on);
  }
  clearPendingFavourites();
  return true;
}

/**
 * Sange gemt med bogmaerket i bilen foeres ind i databasen. Svarer med om
 * der kom nogen, saa listen kan laeses igen.
 */
export async function applyCarSongs(db: SqlDatabase): Promise<boolean> {
  const pending = pendingSongs();
  if (pending.length === 0) return false;
  for (const entry of pending) {
    await saveSong(db, { artist: entry.artist, track: entry.track, station: entry.station }, entry.savedMs);
  }
  clearPendingSongs();
  return true;
}

export async function syncAutoLibrary(db: SqlDatabase): Promise<void> {
  try {
    await applyCarFavourites(db);
    await setLibrary(await buildAutoLibrary(db));
  } catch {
    // Bilen faar den gamle liste; naeste gang lykkes det.
  }
}
