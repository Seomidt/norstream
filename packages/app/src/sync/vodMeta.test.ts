import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VodItem } from '@norstream/core';
import { migrate } from '../storage/schema.js';
import { addSource } from '../storage/sources.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { replaceVodCategories, replaceVodItems } from '../storage/vod.js';
import type { TmdbFetch } from './tmdb.js';
import { enrichVodMeta, fillProviders, packProviders, unpackProviders } from './vodMeta.js';

let db: SqlDatabase;
let sourceId: string;

function item(id: string, name: string, addedMs: number): VodItem {
  return { id, kind: 'movie', name, posterUrl: 'http://p/x.jpg', categoryId: '1', rating: 7, year: null, added: new Date(addedMs), containerExtension: 'mkv' };
}

function tmdb(answers: Record<string, { genre_ids: number[]; release_date: string } | null>): TmdbFetch {
  return vi.fn(async (url: string) => {
    const query = decodeURIComponent(new URL(url).searchParams.get('query') ?? '');
    const hit = answers[query];
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: hit === null || hit === undefined ? [] : [{ id: 1, title: query, poster_path: '/p.jpg', vote_average: 7.5, vote_count: 10, ...hit }] }),
      text: async () => '',
    };
  }) as unknown as TmdbFetch;
}

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  sourceId = (await addSource(db, { kind: 'xtream', name: 'P', url: 'http://p' })).id;
  await replaceVodCategories(db, sourceId, 'movie', [{ id: '1', name: 'DNK| Film' }]);
  await replaceVodItems(db, sourceId, 'movie', [item('a', 'Natten', 300), item('b', 'Grin', 200), item('c', 'Ukendt', 100)]);
});

describe('enrichVodMeta (v367)', () => {
  it('slaar nyeste foerst op og gemmer genre og aar; et nej gemmes ogsaa', async () => {
    const fetchImpl = tmdb({ Natten: { genre_ids: [53, 18], release_date: '2026-03-01' }, Grin: { genre_ids: [], release_date: '2024-01-01' }, Ukendt: null });
    const result = await enrichVodMeta(db, fetchImpl, 'key', { pauseMs: 0, limit: 2 });
    expect(result).toEqual({ looked: 2, found: 2 });
    const rows = await db.getAllAsync<{ item_key: string; genres: string | null; year: number | null; tmdb_id: number | null }>('SELECT item_key, genres, year, tmdb_id FROM vod_posters ORDER BY item_key');
    expect(rows).toEqual([
      { item_key: `${sourceId}:movie-a`, genres: ',thriller,drama,', year: 2026, tmdb_id: 1 },
      // Fundet uden genre: tom streng, saa den ikke spoerges om igen.
      { item_key: `${sourceId}:movie-b`, genres: '', year: 2024, tmdb_id: 1 },
    ]);
    // Naeste koersel tager kun den der mangler.
    const again = await enrichVodMeta(db, fetchImpl, 'key', { pauseMs: 0 });
    expect(again).toEqual({ looked: 1, found: 0 });
    expect(await enrichVodMeta(db, fetchImpl, 'key', { pauseMs: 0 })).toEqual({ looked: 0, found: 0 });
  });

  it('en raekke fra foer v25 (plakat fundet, ingen genre) slaas op igen', async () => {
    await db.runAsync('INSERT INTO vod_posters (item_key, url, rating, tried_ms) VALUES (?, ?, 6, ?)', [`${sourceId}:movie-a`, 'http://t/p.jpg', Date.now()]);
    const fetchImpl = tmdb({ Natten: { genre_ids: [28], release_date: '2020-05-05' }, Grin: null, Ukendt: null });
    await enrichVodMeta(db, fetchImpl, 'key', { pauseMs: 0 });
    const row = await db.getFirstAsync<{ genres: string | null; year: number | null }>('SELECT genres, year FROM vod_posters WHERE item_key = ?', [`${sourceId}:movie-a`]);
    expect(row).toEqual({ genres: ',action,', year: 2020 });
  });

  it('anden runde: tjenester per titel i DK, ogsaa "ingen", kun for titler med tmdb_id (v369)', async () => {
    await db.runAsync("INSERT INTO vod_posters (item_key, url, rating, tried_ms, genres, year, tmdb_id, metadata_version) VALUES (?, NULL, NULL, 1, '', 2024, 500, 1)", [`${sourceId}:movie-a`]);
    await db.runAsync("INSERT INTO vod_posters (item_key, url, rating, tried_ms, genres, year, tmdb_id, metadata_version) VALUES (?, NULL, NULL, 1, '', 2024, 600, 1)", [`${sourceId}:movie-b`]);
    await db.runAsync("INSERT INTO vod_posters (item_key, url, rating, tried_ms, genres, year, tmdb_id, metadata_version) VALUES (?, NULL, NULL, 1, NULL, NULL, NULL, 1)", [`${sourceId}:movie-c`]);
    const fetchImpl = vi.fn(async (url: string) => {
      const dk = url.includes('/movie/500/') ? { flatrate: [{ provider_id: 8 }, { provider_id: 119 }], rent: [{ provider_id: 2 }] } : {};
      return { ok: true, status: 200, json: async () => ({ results: { DK: dk, US: { flatrate: [{ provider_id: 9 }] } } }), text: async () => '' };
    }) as unknown as TmdbFetch;
    expect(await fillProviders(db, fetchImpl, 'key', { pauseMs: 0 })).toBe(2);
    const rows = await db.getAllAsync<{ item_key: string; providers: string | null }>('SELECT item_key, providers FROM vod_posters ORDER BY item_key');
    expect(rows).toEqual([
      { item_key: `${sourceId}:movie-a`, providers: ',8,119,' },
      { item_key: `${sourceId}:movie-b`, providers: '' },
      { item_key: `${sourceId}:movie-c`, providers: null },
    ]);
    // Intet at goere anden gang.
    expect(await fillProviders(db, fetchImpl, 'key', { pauseMs: 0 })).toBe(0);
    expect(unpackProviders(packProviders([8, 119]))).toEqual([8, 119]);
    expect(unpackProviders('')).toEqual([]);
  });

  it('stopper naar TMDB afviser noeglen, og gemmer intet for resten', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' })) as unknown as TmdbFetch;
    expect(await enrichVodMeta(db, fetchImpl, 'daarlig', { pauseMs: 0 })).toEqual({ looked: 0, found: 0 });
    expect(await db.getAllAsync('SELECT * FROM vod_posters')).toHaveLength(0);
  });
});

describe('revalidering af gamle match', () => {
  it('retter tidligere forkert genre og nulstiller kun tjenester ved ny identitet', async () => {
    await db.runAsync("INSERT INTO vod_posters (item_key, tried_ms, tmdb_id, genres, providers) VALUES (?, 1, 99, ',komedie,', ',8,')", [`${sourceId}:movie-a`]);
    await enrichVodMeta(db, tmdb({ Natten: { genre_ids: [53], release_date: '2026-01-01' } }), 'key', { pauseMs: 0, limit: 1 });
    expect(await db.getFirstAsync('SELECT genres, tmdb_id, metadata_version, providers FROM vod_posters WHERE item_key = ?', [`${sourceId}:movie-a`])).toEqual({ genres: ',thriller,', tmdb_id: 1, metadata_version: 1, providers: '' });
  });
  it('bevarer gamle data ved netfejl, men bruger dem ikke som valideret metadata', async () => {
    await db.runAsync("INSERT INTO vod_posters (item_key, tried_ms, tmdb_id, genres, providers) VALUES (?, 1, 99, ',komedie,', ',8,')", [`${sourceId}:movie-a`]);
    const offline: TmdbFetch = async () => { throw new Error('offline'); };
    await enrichVodMeta(db, offline, 'key', { pauseMs: 0, limit: 1 });
    expect(await db.getFirstAsync('SELECT genres, tmdb_id, metadata_version, providers FROM vod_posters WHERE item_key = ?', [`${sourceId}:movie-a`])).toEqual({ genres: ',komedie,', tmdb_id: 99, metadata_version: 0, providers: ',8,' });
  });
});

it('revaliderer samme identitet uden at slette tjenestecachen', async () => {
  await db.runAsync("INSERT INTO vod_posters (item_key, tried_ms, tmdb_id, genres, providers) VALUES (?, 1, 1, ',komedie,', ',8,')", [`${sourceId}:movie-a`]);
  await enrichVodMeta(db, tmdb({ Natten: { genre_ids: [53], release_date: '2026-01-01' } }), 'key', { pauseMs: 0, limit: 1 });
  expect(await db.getFirstAsync('SELECT providers FROM vod_posters WHERE item_key = ?', [`${sourceId}:movie-a`])).toEqual({ providers: ',8,' });
});

it('udfylder manglende genre fra OMDb via valideret IMDb-id og bevarer TMDB-aar', async () => {
  await db.runAsync("INSERT INTO settings (key, value) VALUES ('omdb_api_key', 'test-key')");
  const primary = tmdb({ Natten: { genre_ids: [], release_date: '2026-01-01' } });
  const fetchImpl: TmdbFetch = async (url, headers) => {
    if (url.includes('/external_ids')) return { ok: true, status: 200, json: async () => ({ imdb_id: 'tt1234567' }), text: async () => '' };
    if (url.startsWith('https://www.omdbapi.com/')) return { ok: true, status: 200, json: async () => ({ Response: 'True', imdbID: 'tt1234567', Type: 'movie', Genre: 'Thriller', Year: '2026' }), text: async () => '' };
    return primary(url, headers);
  };
  await enrichVodMeta(db, fetchImpl, 'key', { pauseMs: 0, limit: 1 });
  expect(await db.getFirstAsync('SELECT genres, year, tmdb_id FROM vod_posters WHERE item_key = ?', [`${sourceId}:movie-a`])).toEqual({ genres: ',thriller,', year: 2026, tmdb_id: 1 });
});
