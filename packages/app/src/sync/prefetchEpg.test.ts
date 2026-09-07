import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { replaceCategories, replaceChannels, setFavorite } from '../storage/channels.js';
import { migrate } from '../storage/schema.js';
import { addSource } from '../storage/sources.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { prefetchFavouritesEpg } from './prefetchEpg.js';

const creds = { baseUrl: 'http://p', username: 'u', password: 'p' };
let db: SqlDatabase;
let sourceId: string;

function panel(): FetchLike {
  return vi.fn(async (url: string) => {
    const action = new URL(url).searchParams.get('action');
    const streamId = new URL(url).searchParams.get('stream_id');
    if (action === 'get_simple_data_table') {
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({
          epg_listings: [{ id: '1', title: 'Rm9yc2lkZQ==', start: '2026-09-07 19:00:00', end: '2026-09-07 20:00:00', description: '', channel_id: streamId }],
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  }) as unknown as FetchLike;
}

function channel(id: string) {
  return { id, name: `K${id}`, number: 1, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: true, archiveDays: 7 };
}

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  sourceId = (await addSource(db, { kind: 'xtream', name: 'P', url: 'http://p' })).id;
  await replaceCategories(db, sourceId, [{ id: '1', name: 'DK' }]);
  await replaceChannels(db, sourceId, [channel('1'), channel('2'), channel('3')]);
  await setFavorite(db, `${sourceId}:1`, true);
  await setFavorite(db, `${sourceId}:2`, true);
});

describe('prefetchFavouritesEpg', () => {
  const credsBySource = () => new Map([[sourceId, creds]]);

  // Favoritterne er den maengde guiden viser — snesevis, ikke tusinder. Alle
  // 22.142 kanaler ville vaere 22.142 kald.
  it('henter tabellen for favoritterne, og kun dem', async () => {
    const fetchImpl = panel();
    const result = await prefetchFavouritesEpg(db, credsBySource(), fetchImpl);
    expect(result).toEqual({ fetched: 2, skipped: false });
    const calls = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0] ?? '');
    expect(calls.some((url) => url.includes('stream_id=3'))).toBe(false);
  });

  it('springer over resten af doegnet', async () => {
    const fetchImpl = panel();
    const now = new Date('2026-09-07T10:00:00Z');
    await prefetchFavouritesEpg(db, credsBySource(), fetchImpl, now);
    const again = await prefetchFavouritesEpg(db, credsBySource(), fetchImpl, new Date(now.getTime() + 3600_000));
    expect(again.skipped).toBe(true);
  });

  it('koerer igen naeste doegn', async () => {
    const fetchImpl = panel();
    const now = new Date('2026-09-07T10:00:00Z');
    await prefetchFavouritesEpg(db, credsBySource(), fetchImpl, now);
    const later = new Date(now.getTime() + 25 * 3600_000);
    expect((await prefetchFavouritesEpg(db, credsBySource(), fetchImpl, later)).skipped).toBe(false);
  });
});
