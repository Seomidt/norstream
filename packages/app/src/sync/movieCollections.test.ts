import { beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase } from '../storage/testDb.js';
import { migrate } from '../storage/schema.js';
import { addSource } from '../storage/sources.js';
import { replaceVodItems } from '../storage/vod.js';
import { invalidateQueryCache } from '../storage/queryCache.js';
import { listMovieCollections } from '../storage/movieCollections.js';
import type { SqlDatabase } from '../storage/types.js';
import type { TmdbFetch } from './tmdb.js';
import { discoverMovieCollections, movieCollectionId, parseMovieCollection } from './movieCollections.js';

let db: SqlDatabase;
let source: string;
const movie = (id: string, name: string) => ({ id, name, year: 2000, kind: 'movie' as const, posterUrl: null, rating: null, categoryId: null, added: null, containerExtension: 'mkv' });
const collection = { id: 7, name: 'En samling', poster_path: '/poster.jpg', parts: [{ id: 100, title: 'First', original_title: 'First', release_date: '2000-01-01', poster_path: '/first.jpg' }] };
const response = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) });
beforeEach(async () => {
  invalidateQueryCache(); db = createTestDatabase(); await migrate(db);
  source = (await addSource(db, { kind: 'xtream', name: 'Pakken', url: 'https://example.invalid' })).id;
  await replaceVodItems(db, source, 'movie', [movie('first', 'First (2000)')]);
  await db.runAsync('INSERT INTO vod_posters(item_key,url,tried_ms,tmdb_id) VALUES(?,?,?,?)', [`${source}:movie-first`, null, 1, 100]);
});
const options = { limit: 1, pauseMs: 0, now: () => 1000 };

it('finder en officiel samling fra et katalog-id og bruger cachen ved genindgang', async () => {
  const fetch: TmdbFetch = vi.fn(async url => response(url.includes('/collection/') ? collection : { id: 100, belongs_to_collection: { id: 7 } }));
  expect(await discoverMovieCollections(db, fetch, 'key', options)).toMatchObject({ looked: 1, changed: 1, failed: false });
  expect((await listMovieCollections(db))[0]).toMatchObject({ id: 7, name: 'En samling', available: 1 });
  await discoverMovieCollections(db, fetch, 'key', options);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('samme film i flere kvaliteter kraever ikke gentagne TMDB-netkald', async () => {
  await replaceVodItems(db, source, 'movie', [movie('first', 'First (2000)'), movie('second', 'First (2000) UHD')]);
  await db.runAsync('INSERT INTO vod_posters(item_key,url,tried_ms,tmdb_id) VALUES(?,?,?,?)', [`${source}:movie-second`, null, 1, 100]);
  const fetch: TmdbFetch = vi.fn(async url => response(url.includes('/collection/') ? collection : { id: 100, belongs_to_collection: { id: 7 } }));
  await discoverMovieCollections(db, fetch, 'key', options);
  await discoverMovieCollections(db, fetch, 'key', options);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect((await listMovieCollections(db))[0]?.available).toBe(1);
});

it('en film uden gemt TMDB-id findes via valideret titel og aar foer samlingen hentes', async () => {
  await db.runAsync('DELETE FROM vod_posters');
  const fetch: TmdbFetch = vi.fn(async url => response(url.includes('/search/movie')
    ? { results: [{ id: 100, title: 'First', original_title: 'First', release_date: '2000-01-01' }] }
    : url.includes('/collection/') ? collection : { id: 100, belongs_to_collection: { id: 7 } }));
  expect((await discoverMovieCollections(db, fetch, 'key', options)).changed).toBe(1);
  expect((await listMovieCollections(db))[0]?.available).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('kun et udtrykkeligt null er et cachebart nej, ikke manglende metadata eller fejl', async () => {
  expect(movieCollectionId({ id: 100, belongs_to_collection: null }, 100)).toBeNull();
  expect(() => movieCollectionId({ id: 100 }, 100)).toThrow();
  expect(() => movieCollectionId({ id: 101, belongs_to_collection: null }, 100)).toThrow();
  const failed: TmdbFetch = vi.fn(async () => response({}, 401));
  expect((await discoverMovieCollections(db, failed, 'bad-key', options)).failed).toBe(true);
  expect(await db.getFirstAsync('SELECT * FROM movie_collection_lookup')).toBeNull();
  const valid: TmdbFetch = vi.fn(async () => response({ id: 100, belongs_to_collection: null }));
  expect((await discoverMovieCollections(db, valid, 'key', options)).changed).toBe(1);
  await discoverMovieCollections(db, valid, 'key', options);
  expect(valid).toHaveBeenCalledTimes(1);
});

it('afgang under et netkald starter ikke naeste kald og gemmer intet gammelt svar', async () => {
  let cancelled = false;
  const fetch: TmdbFetch = vi.fn(async () => { cancelled = true; return response({ id: 100, belongs_to_collection: { id: 7 } }); });
  await discoverMovieCollections(db, fetch, 'key', { ...options, isCancelled: () => cancelled });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await db.getFirstAsync('SELECT * FROM movie_collection_lookup')).toBeNull();
  expect(await db.getFirstAsync('SELECT * FROM movie_collections')).toBeNull();
});

it('en oversigt der venter paa et enkelt filmkort beregner sit eget resterende katalog', async () => {
  await replaceVodItems(db, source, 'movie', [movie('first', 'First (2000)'), movie('second', 'Second (2000)')]);
  await db.runAsync('INSERT INTO vod_posters(item_key,url,tried_ms,tmdb_id) VALUES(?,?,?,?)', [`${source}:movie-second`, null, 1, 200]);
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const fetch: TmdbFetch = vi.fn(async url => {
    if (url.includes('/movie/100?')) { await gate; return response({ id: 100, belongs_to_collection: null }); }
    if (url.includes('/movie/200?')) return response({ id: 200, belongs_to_collection: { id: 7 } });
    return response({ ...collection, parts: [{ ...collection.parts[0], id: 200, title: 'Second', original_title: 'Second' }] });
  });
  const detail = discoverMovieCollections(db, fetch, 'key', { ...options, itemKey: `${source}:movie-first` });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const overview = discoverMovieCollections(db, fetch, 'key', options);
  release();
  const [first, all] = await Promise.all([detail, overview]);
  expect(first.remaining).toBe(false);
  expect(all.changed).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect((await listMovieCollections(db))[0]?.available).toBe(1);
});

it('to samtidige oversigter deler det samme batch uden gentagne netkald', async () => {
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const fetch: TmdbFetch = vi.fn(async url => {
    if (url.includes('/movie/100?')) { await gate; return response({ id: 100, belongs_to_collection: { id: 7 } }); }
    return response(collection);
  });
  const first = discoverMovieCollections(db, fetch, 'key', options);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const second = discoverMovieCollections(db, fetch, 'key', options);
  release();
  expect(await second).toEqual(await first);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('validerer samlingens identitet og samtlige dele foer et cache-skriv', () => {
  expect(parseMovieCollection(collection, 7)).toMatchObject({ id: 7, parts: [{ id: 100, year: 2000, originalTitle: 'First' }] });
  expect(() => parseMovieCollection(collection, 8)).toThrow();
  expect(() => parseMovieCollection({ ...collection, parts: [{ title: 'Ingen id' }] }, 7)).toThrow();
});
