import { XtreamClient } from '@norstream/core';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { getSetting, setSetting } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';
import { replaceVodCategories, replaceVodItems } from '../storage/vod.js';

/**
 * Henter kildens film- og serielister.
 *
 * Fire kald: kategorier og liste for hver af de to slags. Listerne kan vaere
 * paa tusindvis af poster, men det er ét kald hver — det dyre er det panelet
 * ved om den enkelte titel, og det hentes foerst naar titlen aabnes.
 *
 * Fejler film, hentes serier stadig, og omvendt: et panel uden serier er ikke
 * et panel uden film.
 */
export async function syncVod(
  db: SqlDatabase,
  sourceId: string,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<{ movies: number; series: number }> {
  const client = new XtreamClient(creds, fetchImpl);
  const result = { movies: 0, series: 0 };

  try {
    const [categories, movies] = await Promise.all([
      client.getVodCategories(),
      client.getVodStreams(),
    ]);
    await replaceVodCategories(db, sourceId, 'movie', categories);
    await replaceVodItems(db, sourceId, 'movie', movies);
    result.movies = movies.length;
  } catch {
    // Med vilje: se ovenfor.
  }

  try {
    const [categories, series] = await Promise.all([
      client.getSeriesCategories(),
      client.getSeries(),
    ]);
    await replaceVodCategories(db, sourceId, 'series', categories);
    await replaceVodItems(db, sourceId, 'series', series);
    result.series = series.length;
  } catch {
    // Med vilje.
  }

  await setSetting(db, `last_vod_sync_ms:${sourceId}`, String(now.getTime()));
  return result;
}

export async function getLastVodSyncMs(db: SqlDatabase, sourceId: string): Promise<number | null> {
  const value = await getSetting(db, `last_vod_sync_ms:${sourceId}`);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
