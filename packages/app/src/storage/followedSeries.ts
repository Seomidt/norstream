import { getVodItem } from './vod.js';
import type { StoredVodItem } from './vod.js';
import type { SqlDatabase } from './types.js';

/**
 * Serier man foelger. Forsiden viser dem der har faaet nye afsnit siden
 * man sidst saa deres side: antallet af afsnit i databasen mod det antal
 * man har set listen med.
 */
export interface FollowedSeries {
  series: StoredVodItem;
  followedMs: number;
  seenEpisodes: number;
  episodes: number;
}

export async function followSeries(db: SqlDatabase, seriesKey: string, now = Date.now()): Promise<void> {
  const count = await episodeCount(db, seriesKey);
  await db.runAsync(
    'INSERT OR REPLACE INTO followed_series (series_key, followed_ms, seen_episodes) VALUES (?, ?, ?)',
    [seriesKey, now, count],
  );
}

export async function unfollowSeries(db: SqlDatabase, seriesKey: string): Promise<void> {
  await db.runAsync('DELETE FROM followed_series WHERE series_key = ?', [seriesKey]);
}

export async function isFollowed(db: SqlDatabase, seriesKey: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM followed_series WHERE series_key = ?', [seriesKey]);
  return (row?.n ?? 0) > 0;
}

/** Listen er set: det der er nu, er ikke nyt laengere. */
export async function markSeriesSeen(db: SqlDatabase, seriesKey: string): Promise<void> {
  const count = await episodeCount(db, seriesKey);
  await db.runAsync('UPDATE followed_series SET seen_episodes = ? WHERE series_key = ?', [count, seriesKey]);
}

export async function listFollowedSeriesKeys(db: SqlDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ series_key: string }>('SELECT series_key FROM followed_series ORDER BY followed_ms DESC');
  return rows.map((row) => row.series_key);
}

/** De fulgte serier, dem med nye afsnit foerst. Serier der ikke findes laengere springes over. */
export async function listFollowedSeries(db: SqlDatabase): Promise<FollowedSeries[]> {
  const rows = await db.getAllAsync<{ series_key: string; followed_ms: number; seen_episodes: number; episodes: number }>(
    `SELECT f.series_key, f.followed_ms, f.seen_episodes,
            (SELECT COUNT(*) FROM episodes e WHERE e.series_key = f.series_key) AS episodes
     FROM followed_series f
     ORDER BY (episodes > f.seen_episodes) DESC, f.followed_ms DESC`,
  );
  const out: FollowedSeries[] = [];
  for (const row of rows) {
    const series = await getVodItem(db, row.series_key);
    if (series === null) continue;
    out.push({ series, followedMs: row.followed_ms, seenEpisodes: row.seen_episodes, episodes: row.episodes });
  }
  return out;
}

async function episodeCount(db: SqlDatabase, seriesKey: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM episodes WHERE series_key = ?', [seriesKey]);
  return row?.n ?? 0;
}
