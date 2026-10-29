import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { createTestDatabase } from '../storage/testDb.js';
import { migrate } from '../storage/schema.js';
import type { SqlDatabase } from '../storage/types.js';
import { followSeries, getNewEpisodes } from '../storage/followedSeries.js';
import { getVodDetails, getVodItem } from '../storage/vod.js';
import { FOLLOWED_MAX_AGE_MS, ensureVodDetails, refreshFollowedSeries } from './vodDetails.js';
import { panelQueue, pauseBackgroundPanel, resetPanelGate } from './panelGate.js';

let db: SqlDatabase;
const key = 'source:series';
const creds: XtreamCredentials = { baseUrl: 'https://example.invalid', username: 'u', password: 'p' };
const response = (episodes: number[]) => ({ info: { name: 'Serien' }, episodes: { '1': episodes.map(n => ({ id: String(n), season: 1, episode_num: n, title: `Afsnit ${n}` })) } });
const transport = (episodes: number[]) => vi.fn(async (url: string) => {
  expect(new URL(url).searchParams.get('action')).toBe('get_series_info');
  return { ok: true, status: 200, json: async () => response(episodes), text: async () => '' };
});
beforeEach(async () => {
  resetPanelGate();
  db = createTestDatabase(); await migrate(db);
  await db.runAsync("INSERT INTO vod_items(key,source_id,item_id,kind,name,sort_order) VALUES(?,?,?,?,?,?)", [key, 'source', 'series', 'series', 'En serie', 0]);
  await followSeries(db, key);
});
afterEach(() => {
  expect(panelQueue()).toEqual({ foreground: 0, background: 0, busy: false });
  resetPanelGate();
});

it('henter kun fulgte serier, gemmer foerste baseline og finder nye efter seks timer', async () => {
  const first = transport([1, 2]); const now = new Date('2026-10-25T10:00:00Z');
  expect(await refreshFollowedSeries(db, 'source', creds, first, now)).toBe(1);
  expect(await getNewEpisodes(db, key)).toEqual([]);
  const updated = transport([2, 3]);
  expect(await refreshFollowedSeries(db, 'source', creds, updated, new Date(+now + 60_000))).toBe(0);
  expect(updated).not.toHaveBeenCalled();
  expect(await refreshFollowedSeries(db, 'source', creds, updated, new Date(+now + FOLLOWED_MAX_AGE_MS))).toBe(1);
  expect((await getNewEpisodes(db, key)).map(e => e.episode)).toEqual([3]); expect(updated).toHaveBeenCalledTimes(1);
});

it('deler samtidige opstart og resume-kald og annullerer resten naar appen skjules', async () => {
  const fetch = transport([1]); const now = new Date('2026-10-25T10:00:00Z');
  expect(await Promise.all([refreshFollowedSeries(db, 'source', creds, fetch, now), refreshFollowedSeries(db, 'source', creds, fetch, now)])).toEqual([1, 1]);
  expect(fetch).toHaveBeenCalledTimes(1);
  const stopped = transport([1, 2]);
  expect(await refreshFollowedSeries(db, 'source', creds, stopped, new Date(+now + FOLLOWED_MAX_AGE_MS), () => false)).toBe(0);
  expect(stopped).not.toHaveBeenCalled();
});

it('netfejl bevarer afsnit og venter fem minutter foer naeste forsoeg', async () => {
  const now = new Date('2026-10-25T10:00:00Z');
  const dead = vi.fn(async () => { throw new Error('connection'); }) as unknown as FetchLike;
  expect(await refreshFollowedSeries(db, 'source', creds, dead, now)).toBe(0);
  expect(await refreshFollowedSeries(db, 'source', creds, dead, new Date(+now + 60_000))).toBe(0);
  expect(dead).toHaveBeenCalledTimes(1);
  const works = transport([1]);
  expect(await refreshFollowedSeries(db, 'source', creds, works, new Date(+now + 5 * 60_000))).toBe(1);
  expect(await getNewEpisodes(db, key)).toEqual([]);
});

it('et ugyldigt tomt HTTP200-svar maa ikke slette afsnit eller forny sidste vellykkede hentning', async () => {
  const now = new Date('2026-10-25T10:00:00Z');
  await refreshFollowedSeries(db, 'source', creds, transport([1, 2]), now);
  const empty = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' }));
  const later = new Date(+now + FOLLOWED_MAX_AGE_MS);
  expect(await refreshFollowedSeries(db, 'source', creds, empty, later)).toBe(0);
  expect((await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM episodes'))!.n).toBe(2);
  expect((await getVodDetails(db, key))!.fetchedAt.getTime()).toBe(+now);
  expect(await getNewEpisodes(db, key)).toEqual([]);
  await refreshFollowedSeries(db, 'source', creds, empty, new Date(+later + 60_000));
  expect(empty).toHaveBeenCalledTimes(1);
});

it('automatisk serieopdatering sender ingen HTTP mens afspilning holder baggrundskoeen paa pause', async () => {
  const resume = pauseBackgroundPanel();
  const fetch = transport([1, 2]);
  const operation = refreshFollowedSeries(db, 'source', creds, fetch, new Date('2026-10-25T10:00:00Z'));
  try {
    await vi.waitFor(() => expect(panelQueue().background).toBe(1));
    expect(fetch).not.toHaveBeenCalled();
    expect(await getVodDetails(db, key)).toBeNull();
  } finally { resume(); }
  expect(await operation).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('en serieopdatering annulleret i baggrundskoeen springer HTTP over naar afspilningen slipper', async () => {
  const resume = pauseBackgroundPanel();
  const fetch = transport([1]);
  let visible = true;
  const now = new Date('2026-10-25T10:00:00Z');
  const operation = refreshFollowedSeries(db, 'source', creds, fetch, now, () => visible);
  try {
    await vi.waitFor(() => expect(panelQueue().background).toBe(1));
    visible = false;
  } finally { resume(); }
  expect(await operation).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
  // Annullering er ingen netfejl og maa ikke udloese fem minutters ventetid.
  expect(await refreshFollowedSeries(db, 'source', creds, fetch, now)).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('et direkte brugeropslag virker mens automatisk serieopdatering venter paa panelkoeen', async () => {
  const resume = pauseBackgroundPanel();
  const fetch = transport([1]);
  const now = new Date('2026-10-25T10:00:00Z');
  const operation = refreshFollowedSeries(db, 'source', creds, fetch, now);
  try {
    await vi.waitFor(() => expect(panelQueue().background).toBe(1));
    const item = await getVodItem(db, key);
    const details = await ensureVodDetails(db, item!, creds, fetch, now);
    expect((await getVodDetails(db, key))?.details).toEqual(details);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(panelQueue().background).toBe(1);
  } finally { resume(); }
  await operation;
  // Baggrundsjobbet genbruger det netop gemte svar uden et ekstra HTTP-kald.
  expect(fetch).toHaveBeenCalledTimes(1);
});
