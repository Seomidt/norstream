import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { migrate } from '../storage/schema.js';
import { addSource } from '../storage/sources.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { getVodDetails, listEpisodes, listVodItems } from '../storage/vod.js';
import { syncVod } from './syncVod.js';
import { ensureVodDetails } from './vodDetails.js';

const creds = { baseUrl: 'http://p', username: 'u', password: 'p' };
let db: SqlDatabase;
let sourceId: string;

function panel(options: { seriesDown?: boolean; noMovies?: boolean } = {}): FetchLike {
  return vi.fn(async (url: string) => {
    const action = new URL(url).searchParams.get('action');
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
    if (action === 'get_vod_categories') return json([{ category_id: 1, category_name: 'DK | Film' }]);
    if (action === 'get_vod_streams') {
      if (options.noMovies === true) return json([]);
      return json([
        { stream_id: 10, name: 'Druk', category_id: 1, container_extension: 'mkv', rating: '7.7' },
        { stream_id: 11, name: 'Heat', category_id: 1, container_extension: 'mp4' },
      ]);
    }
    if (action === 'get_series_categories') {
      if (options.seriesDown === true) return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
      return json([{ category_id: 5, category_name: 'DK | Serier' }]);
    }
    if (action === 'get_series') return json([{ series_id: 99, name: 'Jane', category_id: 5 }]);
    if (action === 'get_vod_info') {
      return json({ info: { plot: 'Fire laerere …', youtube_trailer: 'dQw4w9WgXcQ', episode_run_time: '117' } });
    }
    if (action === 'get_series_info') {
      return json({
        info: { plot: 'En telenovela.' },
        episodes: { '1': [{ id: '1001', episode_num: 1, title: 'Pilot', container_extension: 'mkv' }] },
      });
    }
    return json({ user_info: { auth: 1 } });
  }) as unknown as FetchLike;
}

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  sourceId = (await addSource(db, { kind: 'xtream', name: 'P', url: 'http://p' })).id;
});

describe('syncVod', () => {
  it('henter film og serier med deres kategorier', async () => {
    const result = await syncVod(db, sourceId, creds, panel());
    expect(result).toEqual({ movies: 2, series: 1 });
    expect((await listVodItems(db, { kind: 'movie' })).map((i) => i.name)).toEqual(['Druk', 'Heat']);
    expect((await listVodItems(db, { kind: 'series' }))[0]?.categoryName).toBe('DK | Serier');
  });

  // Et panel uden serier er ikke et panel uden film.
  it('henter filmene selv om serierne fejler', async () => {
    const result = await syncVod(db, sourceId, creds, panel({ seriesDown: true }));
    expect(result.movies).toBe(2);
    expect(result.series).toBe(0);
  });

  // Et tomt filsvar under en travl stund maa ikke tromle et katalog der havde film.
  it('beholder filmene naar panelet svarer med en tom liste', async () => {
    await syncVod(db, sourceId, creds, panel());
    expect((await listVodItems(db, { kind: 'movie' })).length).toBe(2);
    const result = await syncVod(db, sourceId, creds, panel({ noMovies: true }));
    expect(result.movies).toBe(2);
    expect((await listVodItems(db, { kind: 'movie' })).map((i) => i.name)).toEqual(['Druk', 'Heat']);
  });
});

describe('ensureVodDetails', () => {
  it('henter det panelet ved om en film og gemmer det', async () => {
    const fetchImpl = panel();
    await syncVod(db, sourceId, creds, fetchImpl);
    const [druk] = await listVodItems(db, { search: 'Druk' });

    const details = await ensureVodDetails(db, druk!, creds, fetchImpl);
    expect(details.plot).toBe('Fire laerere …');
    expect(details.trailerId).toBe('dQw4w9WgXcQ');
    expect(details.durationMinutes).toBe(117);
    expect((await getVodDetails(db, druk!.key))?.details.plot).toBe('Fire laerere …');
  });

  it('spoerger ikke panelet igen naar det gemte er friskt', async () => {
    const fetchImpl = panel();
    await syncVod(db, sourceId, creds, fetchImpl);
    const [druk] = await listVodItems(db, { search: 'Druk' });
    await ensureVodDetails(db, druk!, creds, fetchImpl);
    const calls = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls.length;

    await ensureVodDetails(db, druk!, creds, fetchImpl);
    expect((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls.length).toBe(calls);
  });

  it('gemmer afsnittene for en serie', async () => {
    const fetchImpl = panel();
    await syncVod(db, sourceId, creds, fetchImpl);
    const [jane] = await listVodItems(db, { kind: 'series' });

    await ensureVodDetails(db, jane!, creds, fetchImpl);
    const episodes = await listEpisodes(db, jane!.key);
    expect(episodes.map((e) => e.title)).toEqual(['Pilot']);
  });

  // En uge gammel handling er stadig handlingen.
  it('giver det gemte naar panelet ikke svarer', async () => {
    const fetchImpl = panel();
    await syncVod(db, sourceId, creds, fetchImpl);
    const [druk] = await listVodItems(db, { search: 'Druk' });
    await ensureVodDetails(db, druk!, creds, fetchImpl);

    const dead: FetchLike = async () => { throw new Error('nede'); };
    const later = new Date(Date.now() + 30 * 24 * 3600_000);
    const details = await ensureVodDetails(db, druk!, creds, dead, later);
    expect(details.plot).toBe('Fire laerere …');
  });
});
