import { describe, expect, it } from 'vitest';
import { backupHasUserData, createBackup, parseBackup, restoreBackup, serialiseBackup } from './backup.js';
import type { Backup } from './backup.js';
import { migrate } from './schema.js';
import { addSource } from './sources.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

async function installation(url = 'https://panel.example') {
  const db = createTestDatabase();
  await migrate(db);
  const sourceId = (await addSource(db, { kind: 'xtream', name: 'Pakken', url, username: 'same-user' })).id;
  return { db, sourceId };
}
async function seed(db: SqlDatabase, key: string, acknowledged: number | null = null) {
  await db.runAsync('INSERT INTO followed_series(series_key,followed_ms,seen_episodes) VALUES(?,?,?)', [key, 100, 2]);
  await db.runAsync('INSERT INTO followed_series_state(series_key,initialized_ms) VALUES(?,?)', [key, 110]);
  await db.runAsync('INSERT INTO followed_episode_state(series_key,season,episode,first_seen_ms,acknowledged_ms) VALUES(?,?,?,?,?)', [key, 1, 1, 120, acknowledged]);
}
const episodeRows = (db: SqlDatabase) => db.getAllAsync('SELECT * FROM followed_episode_state ORDER BY series_key,season,episode');
const followRows = (db: SqlDatabase) => db.getAllAsync('SELECT * FROM followed_series ORDER BY series_key');

describe('sikkerhedskopi af fulgte serier', () => {
  it('bevarer nye afsnit og kvitteringer ved kilde-id-skift og gentagen gendannelse', async () => {
    const old = await installation();
    await seed(old.db, `${old.sourceId}:series-7`, 150);
    await old.db.runAsync('INSERT INTO followed_episode_state VALUES(?,?,?,?,?)', [`${old.sourceId}:series-7`, 2, 5, 200, null]);
    const backup = parseBackup(serialiseBackup(await createBackup(old.db, 300)));
    expect(backup.followedSeries).toEqual([{
      seriesKey: `${old.sourceId}:series-7`, followedMs: 100, seenEpisodes: 2, initializedMs: 110,
      episodes: [{ season: 1, episode: 1, firstSeenMs: 120, acknowledgedMs: 150 }, { season: 2, episode: 5, firstSeenMs: 200, acknowledgedMs: null }],
    }]);
    expect(backupHasUserData(backup)).toBe(true);
    const fresh = await installation();
    expect(fresh.sourceId).not.toBe(old.sourceId);
    await restoreBackup(fresh.db, backup);
    await restoreBackup(fresh.db, backup);
    expect(await followRows(fresh.db)).toEqual([{ series_key: `${fresh.sourceId}:series-7`, followed_ms: 100, seen_episodes: 2 }]);
    expect(await episodeRows(fresh.db)).toEqual([
      { series_key: `${fresh.sourceId}:series-7`, season: 1, episode: 1, first_seen_ms: 120, acknowledged_ms: 150 },
      { series_key: `${fresh.sourceId}:series-7`, season: 2, episode: 5, first_seen_ms: 200, acknowledged_ms: null },
    ]);
  });

  it('aeldre v1-v3-kopier uden foelgelisten roerer ikke lokal status', async () => {
    const local = await installation();
    await seed(local.db, `${local.sourceId}:series-7`, 150);
    const before = await episodeRows(local.db);
    for (const version of [1, 2, 3]) {
      const backup = parseBackup(JSON.stringify({ app: 'norstream', version }));
      expect(backup.followedSeries).toBeUndefined();
      await restoreBackup(local.db, backup);
      expect(await followRows(local.db)).toHaveLength(1);
      expect(await episodeRows(local.db)).toEqual(before);
    }
  });

  it('en bevidst tom liste rydder kun kilder der genkendes i kopien', async () => {
    const old = await installation();
    const backup = await createBackup(old.db);
    expect(backup.followedSeries).toEqual([]);
    const local = await installation();
    const otherId = (await addSource(local.db, { kind: 'xtream', name: 'Anden pakke', url: 'https://other.example' })).id;
    await seed(local.db, `${local.sourceId}:series-7`);
    await seed(local.db, `${otherId}:series-7`, 150);
    await restoreBackup(local.db, backup);
    expect(await followRows(local.db)).toEqual([{ series_key: `${otherId}:series-7`, followed_ms: 100, seen_episodes: 2 }]);
    expect(await episodeRows(local.db)).toHaveLength(1);
  });

  it('ukendte kilder og en kun beskadiget liste sletter ikke lokal status', async () => {
    const local = await installation();
    await seed(local.db, `${local.sourceId}:series-7`, 150);
    const before = await episodeRows(local.db);
    const backup = await createBackup(local.db);
    const malformed = parseBackup(JSON.stringify({ ...backup, followedSeries: [null, 'series', { seriesKey: 'bad' }] }));
    expect(malformed.followedSeries).toBeUndefined();
    await restoreBackup(local.db, malformed);
    const unknown = { ...backup, followedSeries: [{ ...backup.followedSeries![0]!, seriesKey: 'unknown:series-7' }] };
    await restoreBackup(local.db, unknown);
    expect(await episodeRows(local.db)).toEqual(before);
    expect(await followRows(local.db)).toHaveLength(1);
  });

  it('afviser ugyldige numre og tidspunkter, men bevarer gyldige specials og null-baseline', async () => {
    const local = await installation();
    const backup = await createBackup(local.db);
    const seriesKey = `${local.sourceId}:series-7`;
    const valid = { season: 0, episode: 1, firstSeenMs: 100, acknowledgedMs: null };
    const incoming = { ...backup, followedSeries: [
      { seriesKey, followedMs: 90, seenEpisodes: 0, initializedMs: 95, episodes: [valid,
        { ...valid, season: -1 }, { ...valid, episode: 0 }, { ...valid, episode: 2.5 },
        { ...valid, episode: 2, firstSeenMs: Infinity }, { ...valid, episode: 3, acknowledgedMs: -1 },
        { ...valid, episode: 4, acknowledgedMs: 8_640_000_000_000_001 },
      ] },
      { seriesKey: `${local.sourceId}:series-pending`, followedMs: 100, seenEpisodes: 0, initializedMs: null, episodes: [] },
      { seriesKey: `${local.sourceId}:bad-time`, followedMs: NaN, seenEpisodes: 0, initializedMs: null, episodes: [] },
    ] } as unknown as Backup;
    await restoreBackup(local.db, incoming);
    expect(await followRows(local.db)).toHaveLength(2);
    expect(await episodeRows(local.db)).toEqual([{ series_key: seriesKey, season: 0, episode: 1, first_seen_ms: 100, acknowledged_ms: null }]);
    expect(await local.db.getFirstAsync('SELECT * FROM followed_series_state WHERE series_key=?', [`${local.sourceId}:series-pending`])).toBeNull();
  });

  it('fremdrifts-merge bevarer lokale foelg og nyere kvitteringer', async () => {
    const local = await installation();
    const key = `${local.sourceId}:series-7`;
    await seed(local.db, key, 500);
    const backup = await createBackup(local.db);
    backup.followedSeries![0]!.episodes[0]!.acknowledgedMs = null;
    backup.followedSeries![0]!.episodes.push({ season: 2, episode: 1, firstSeenMs: 600, acknowledgedMs: null });
    await seed(local.db, `${local.sourceId}:series-local`);
    await restoreBackup(local.db, backup, { mergeProgress: true });
    expect(await followRows(local.db)).toHaveLength(2);
    const episodes = await local.db.getAllAsync<{ acknowledged_ms: number | null }>('SELECT acknowledged_ms FROM followed_episode_state WHERE series_key=? ORDER BY season,episode', [key]);
    expect(episodes).toEqual([{ acknowledged_ms: 500 }, { acknowledged_ms: null }]);
  });

  it('en skrivefejl ruller foelgelistens erstatning tilbage', async () => {
    const local = await installation();
    await seed(local.db, `${local.sourceId}:series-7`, 150);
    const before = await episodeRows(local.db);
    const backup = await createBackup(local.db);
    backup.followedSeries![0]!.episodes.push({ season: 2, episode: 1, firstSeenMs: 200, acknowledgedMs: null });
    const faulty: SqlDatabase = { ...local.db, runAsync: async (sql, params) => {
      if (sql.includes('INSERT INTO followed_episode_state')) throw new Error('diskfejl');
      return local.db.runAsync(sql, params);
    } };
    await expect(restoreBackup(faulty, backup)).rejects.toThrow('diskfejl');
    expect(await episodeRows(local.db)).toEqual(before);
    expect(await followRows(local.db)).toHaveLength(1);
  });
});
