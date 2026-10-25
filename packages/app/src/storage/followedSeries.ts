import { getVodItem } from './vod.js';
import type { StoredVodItem } from './vod.js';
import type { SqlDatabase } from './types.js';
import { withTransaction } from './transaction.js';

/** Et afsnits identitet bevares, selv om udbyderen aendrer filens id. */
export interface FollowedEpisode { season: number; episode: number; title: string }
export interface FollowedSeries {
  series: StoredVodItem;
  followedMs: number;
  /** Bevares til aeldre kald; nye afsnit registreres enkeltvis. */
  seenEpisodes: number;
  episodes: number;
  newCount: number;
  newEpisodes: FollowedEpisode[];
}

async function baselineReady(db: SqlDatabase, seriesKey: string): Promise<boolean> {
  return (await db.getFirstAsync('SELECT series_key FROM followed_series_state WHERE series_key = ?', [seriesKey])) !== null;
}

/** Et aeldre foelg eller en gendannet kopi faar eksisterende afsnit som
 * udgangspunkt. Uden nogen tidligere afsnitliste venter vi paa foerste svar. */
export async function prepareFollowedSeries(db: SqlDatabase, seriesKey: string, now = Date.now()): Promise<void> {
  if (!(await isFollowed(db, seriesKey)) || await baselineReady(db, seriesKey)) return;
  const snapshot = await db.getFirstAsync<{ n: number }>(
    `SELECT CASE WHEN EXISTS(SELECT 1 FROM vod_details WHERE item_key = ?)
      OR EXISTS(SELECT 1 FROM episodes WHERE series_key = ?) THEN 1 ELSE 0 END AS n`, [seriesKey, seriesKey],
  );
  if (snapshot?.n !== 1) return;
  await withTransaction(db, async () => {
    await db.runAsync(
      `INSERT OR IGNORE INTO followed_episode_state
       (series_key,season,episode,first_seen_ms,acknowledged_ms)
       SELECT ?, season, episode, ?, ? FROM episodes WHERE series_key = ? GROUP BY season, episode`,
      [seriesKey, now, now, seriesKey],
    );
    await db.runAsync('INSERT OR IGNORE INTO followed_series_state(series_key,initialized_ms) VALUES(?,?)', [seriesKey, now]);
  });
}

/** Kaldes efter en vellykket afsnithentning. Foerste ukendte snapshot er
 * baseline, ikke en besked om at alle gamle afsnit lige er kommet. */
export async function reconcileFollowedSeries(db: SqlDatabase, seriesKey: string, now = Date.now()): Promise<void> {
  if (!(await isFollowed(db, seriesKey))) return;
  const ready = await baselineReady(db, seriesKey);
  await withTransaction(db, async () => {
    await db.runAsync(
      `INSERT OR IGNORE INTO followed_episode_state
       (series_key,season,episode,first_seen_ms,acknowledged_ms)
       SELECT ?, season, episode, ?, ? FROM episodes WHERE series_key = ? GROUP BY season, episode`,
      [seriesKey, now, ready ? null : now, seriesKey],
    );
    await db.runAsync('INSERT OR IGNORE INTO followed_series_state(series_key,initialized_ms) VALUES(?,?)', [seriesKey, now]);
    await acknowledgeWatched(db, seriesKey, now);
  });
}

/** Set-faerdig kommer fra afspilningshistorikken, aldrig fra at aabne siden. */
async function acknowledgeWatched(db: SqlDatabase, seriesKey: string, now: number): Promise<void> {
  await db.runAsync(
    `UPDATE followed_episode_state SET acknowledged_ms = ?
     WHERE series_key = ? AND acknowledged_ms IS NULL AND EXISTS (
       SELECT 1 FROM episodes e JOIN vod_watched w ON w.item_key = e.key
       WHERE e.series_key = followed_episode_state.series_key
         AND e.season = followed_episode_state.season AND e.episode = followed_episode_state.episode)`,
    [now, seriesKey],
  );
}

export async function followSeries(db: SqlDatabase, seriesKey: string, now = Date.now()): Promise<void> {
  if (await isFollowed(db, seriesKey)) return;
  const count = await episodeCount(db, seriesKey);
  await withTransaction(db, async () => {
    await db.runAsync('INSERT OR IGNORE INTO followed_series(series_key,followed_ms,seen_episodes) VALUES(?,?,?)', [seriesKey, now, count]);
    await prepareFollowedSeries(db, seriesKey, now);
  });
}

export async function unfollowSeries(db: SqlDatabase, seriesKey: string): Promise<void> {
  await withTransaction(db, async () => {
    await db.runAsync('DELETE FROM followed_episode_state WHERE series_key = ?', [seriesKey]);
    await db.runAsync('DELETE FROM followed_series_state WHERE series_key = ?', [seriesKey]);
    await db.runAsync('DELETE FROM followed_series WHERE series_key = ?', [seriesKey]);
  });
}

export async function isFollowed(db: SqlDatabase, seriesKey: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM followed_series WHERE series_key = ?', [seriesKey]);
  return (row?.n ?? 0) > 0;
}

/** Eksplicit "Ryd ny-markering". Roerer ikke afspilningsposition eller set. */
export async function markSeriesSeen(db: SqlDatabase, seriesKey: string): Promise<void> {
  await prepareFollowedSeries(db, seriesKey);
  await reconcileFollowedSeries(db, seriesKey);
  await db.runAsync('UPDATE followed_episode_state SET acknowledged_ms = ? WHERE series_key = ? AND acknowledged_ms IS NULL', [Date.now(), seriesKey]);
  await db.runAsync('UPDATE followed_series SET seen_episodes = ? WHERE series_key = ?', [await episodeCount(db, seriesKey), seriesKey]);
}

export async function listFollowedSeriesKeys(db: SqlDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ series_key: string }>('SELECT series_key FROM followed_series ORDER BY followed_ms DESC');
  return rows.map((row) => row.series_key);
}

export async function getNewEpisodes(db: SqlDatabase, seriesKey: string): Promise<FollowedEpisode[]> {
  if (!(await isFollowed(db, seriesKey))) return [];
  await prepareFollowedSeries(db, seriesKey);
  if (await baselineReady(db, seriesKey)) await reconcileFollowedSeries(db, seriesKey);
  return db.getAllAsync<FollowedEpisode>(
    `SELECT e.season,e.episode,MIN(e.title) AS title FROM episodes e
     JOIN followed_episode_state s ON s.series_key=e.series_key AND s.season=e.season AND s.episode=e.episode
     WHERE e.series_key=? AND s.acknowledged_ms IS NULL
     GROUP BY e.season,e.episode ORDER BY e.season,e.episode`, [seriesKey],
  );
}

/** Kildens id er en del af series_key; identiske serienumre blandes ikke. */
export async function listFollowedSeries(db: SqlDatabase): Promise<FollowedSeries[]> {
  const rows = await db.getAllAsync<{ series_key: string; followed_ms: number }>('SELECT series_key,followed_ms FROM followed_series ORDER BY followed_ms DESC');
  const out: FollowedSeries[] = [];
  for (const row of rows) {
    const series = await getVodItem(db, row.series_key);
    if (series === null) continue;
    const episodes = await episodeCount(db, row.series_key);
    const newEpisodes = await getNewEpisodes(db, row.series_key);
    out.push({ series, followedMs: row.followed_ms, episodes, seenEpisodes: episodes - newEpisodes.length, newCount: newEpisodes.length, newEpisodes });
  }
  return out.sort((a, b) => Number(b.newCount > 0) - Number(a.newCount > 0) || b.followedMs - a.followedMs);
}

async function episodeCount(db: SqlDatabase, seriesKey: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM (SELECT season,episode FROM episodes WHERE series_key = ? GROUP BY season,episode)', [seriesKey]);
  return row?.n ?? 0;
}

export function newEpisodesLabel(episodes: readonly FollowedEpisode[]): string {
  if (episodes.length === 0) return 'Ingen nye afsnit';
  const first = episodes[0]!;
  const last = episodes[episodes.length - 1]!;
  const consecutive = episodes.every((item, index) => item.season === first.season && item.episode === first.episode + index);
  const range = episodes.length === 1 ? `S${first.season} E${first.episode}`
    : consecutive ? `S${first.season} E${first.episode}–E${last.episode}`
      : episodes.slice(0, 3).map(item => `S${item.season} E${item.episode}`).join(', ') + (episodes.length > 3 ? ' …' : '');
  return `${range} · ${episodes.length === 1 ? '1 nyt afsnit' : `${episodes.length} nye afsnit`}`;
}
