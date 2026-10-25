import { beforeEach, expect, it } from 'vitest';
import type { Episode } from '@norstream/core';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import { replaceEpisodes, setWatched } from './vod.js';
import { followSeries, getNewEpisodes, listFollowedSeries, markSeriesSeen, newEpisodesLabel, prepareFollowedSeries, reconcileFollowedSeries } from './followedSeries.js';

let db: SqlDatabase;
const key = 'source:series';
const episode = (n: number, id = String(n), season = 2): Episode => ({ id, seriesId: 'series', season, episode: n, title: `Afsnit ${n}`, plot: null, durationMinutes: 30, containerExtension: 'mp4', airDate: null });
beforeEach(async () => {
  db = createTestDatabase(); await migrate(db);
  await db.runAsync("INSERT INTO vod_items(key,source_id,item_id,kind,name,sort_order) VALUES(?,?,?,?,?,?)", [key, 'source', 'series', 'series', 'En serie', 0]);
});

it('opdager et nyt afsnit selv om et gammelt forsvinder og det samlede antal er uforandret', async () => {
  await replaceEpisodes(db, key, [episode(1), episode(2)]); await followSeries(db, key, 1000);
  await replaceEpisodes(db, key, [episode(2), episode(3)]);
  const [series] = await listFollowedSeries(db);
  expect(series!.episodes).toBe(2); expect(series!.newCount).toBe(1);
  expect(series!.newEpisodes.map(e => e.episode)).toEqual([3]);
  expect(newEpisodesLabel(series!.newEpisodes)).toBe('S2 E3 · 1 nyt afsnit');
});

it('providerens nye fil-id eller dubletter i HD og 4K er ikke nye afsnit', async () => {
  await replaceEpisodes(db, key, [episode(1)]); await followSeries(db, key);
  await replaceEpisodes(db, key, [episode(1, 'renumbered'), episode(1, '4k')]);
  const [series] = await listFollowedSeries(db);
  expect(series!.episodes).toBe(1); expect(series!.newCount).toBe(0);
});

it('foerste hentning er baseline naar serien blev fulgt inden dens afsnit var kendt', async () => {
  await followSeries(db, key); await prepareFollowedSeries(db, key);
  await replaceEpisodes(db, key, [episode(1), episode(2)]); await reconcileFollowedSeries(db, key);
  expect(await getNewEpisodes(db, key)).toEqual([]);
  await replaceEpisodes(db, key, [episode(1), episode(2), episode(3)]);
  expect((await getNewEpisodes(db, key)).map(e => e.episode)).toEqual([3]);
});

it('legacy foelg uden snapshot bevarer baseline og gamle afsnit meldes ikke nye', async () => {
  await replaceEpisodes(db, key, [episode(1), episode(2)]);
  await db.runAsync('INSERT INTO followed_series VALUES(?,?,?)', [key, 1, 0]);
  expect(await getNewEpisodes(db, key)).toEqual([]);
  await replaceEpisodes(db, key, [episode(1), episode(2), episode(3)]);
  expect((await getNewEpisodes(db, key)).map(e => e.episode)).toEqual([3]);
});

it('laesning af listen rydder ikke nyt; eksplicit kvittering roerer ikke afspilning', async () => {
  await replaceEpisodes(db, key, [episode(1)]); await followSeries(db, key);
  await replaceEpisodes(db, key, [episode(1), episode(2)]);
  await db.runAsync('INSERT INTO vod_progress VALUES(?,?,?,?)', [`${key}:2`, 123, 1800, 10]);
  expect((await getNewEpisodes(db, key)).length).toBe(1);
  expect((await getNewEpisodes(db, key)).length).toBe(1);
  await markSeriesSeen(db, key); expect(await getNewEpisodes(db, key)).toEqual([]);
  expect((await db.getFirstAsync<{position_s:number}>('SELECT position_s FROM vod_progress'))!.position_s).toBe(123);
  expect(await db.getFirstAsync('SELECT * FROM vod_watched')).toBeNull();
});

it('set faerdig fjerner ny-markering og samme afsnit vender ikke tilbage ved nyt fil-id', async () => {
  await replaceEpisodes(db, key, [episode(1)]); await followSeries(db, key);
  await replaceEpisodes(db, key, [episode(1), episode(2)]); expect((await getNewEpisodes(db, key)).length).toBe(1);
  await setWatched(db, `${key}:2`, true); expect(await getNewEpisodes(db, key)).toEqual([]);
  await replaceEpisodes(db, key, [episode(1), episode(2, 'new-id')]); expect(await getNewEpisodes(db, key)).toEqual([]);
});

it('identiteten er afgraenset til kilde og serie, og etiketter bevarer afsnitshuller', async () => {
  await replaceEpisodes(db, key, [episode(1)]); await followSeries(db, key);
  const other = 'other:series';
  await db.runAsync("INSERT INTO vod_items(key,source_id,item_id,kind,name,sort_order) VALUES(?,?,?,?,?,?)", [other, 'other', 'series', 'series', 'Anden kilde', 0]);
  await replaceEpisodes(db, other, [episode(1)]); await followSeries(db, other);
  await replaceEpisodes(db, key, [episode(1), episode(4), episode(5)]);
  expect(newEpisodesLabel(await getNewEpisodes(db, key))).toBe('S2 E4–E5 · 2 nye afsnit');
  expect(await getNewEpisodes(db, other)).toEqual([]);
  expect(newEpisodesLabel([episode(4), episode(6)])).toBe('S2 E4, S2 E6 · 2 nye afsnit');
});
