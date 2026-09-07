import { deriveCountryLoose } from '@norstream/core';
import type { Category, Country, Episode, VodDetails, VodItem, VodKind } from '@norstream/core';
import { channelKey } from '@norstream/core';
import { originOf } from '@norstream/core';
import { OTHER_COUNTRY_FLAG, OTHER_COUNTRY_KEY } from './countries.js';
import { deadLogoOrigins } from './logoHosts.js';
import type { CountryGroup } from './countries.js';
import type { SqlDatabase, SqlValue } from './types.js';

/**
 * Film og serier i databasen.
 *
 * Samme moenster som kanalerne: listen hentes én gang i doegnet per kilde og
 * ligger her, saa skaermene tegner fra databasen og ikke fra panelet. Det
 * panelet ved om den **enkelte** titel — handling, rolleliste, trailer,
 * afsnit — hentes foerst naar titlen aabnes, og gemmes saa den ikke skal
 * hentes igen naeste gang.
 */

export interface StoredVodItem extends VodItem {
  /** Den sammensatte noegle, `<kilde>:<id>`. `id` er panelets eget. */
  key: string;
  sourceId: string;
  categoryName: string | null;
  inWatchlist: boolean;
  /** Hvor langt man er naaet, i sekunder, eller null naar man ikke er begyndt. */
  positionSeconds: number | null;
  durationSeconds: number | null;
}

export interface VodCategorySummary {
  id: string;
  name: string;
  kind: VodKind;
  itemCount: number;
  countryKey: string;
  country: Country | null;
}

/** Hvor laenge det panelet ved om en titel gaelder foer det hentes igen. */
export const DETAILS_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

interface ItemRow {
  key: string;
  source_id: string;
  item_id: string;
  kind: string;
  name: string;
  poster_url: string | null;
  category_id: string | null;
  category_name: string | null;
  rating: number | null;
  year: number | null;
  added_ms: number | null;
  container_ext: string | null;
  in_watchlist: number | null;
  position_s: number | null;
  duration_s: number | null;
}

function toStored(row: ItemRow): StoredVodItem {
  return {
    key: row.key,
    sourceId: row.source_id,
    id: row.item_id,
    kind: row.kind === 'series' ? 'series' : 'movie',
    name: row.name,
    posterUrl: row.poster_url,
    categoryId: row.category_id,
    categoryName: row.category_name,
    rating: row.rating,
    year: row.year,
    added: row.added_ms === null ? null : new Date(row.added_ms),
    containerExtension: row.container_ext,
    inWatchlist: row.in_watchlist === 1,
    positionSeconds: row.position_s,
    durationSeconds: row.duration_s,
  };
}

const SELECT_ITEM = `
  SELECT i.key, i.source_id, i.item_id, i.kind, i.name, i.poster_url, i.category_id,
         c.name AS category_name, i.rating, i.year, i.added_ms, i.container_ext,
         CASE WHEN w.item_key IS NOT NULL THEN 1 ELSE NULL END AS in_watchlist,
         p.position_s, p.duration_s
  FROM vod_items i
  LEFT JOIN vod_categories c ON c.id = i.category_id
  LEFT JOIN vod_watchlist w ON w.item_key = i.key
  LEFT JOIN vod_progress p ON p.item_key = i.key`;

/** Hvor mange raekker der skrives per saetning. 999 variabler er graensen; 12 per raekke. */
const BATCH = 80;

/**
 * Erstatter **denne kildes** kategorier af den ene slags. De andres bliver staaende.
 */
export async function replaceVodCategories(
  db: SqlDatabase,
  sourceId: string,
  kind: VodKind,
  categories: readonly Category[],
): Promise<void> {
  await db.runAsync('DELETE FROM vod_categories WHERE source_id = ? AND kind = ?', [
    sourceId,
    kind,
  ]);
  for (const category of categories) {
    await db.runAsync(
      'INSERT INTO vod_categories (id, source_id, kind, name) VALUES (?, ?, ?, ?)',
      [channelKey(sourceId, `${kind}-${category.id}`), sourceId, kind, category.name],
    );
  }
}

/**
 * Skriver kildens film eller serier ind, i store slurke.
 *
 * Et panel har let ti tusind film. Med ét kald per raekke er det ti tusind
 * ture over broen til SQLite — se registret, hvor det samme kostede
 * minutter. Én transaktion, ottti raekker per saetning.
 */
export async function replaceVodItems(
  db: SqlDatabase,
  sourceId: string,
  kind: VodKind,
  items: readonly VodItem[],
): Promise<void> {
  await db.execAsync('BEGIN');
  try {
    await db.runAsync('DELETE FROM vod_items WHERE source_id = ? AND kind = ?', [sourceId, kind]);
    for (let index = 0; index < items.length; index += BATCH) {
      const slice = items.slice(index, index + BATCH);
      const values = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const params: SqlValue[] = [];
      slice.forEach((item, offset) => {
        params.push(
          channelKey(sourceId, `${kind}-${item.id}`),
          sourceId,
          item.id,
          kind,
          item.name,
          item.posterUrl,
          item.categoryId === null ? null : channelKey(sourceId, `${kind}-${item.categoryId}`),
          item.rating,
          item.year,
          item.added === null ? null : item.added.getTime(),
          item.containerExtension,
          index + offset,
        );
      });
      await db.runAsync(
        `INSERT OR REPLACE INTO vod_items
           (key, source_id, item_id, kind, name, poster_url, category_id, rating, year,
            added_ms, container_ext, sort_order)
         VALUES ${values}`,
        params,
      );
    }
    await db.execAsync('COMMIT');
  } catch (cause) {
    await db.execAsync('ROLLBACK').catch(() => undefined);
    throw cause;
  }
}

/** Alle kategorier af den ene slags, med antal og udledt land, i ét opslag. */
export async function listVodCategorySummaries(
  db: SqlDatabase,
  kind: VodKind,
): Promise<VodCategorySummary[]> {
  const rows = await db.getAllAsync<{ id: string; name: string; item_count: number }>(
    `SELECT c.id, c.name, COUNT(i.key) AS item_count
     FROM vod_categories c
     LEFT JOIN vod_items i ON i.category_id = c.id
     WHERE c.kind = ?
     GROUP BY c.id, c.name
     ORDER BY c.name`,
    [kind],
  );
  return rows.map((row) => {
    // Kun kategorinavnet. Kanalerne kan ogsaa spoerge kanalnavnene — `DNK|
    // DR1` — men en filmtitel siger ikke hvilket land panelet har lagt den
    // under.
    const country = deriveCountryLoose(row.name);
    return {
      id: row.id,
      name: row.name,
      kind,
      itemCount: row.item_count,
      countryKey: country?.code ?? OTHER_COUNTRY_KEY,
      country,
    };
  });
}

/** Landene man kan browse film eller serier i. Samme form som kanalernes. */
export async function listVodCountryGroups(db: SqlDatabase, kind: VodKind): Promise<CountryGroup[]> {
  const summaries = await listVodCategorySummaries(db, kind);
  const groups = new Map<string, CountryGroup>();
  for (const summary of summaries) {
    let group = groups.get(summary.countryKey);
    if (group === undefined) {
      group = {
        key: summary.countryKey,
        name: summary.country?.name ?? 'Øvrige',
        flag: summary.country?.flag ?? OTHER_COUNTRY_FLAG,
        categoryCount: 0,
        channelCount: 0,
      };
      groups.set(summary.countryKey, group);
    }
    group.categoryCount += 1;
    group.channelCount += summary.itemCount;
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === OTHER_COUNTRY_KEY) return 1;
    if (b.key === OTHER_COUNTRY_KEY) return -1;
    return a.name.localeCompare(b.name, 'da');
  });
}

export async function listVodCategoriesInCountry(
  db: SqlDatabase,
  kind: VodKind,
  countryKey: string,
): Promise<VodCategorySummary[]> {
  return (await listVodCategorySummaries(db, kind)).filter(
    (summary) => summary.countryKey === countryKey,
  );
}

export async function listVodItems(
  db: SqlDatabase,
  opts: {
    kind?: VodKind;
    categoryId?: string;
    search?: string;
    watchlistOnly?: boolean;
    /** Kun titler man er begyndt paa og ikke har set faerdig. */
    inProgressOnly?: boolean;
    /** Nyeste foerst, efter hvornaar panelet lagde dem op. */
    newestFirst?: boolean;
    limit?: number;
  } = {},
): Promise<StoredVodItem[]> {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (opts.kind !== undefined) {
    where.push('i.kind = ?');
    params.push(opts.kind);
  }
  if (opts.categoryId !== undefined) {
    where.push('i.category_id = ?');
    params.push(opts.categoryId);
  }
  const search = opts.search?.trim() ?? '';
  if (search.length > 0) {
    where.push("i.name LIKE ? ESCAPE '\\'");
    params.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (opts.watchlistOnly === true) where.push('w.item_key IS NOT NULL');
  if (opts.inProgressOnly === true) {
    // Set faerdig = de sidste par procent. Rulleteksterne taeller ikke.
    where.push('p.position_s IS NOT NULL AND p.position_s > 60');
    where.push('(p.duration_s IS NULL OR p.position_s < p.duration_s * 0.95)');
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const order = opts.newestFirst === true
    ? 'ORDER BY i.added_ms DESC, i.sort_order'
    : opts.inProgressOnly === true
      ? 'ORDER BY p.updated_ms DESC'
      : 'ORDER BY i.sort_order';
  let limit = '';
  if (opts.limit !== undefined) {
    limit = 'LIMIT ?';
    params.push(Math.max(1, Math.trunc(opts.limit)));
  }
  const rows = await db.getAllAsync<ItemRow>(`${SELECT_ITEM} ${clause} ${order} ${limit}`, params);
  const dead = await deadLogoOrigins(db);
  return rows.map((row) => withoutDeadPoster(toStored(row), dead));
}

export async function getVodItem(db: SqlDatabase, key: string): Promise<StoredVodItem | null> {
  const row = await db.getFirstAsync<ItemRow>(`${SELECT_ITEM} WHERE i.key = ?`, [key]);
  if (!row) return null;
  return withoutDeadPoster(toStored(row), await deadLogoOrigins(db));
}

/**
 * Plakaten tages ud naar dens vaert er maalt doed.
 *
 * Samme grund som for kanallogoerne: en vaert uden rute fejler ikke, den
 * svarer aldrig, og `Image` staar og venter i stedet for at vise titlen.
 * Brugerens panel oplyser plakater paa den samme doede vaert som logoerne.
 */
function withoutDeadPoster(item: StoredVodItem, dead: ReadonlySet<string>): StoredVodItem {
  if (item.posterUrl === null || dead.size === 0) return item;
  const origin = originOf(item.posterUrl);
  if (origin === null || !dead.has(origin)) return item;
  return { ...item, posterUrl: null };
}

/**
 * Bytter listens plakat ud med opslagets naar listens ikke kan bruges.
 *
 * Listen peger paa panelets egen vaert; opslaget peger tit paa en
 * billeddatabase. Er panelets vaert doed, er opslagets adresse den eneste
 * der tegner noget — og den er der foerst naar titlen er aabnet én gang.
 */
export async function adoptDetailsPoster(
  db: SqlDatabase,
  key: string,
  posterUrl: string | null,
): Promise<void> {
  if (posterUrl === null) return;
  const row = await db.getFirstAsync<{ poster_url: string | null }>(
    'SELECT poster_url FROM vod_items WHERE key = ?',
    [key],
  );
  if (!row) return;
  const current = row.poster_url ?? '';
  let replace = current.length === 0;
  if (!replace) {
    const origin = originOf(current);
    replace = origin !== null && (await deadLogoOrigins(db)).has(origin);
  }
  if (replace) await db.runAsync('UPDATE vod_items SET poster_url = ? WHERE key = ?', [posterUrl, key]);
}

interface DetailsRow {
  poster_url: string | null;
  plot: string | null;
  genre: string | null;
  cast: string | null;
  director: string | null;
  duration_min: number | null;
  trailer_id: string | null;
  backdrop_url: string | null;
  rating: number | null;
  year: number | null;
  fetched_ms: number;
}

export async function getVodDetails(
  db: SqlDatabase,
  key: string,
): Promise<{ details: VodDetails; fetchedAt: Date } | null> {
  const row = await db.getFirstAsync<DetailsRow>(
    'SELECT * FROM vod_details WHERE item_key = ?',
    [key],
  );
  if (!row) return null;
  return {
    details: {
      posterUrl: row.poster_url,
      plot: row.plot,
      genre: row.genre,
      cast: row.cast,
      director: row.director,
      durationMinutes: row.duration_min,
      trailerId: row.trailer_id,
      backdropUrl: row.backdrop_url,
      rating: row.rating,
      year: row.year,
    },
    fetchedAt: new Date(row.fetched_ms),
  };
}

export async function saveVodDetails(
  db: SqlDatabase,
  key: string,
  details: VodDetails,
  now: Date = new Date(),
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO vod_details
       (item_key, poster_url, plot, genre, cast, director, duration_min, trailer_id,
        backdrop_url, rating, year, fetched_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      key,
      details.posterUrl,
      details.plot,
      details.genre,
      details.cast,
      details.director,
      details.durationMinutes,
      details.trailerId,
      details.backdropUrl,
      details.rating,
      details.year,
      now.getTime(),
    ],
  );
}

export async function replaceEpisodes(
  db: SqlDatabase,
  seriesKey: string,
  episodes: readonly Episode[],
): Promise<void> {
  await db.runAsync('DELETE FROM episodes WHERE series_key = ?', [seriesKey]);
  for (const episode of episodes) {
    await db.runAsync(
      `INSERT OR REPLACE INTO episodes
         (key, series_key, episode_id, season, episode, title, plot, duration_min,
          container_ext, air_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${seriesKey}:${episode.id}`,
        seriesKey,
        episode.id,
        episode.season,
        episode.episode,
        episode.title,
        episode.plot,
        episode.durationMinutes,
        episode.containerExtension,
        episode.airDate,
      ],
    );
  }
}

export interface StoredEpisode extends Episode {
  key: string;
  positionSeconds: number | null;
  durationSeconds: number | null;
}

export async function listEpisodes(db: SqlDatabase, seriesKey: string): Promise<StoredEpisode[]> {
  const rows = await db.getAllAsync<{
    key: string;
    episode_id: string;
    season: number;
    episode: number;
    title: string;
    plot: string | null;
    duration_min: number | null;
    container_ext: string | null;
    air_date: string | null;
    position_s: number | null;
    duration_s: number | null;
  }>(
    `SELECT e.*, p.position_s, p.duration_s
     FROM episodes e
     LEFT JOIN vod_progress p ON p.item_key = e.key
     WHERE e.series_key = ?
     ORDER BY e.season, e.episode`,
    [seriesKey],
  );
  return rows.map((row) => ({
    key: row.key,
    id: row.episode_id,
    seriesId: seriesKey,
    season: row.season,
    episode: row.episode,
    title: row.title,
    plot: row.plot,
    durationMinutes: row.duration_min,
    containerExtension: row.container_ext,
    airDate: row.air_date,
    positionSeconds: row.position_s,
    durationSeconds: row.duration_s,
  }));
}

/** Min liste: det brugeren selv har lagt til side. */
export async function setInWatchlist(
  db: SqlDatabase,
  key: string,
  inWatchlist: boolean,
  now: Date = new Date(),
): Promise<void> {
  if (inWatchlist) {
    await db.runAsync('INSERT OR IGNORE INTO vod_watchlist (item_key, added_ms) VALUES (?, ?)', [
      key,
      now.getTime(),
    ]);
  } else {
    await db.runAsync('DELETE FROM vod_watchlist WHERE item_key = ?', [key]);
  }
}

/**
 * Hvor langt man er naaet i en titel eller et afsnit.
 *
 * Skrives loebende under afspilningen, saa "Fortsaet" ved hvor den skal
 * begynde. Under et minut gemmes ikke: et tryk paa den forkerte film skal ikke
 * lande i "Fortsaet".
 */
export async function saveProgress(
  db: SqlDatabase,
  key: string,
  positionSeconds: number,
  durationSeconds: number | null,
  now: Date = new Date(),
): Promise<void> {
  if (positionSeconds < 60) return;
  await db.runAsync(
    `INSERT INTO vod_progress (item_key, position_s, duration_s, updated_ms)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(item_key) DO UPDATE SET
       position_s = excluded.position_s,
       duration_s = excluded.duration_s,
       updated_ms = excluded.updated_ms`,
    [key, Math.trunc(positionSeconds), durationSeconds === null ? null : Math.trunc(durationSeconds), now.getTime()],
  );
}

export async function getProgress(
  db: SqlDatabase,
  key: string,
): Promise<{ positionSeconds: number; durationSeconds: number | null } | null> {
  const row = await db.getFirstAsync<{ position_s: number; duration_s: number | null }>(
    'SELECT position_s, duration_s FROM vod_progress WHERE item_key = ?',
    [key],
  );
  return row ? { positionSeconds: row.position_s, durationSeconds: row.duration_s } : null;
}

/** Ryd kildens film, serier og alt der haenger paa dem. Til `deleteSource`. */
export async function deleteVodForSource(db: SqlDatabase, sourceId: string): Promise<void> {
  const prefix = `${sourceId}:%`;
  await db.runAsync("DELETE FROM vod_progress WHERE item_key LIKE ? ESCAPE '\\'", [prefix]);
  await db.runAsync("DELETE FROM vod_watchlist WHERE item_key LIKE ? ESCAPE '\\'", [prefix]);
  await db.runAsync("DELETE FROM vod_details WHERE item_key LIKE ? ESCAPE '\\'", [prefix]);
  await db.runAsync("DELETE FROM episodes WHERE series_key LIKE ? ESCAPE '\\'", [prefix]);
  await db.runAsync('DELETE FROM vod_items WHERE source_id = ?', [sourceId]);
  await db.runAsync('DELETE FROM vod_categories WHERE source_id = ?', [sourceId]);
}

/** Hvor mange film og serier der ligger i databasen. Til indstillinger. */
export async function vodCounts(db: SqlDatabase): Promise<{ movies: number; series: number }> {
  const row = await db.getFirstAsync<{ movies: number; series: number }>(
    `SELECT SUM(CASE WHEN kind = 'movie' THEN 1 ELSE 0 END) AS movies,
            SUM(CASE WHEN kind = 'series' THEN 1 ELSE 0 END) AS series
     FROM vod_items`,
  );
  return { movies: row?.movies ?? 0, series: row?.series ?? 0 };
}
