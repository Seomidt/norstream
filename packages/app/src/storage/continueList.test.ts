import { beforeEach, expect, it } from 'vitest';
import type { VodItem } from '@norstream/core';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import { addSource } from './sources.js';
import { replaceVodItems, replaceEpisodes, saveProgress, getProgress, listVodItems, listEpisodes, setInWatchlist, setWatched } from './vod.js';
import { clearContinueList, clearVodContinueList, continueChannelVisible, continueCutoff, dismissContinueItem } from './continueList.js';
import { createBackup, restoreBackup } from './backup.js';
import { recordChannelWatch } from './history.js';

let db: SqlDatabase;
let source: string;
let film: string;
let series: string;
const home = () => listVodItems(db, { inProgressOnly: true, homeContinueOnly: true });
beforeEach(async () => {
  db = createTestDatabase(); await migrate(db);
  source = (await addSource(db, { kind: 'xtream', name: 'Panel', url: 'http://panel.invalid' })).id;
  const item: VodItem = { id: '1', kind: 'movie', name: 'Film', categoryId: null, posterUrl: null, rating: null, year: null, added: null, containerExtension: 'mp4' };
  await replaceVodItems(db, source, 'movie', [item]);
  await replaceVodItems(db, source, 'series', [{ ...item, id: '2', kind: 'series', name: 'Serie' }]);
  film = `${source}:movie-1`; series = `${source}:series-2`;
  await saveProgress(db, film, 300, 3600, new Date(1000));
  await saveProgress(db, `${series}:ep1`, 600, 2700, new Date(1200));
});

it('fjerner kun den valgte titel fra forsiden og bevarer position og Min liste', async () => {
  await setInWatchlist(db, film, true);
  await dismissContinueItem(db, `vod:${film}`, 2000);
  expect((await home()).map(x => x.key)).toEqual([series]);
  expect(await getProgress(db, film)).toEqual({ positionSeconds: 300, durationSeconds: 3600 });
  expect((await listVodItems(db, { watchlistOnly: true })).map(x => x.key)).toEqual([film]);
  expect(await listVodItems(db, { inProgressOnly: true })).toHaveLength(2);
});

it('rydder hele listen og viser kun ny afspilning bagefter', async () => {
  await clearContinueList(db, 2000);
  expect(await home()).toEqual([]);
  await saveProgress(db, film, 400, 3600, new Date(3000));
  expect((await home()).map(x => x.key)).toEqual([film]);
  expect(await getProgress(db, `${series}:ep1`)).not.toBeNull();
});

it('skjuler hele serien indtil et afsnit faktisk bliver set igen', async () => {
  await dismissContinueItem(db, `vod:${series}`, 2000);
  await saveProgress(db, `${series}:ep2`, 700, 2700, new Date(1500));
  expect((await home()).map(x => x.key)).toEqual([film]);
  await saveProgress(db, `${series}:ep2`, 710, 2700, new Date(2100));
  expect((await home()).map(x => x.key)).toEqual([series, film]);
});

it('gamle cloud-positioner genopretter ikke ryddede kort paa samme boks', async () => {
  const cloud = await createBackup(db, 1600);
  await clearContinueList(db, 2000);
  await dismissContinueItem(db, `vod:${film}`, 2200);
  await restoreBackup(db, cloud, { mergeProgress: true });
  expect(await home()).toEqual([]);
  expect(await continueCutoff(db, `vod:${film}`)).toBe(2200);
  expect(Object.keys((await createBackup(db, 2500)).settings).some(k => k.startsWith('home_continue_'))).toBe(false);
});

it('sidst sete kanal skjules, mens kanalhistorikken bevares og ny afspilning viser den igen', async () => {
  // Historikken tillader ogsaa endnu ikke indlaeste kanaler.
  const channel = `${source}:tv2`;
  await recordChannelWatch(db, channel, 1000);
  expect(await continueChannelVisible(db, channel)).toBe(true);
  await dismissContinueItem(db, `channel:${channel}`, 2000);
  expect(await continueChannelVisible(db, channel)).toBe(false);
  await recordChannelWatch(db, channel, 3000);
  expect(await continueChannelVisible(db, channel)).toBe(true);
  await clearContinueList(db, 4000);
  expect(await continueChannelVisible(db, channel)).toBe(false);
});

it('cutoff flyttes aldrig baglaens af to hurtige rydninger', async () => {
  await clearContinueList(db, 3000); await clearContinueList(db, 2000);
  expect(await continueCutoff(db, 'vod:any')).toBe(3000);
});

const episodes = [1, 2, 3].map(number => ({
  id: `ep${number}`, seriesId: '2', season: number === 3 ? 2 : 1, episode: number === 3 ? 1 : number,
  title: `Afsnit ${number}`, plot: null, durationMinutes: 45, containerExtension: 'mp4', airDate: null,
}));
it('begge hylder bevarer serien efter afsluttet afsnit og helt over et saesonskift', async () => {
  await replaceEpisodes(db, series, episodes);
  await saveProgress(db, `${series}:ep1`, 2700, 2700, new Date(2000));
  for (const homeContinueOnly of [false, true]) {
    expect((await listVodItems(db, { inProgressOnly: true, homeContinueOnly })).map(x => x.key)).toEqual([series, film]);
  }
  await saveProgress(db, `${series}:ep2`, 2700, 2700, new Date(3000));
  expect((await home()).map(x => x.key)).toEqual([series, film]);
  await saveProgress(db, `${series}:ep3`, 2700, 2700, new Date(4000));
  expect((await home()).map(x => x.key)).toEqual([film]);
});
it('en genafspilning af sidste sete afsnit bliver synlig og kan fortsaettes', async () => {
  await replaceEpisodes(db, series, episodes);
  await saveProgress(db, `${series}:ep3`, 2700, 2700, new Date(2000));
  expect((await home()).map(x => x.key)).toEqual([film]);
  await saveProgress(db, `${series}:ep3`, 600, 2700, new Date(3000));
  expect((await home()).map(x => x.key)).toEqual([series, film]);
  const last = (await listEpisodes(db, series)).at(-1)!;
  expect(last.watched).toBe(false);
  expect(last.positionSeconds).toBe(600);
});
it('film der ses igen kan fortsaettes og en nyere set-markering overskrives ikke', async () => {
  await saveProgress(db, film, 3600, 3600, new Date(2000));
  await saveProgress(db, film, 600, 3600, new Date(3000));
  expect((await home()).find(x => x.key === film)?.watched).toBe(false);
  await setWatched(db, film, true, new Date(5000));
  await saveProgress(db, film, 650, 3600, new Date(4000));
  expect((await home()).some(x => x.key === film)).toBe(false);
});
it('gentaget slutposition med ukendt varighed bliver ved med at vaere set', async () => {
  await saveProgress(db, film, 3600, null, new Date(2000));
  await setWatched(db, film, true, new Date(3000));
  await saveProgress(db, film, 3600, null, new Date(4000));
  expect((await home()).some(x => x.key === film)).toBe(false);
});
it('rydning fra Film rydder begge VOD-hylder, bevarer kanalen og overlever cloud-restore', async () => {
  const channel = `${source}:tv2`;
  await recordChannelWatch(db, channel, 1000);
  const cloud = await createBackup(db, 1500);
  await clearVodContinueList(db, 2000);
  expect(await home()).toEqual([]);
  expect(await continueChannelVisible(db, channel)).toBe(true);
  await restoreBackup(db, cloud, { mergeProgress: true });
  expect(await home()).toEqual([]);
  expect(Object.keys((await createBackup(db, 2500)).settings).some(k => k.startsWith('home_continue_'))).toBe(false);
  await saveProgress(db, `${series}:ep1`, 610, 2700, new Date(3000));
  expect((await home()).map(x => x.key)).toEqual([series]);
});
