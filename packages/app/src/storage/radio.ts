import type { RadioStation } from '../sync/radioBrowser.js';
import { displayName, preferBestQuality, sortStationsByPopularity } from '../sync/radioBrowser.js';
import { withTransaction } from './transaction.js';
import type { SqlDatabase } from './types.js';

/** Hvor laenge et lands stationer gaelder, foer de hentes igen. */
export const RADIO_TTL_MS = 7 * 24 * 60 * 60_000;

interface StationRow {
  id: string;
  country: string;
  name: string;
  url: string;
  logo_url: string | null;
  homepage: string | null;
  votes: number;
  codec: string;
  bitrate: number;
  tags: string;
}

function toStation(row: StationRow): RadioStation {
  return {
    id: row.id,
    country: row.country,
    // Ogsaa her, ikke kun ved hentning: raekker fra foer rensningen ligger i
    // cachen i op til en uge.
    name: displayName(row.name),
    url: row.url,
    logoUrl: row.logo_url,
    homepage: row.homepage,
    votes: row.votes,
    codec: row.codec,
    bitrate: row.bitrate,
    tags: row.tags.length === 0 ? [] : row.tags.split(','),
  };
}

/** Erstatter landets stationer med de nye, i den orden de kom. */
export async function saveRadioStations(
  db: SqlDatabase,
  country: string,
  stations: readonly RadioStation[],
  now = Date.now(),
): Promise<void> {
  await withTransaction(db, async () => {
    await db.runAsync('DELETE FROM radio_stations WHERE country = ?', [country]);
    let rank = 0;
    for (const station of stations) {
      await db.runAsync(
        `INSERT OR REPLACE INTO radio_stations
           (id, country, name, url, logo_url, homepage, votes, codec, bitrate, tags, rank, fetched_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          station.id,
          country,
          station.name,
          station.url,
          station.logoUrl,
          station.homepage,
          station.votes,
          station.codec,
          station.bitrate,
          station.tags.join(','),
          rank++,
          now,
        ],
      );
    }
  });
}

/**
 * Landets stationer, én per navn med den bedste stream.
 *
 * Sammenlaegningen sker ogsaa her og ikke kun ved hentningen: de gemte
 * lister gaelder en uge, og uden den stod dubletterne der til den var gaaet.
 */
export async function listRadioStations(db: SqlDatabase, country: string): Promise<RadioStation[]> {
  const rows = await db.getAllAsync<StationRow>(
    'SELECT id, country, name, url, logo_url, homepage, votes, codec, bitrate, tags FROM radio_stations WHERE country = ? ORDER BY rank',
    [country],
  );
  return sortStationsByPopularity(preferBestQuality(rows.map(toStation)));
}

/** Antal stationer per hentet land, efter sammenlaegning — det tal listen faktisk viser. */
export async function countRadioStationsByCountry(db: SqlDatabase): Promise<Map<string, number>> {
  const rows = await db.getAllAsync<{ country: string }>('SELECT DISTINCT country FROM radio_stations WHERE rank < 100000');
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.country, (await listRadioStations(db, row.country)).length);
  return counts;
}

/** Hvornaar landets stationer sidst blev hentet, eller null naar aldrig. */
export async function radioStationsFetchedMs(db: SqlDatabase, country: string): Promise<number | null> {
  const row = await db.getFirstAsync<{ fetched_ms: number | null }>(
    'SELECT MAX(fetched_ms) AS fetched_ms FROM radio_stations WHERE country = ?',
    [country],
  );
  return row?.fetched_ms ?? null;
}

export async function getRadioStation(db: SqlDatabase, id: string): Promise<RadioStation | null> {
  const row = await db.getFirstAsync<StationRow>(
    'SELECT id, country, name, url, logo_url, homepage, votes, codec, bitrate, tags FROM radio_stations WHERE id = ?',
    [id],
  );
  return row === null || row === undefined ? null : toStation(row);
}

export async function setRadioFavorite(db: SqlDatabase, stationId: string, favorite: boolean): Promise<void> {
  if (!favorite) {
    await db.runAsync('DELETE FROM radio_favorites WHERE station_id = ?', [stationId]);
    return;
  }
  const row = await db.getFirstAsync<{ next: number | null }>('SELECT MAX(position) + 1 AS next FROM radio_favorites');
  await db.runAsync('INSERT OR IGNORE INTO radio_favorites (station_id, position) VALUES (?, ?)', [
    stationId,
    row?.next ?? 0,
  ]);
}

/**
 * Flytter en favorit én plads op (-1) eller ned (+1) i brugerens orden.
 *
 * Positionerne skrives om til 0,1,2 … efter flytningen, saa der ikke opstaar
 * huller. Bytter bare med naboen; er der ingen nabo, sker intet.
 */
export async function moveRadioFavorite(db: SqlDatabase, stationId: string, direction: -1 | 1): Promise<void> {
  const rows = await db.getAllAsync<{ station_id: string }>('SELECT station_id FROM radio_favorites ORDER BY position');
  const ids = rows.map((row) => row.station_id);
  const from = ids.indexOf(stationId);
  if (from === -1) return;
  const to = from + direction;
  if (to < 0 || to >= ids.length) return;
  [ids[from], ids[to]] = [ids[to]!, ids[from]!];
  for (let position = 0; position < ids.length; position += 1) {
    await db.runAsync('UPDATE radio_favorites SET position = ? WHERE station_id = ?', [position, ids[position]!]);
  }
}

export async function listRadioFavoriteIds(db: SqlDatabase): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ station_id: string }>('SELECT station_id FROM radio_favorites');
  return new Set(rows.map((row) => row.station_id));
}

/** Favoritstationerne i valgt orden. En station der ikke laengere er gemt, springes over. */
export async function listRadioFavorites(db: SqlDatabase): Promise<RadioStation[]> {
  const rows = await db.getAllAsync<StationRow>(
    `SELECT s.id, s.country, s.name, s.url, s.logo_url, s.homepage, s.votes, s.codec, s.bitrate, s.tags
     FROM radio_favorites f
     JOIN radio_stations s ON s.id = f.station_id
     ORDER BY f.position`,
  );
  return rows.map(toStation);
}

/**
 * Gemmer en station der kom fra en soegning, saa den kan vaere favorit
 * uden at hele landet er hentet. Roerer ikke landets liste.
 */
export async function rememberRadioStation(db: SqlDatabase, station: RadioStation, now = Date.now()): Promise<void> {
  const known = await getRadioStation(db, station.id);
  if (known !== null) return;
  await db.runAsync(
    `INSERT INTO radio_stations
       (id, country, name, url, logo_url, homepage, votes, codec, bitrate, tags, rank, fetched_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100000, ?)`,
    [
      station.id,
      station.country,
      station.name,
      station.url,
      station.logoUrl,
      station.homepage,
      station.votes,
      station.codec,
      station.bitrate,
      station.tags.join(','),
      now,
    ],
  );
}
