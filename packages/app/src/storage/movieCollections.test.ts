import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import { addSource, deleteSource } from './sources.js';
import { replaceVodItems } from './vod.js';
import { invalidateQueryCache, queryCacheRevision } from './queryCache.js';
import type { SqlDatabase } from './types.js';
import { COLLECTION_MAX_AGE_MS, collectionCandidates, listMovieCollectionItems, listMovieCollections, movieCollectionForItem, movieCollectionsRefreshDue, peekMovieCollectionItems, peekMovieCollections, saveCollectionLookup, saveMovieCollection, staleMovieCollectionIds } from './movieCollections.js';
import type { MovieCollectionDetails } from './movieCollections.js';

let db: SqlDatabase;
let source: string;
const movie = (id: string, name: string, year: number | null = null) => ({ id, name, year, kind: 'movie' as const, posterUrl: null, rating: null, categoryId: null, added: null, containerExtension: 'mkv' });
const collection: MovieCollectionDetails = { id: 7, name: 'Samlingen', posterUrl: 'https://image.tmdb.org/t/p/w342/collection.jpg', parts: [
  { id: 100, title: 'Dansk titel', originalTitle: 'First film', year: 2000, releaseDate: '2000-05-01', posterUrl: null },
  { id: 200, title: 'Anden film', originalTitle: 'Second film', year: 2010, releaseDate: '2010-06-02', posterUrl: null },
  { id: 300, title: 'Ikkepakken', originalTitle: null, year: 2020, releaseDate: '2020-01-01', posterUrl: null },
] };
beforeEach(async () => {
  invalidateQueryCache(); db = createTestDatabase(); await migrate(db);
  source = (await addSource(db, { kind: 'xtream', name: 'Pakke', url: 'https://example.invalid' })).id;
});
const key = (id: string) => `${source}:movie-${id}`;
async function tmdb(id: string, value: number) {
  await db.runAsync('INSERT INTO vod_posters(item_key,url,tried_ms,tmdb_id) VALUES(?,?,?,?)', [key(id), null, 1, value]);
}

describe('filmsamlinger i eget katalog', () => {
  it('en tom samlingscache laeser ikke hele filmkataloget paa filmens detaljeside', async () => {
    await replaceVodItems(db, source, 'movie', [movie('one', 'Film', 2000)]);
    const read = vi.spyOn(db, 'getAllAsync');
    expect(await listMovieCollections(db)).toEqual([]);
    expect(await movieCollectionForItem(db, key('one'))).toBeNull();
    expect(await listMovieCollectionItems(db, 7)).toEqual([]);
    expect(read.mock.calls.some(([sql]) => sql.includes('FROM vod_items'))).toBe(false);
  });

  it('viser kun egne film, samler HD-dubletter og bruger udgivelsesraekkefoelge', async () => {
    await replaceVodItems(db, source, 'movie', [movie('second', 'Second film (2010)'), movie('first', 'Oversat'), movie('first4k', 'Oversat UHD')]);
    await tmdb('first', 100); await tmdb('first4k', 100);
    await saveMovieCollection(db, collection, 1000);
    expect(await listMovieCollections(db)).toEqual([{ id: 7, name: 'Samlingen', posterUrl: collection.posterUrl, available: 2 }]);
    expect((await listMovieCollectionItems(db, 7)).map(item => item.key)).toEqual([key('first'), key('second')]);
    expect((await movieCollectionForItem(db, key('first4k')))?.id).toBe(7);
  });

  it('afviser forkert aar, delvis titel, ukendt aar og kendt andet TMDB-id', async () => {
    await replaceVodItems(db, source, 'movie', [movie('wrongyear', 'First film', 1999), movie('partial', 'First film extended', 2000), movie('unknown', 'First film'), movie('other', 'First film', 2000)]);
    await tmdb('other', 999);
    await saveMovieCollection(db, collection, 1000);
    expect(await listMovieCollections(db)).toEqual([]);
    expect(await listMovieCollectionItems(db, 7)).toEqual([]);
  });

  it('et tvetydigt titel- og aarsmatch maa ikke give to forskellige film for samme katalogtitel', async () => {
    await replaceVodItems(db, source, 'movie', [movie('first', 'First film', 2000)]);
    await saveMovieCollection(db, { ...collection, parts: [collection.parts[0]!, { ...collection.parts[0]!, id: 999 }] }, 1000);
    expect(await listMovieCollections(db)).toEqual([]);
  });

  it('genbruger kun lookups naar filmens katalogidentitet stadig passer', async () => {
    await replaceVodItems(db, source, 'movie', [movie('one', 'Oversat titel')]);
    const candidate = (await collectionCandidates(db, 1000, 2))[0]!;
    await saveMovieCollection(db, collection, 1000);
    await saveCollectionLookup(db, candidate, 100, 7, 1000);
    expect((await listMovieCollections(db))[0]?.available).toBe(1);
    await replaceVodItems(db, source, 'movie', [movie('one', 'Helt anden film')]);
    expect(await listMovieCollections(db)).toEqual([]);
    expect((await collectionCandidates(db, 1100, 2))[0]?.name).toBe('Helt anden film');
    await saveCollectionLookup(db, candidate, 100, 7, 1200);
    expect(await listMovieCollections(db)).toEqual([]);
  });

  it('kildesletning skjuler tomme samlinger og blander ikke separate databaser', async () => {
    await replaceVodItems(db, source, 'movie', [movie('first', 'First film', 2000)]);
    await saveMovieCollection(db, collection, 1000);
    expect((await listMovieCollections(db)).length).toBe(1);
    const other = createTestDatabase(); await migrate(other); await saveMovieCollection(other, collection, 1000);
    expect(await listMovieCollections(other)).toEqual([]);
    await deleteSource(db, source);
    expect(await listMovieCollections(db)).toEqual([]);
  });

  it('et fejlet metadata-skriv efterlader den tidligere samling hel', async () => {
    await replaceVodItems(db, source, 'movie', [movie('first', 'First film', 2000)]);
    await saveMovieCollection(db, collection, 1000);
    await expect(saveMovieCollection(db, { ...collection, name: 'Ny', parts: [collection.parts[0]!, collection.parts[0]!] }, 2000)).rejects.toThrow();
    expect((await listMovieCollections(db))[0]?.name).toBe('Samlingen');
    expect((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM movie_collection_members'))?.n).toBe(3);
  });

  it('genindgang bruger frisk lokal oversigt og film uden nyt katalogscan eller hydrering', async () => {
    await replaceVodItems(db, source, 'movie', [movie('first', 'First film', 2000)]);
    await saveMovieCollection(db, collection, 1000);
    expect(peekMovieCollections(db)).toBeNull();
    const all = await listMovieCollections(db);
    const items = await listMovieCollectionItems(db, 7);
    const read = vi.spyOn(db, 'getAllAsync');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 4 * 60_000);
    expect(await listMovieCollections(db)).toBe(all);
    expect(await listMovieCollectionItems(db, 7)).toBe(items);
    expect(peekMovieCollections(db)).toBe(all);
    expect(peekMovieCollectionItems(db, 7)).toBe(items);
    expect(read).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it('bevarer varm visning mens udloebne lokale metadata genlaeses med nye plakater', async () => {
    await replaceVodItems(db, source, 'movie', [movie('first', 'First film', 2000)]);
    await saveMovieCollection(db, collection, 1000);
    const old = await listMovieCollectionItems(db, 7);
    await db.runAsync('UPDATE vod_items SET poster_url=? WHERE key=?', ['https://example.invalid/new.jpg', key('first')]);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000);
    expect(peekMovieCollectionItems(db, 7)).toBe(old);
    const fresh = await listMovieCollectionItems(db, 7);
    expect(fresh[0]?.posterUrl).toBe('https://example.invalid/new.jpg');
    expect(peekMovieCollectionItems(db, 7)).toBe(fresh);
    clock.mockRestore();
  });

  it('hydrerer en endnu uaabnet samling fra kendte matches foer en langsom katalogopdatering er faerdig', async () => {
    await replaceVodItems(db, source, 'movie', [movie('first', 'First film', 2000)]);
    await saveMovieCollection(db, collection, 1000);
    await listMovieCollections(db);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000);
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const original = db.getAllAsync.bind(db);
    const read = vi.spyOn(db, 'getAllAsync').mockImplementation(async (sql, args) => {
      if (sql.includes('AS year,fp.tmdb_id AS tmdb_id')) await waiting;
      return original(sql, args);
    });
    expect((await listMovieCollectionItems(db, 7))[0]?.key).toBe(key('first'));
    release();
    await listMovieCollections(db);
    read.mockRestore(); clock.mockRestore();
  });

  it('egen metadata genbruger katalogets identitetsindeks uden at kassere andre skaermes cache', async () => {
    await replaceVodItems(db, source, 'movie', [movie('first', 'First film', 2000)]);
    await saveMovieCollection(db, collection, 1000);
    await listMovieCollections(db);
    const revision = queryCacheRevision();
    const read = vi.spyOn(db, 'getAllAsync');
    await saveMovieCollection(db, { ...collection, name: 'Nyt navn' }, 2000);
    expect(peekMovieCollections(db)).toBeNull();
    expect((await listMovieCollections(db))[0]?.name).toBe('Nyt navn');
    const candidate = (await collectionCandidates(db, 2000, 1))[0]!;
    await saveCollectionLookup(db, candidate, 999, null, 2000);
    expect(await listMovieCollections(db)).toEqual([]);
    await saveCollectionLookup(db, candidate, 100, 7, 2001);
    expect((await listMovieCollections(db))[0]?.available).toBe(1);
    expect(queryCacheRevision()).toBe(revision);
    expect(read.mock.calls.some(([sql]) => sql.includes('AS year,fp.tmdb_id AS tmdb_id'))).toBe(false);
  });

  it('katalogskift invaliderer varme snapshots med det samme, og databaser deler dem aldrig', async () => {
    await replaceVodItems(db, source, 'movie', [movie('first', 'First film', 2000)]);
    await saveMovieCollection(db, collection, 1000);
    await listMovieCollections(db); await listMovieCollectionItems(db, 7);
    const other = createTestDatabase();
    expect(peekMovieCollections(other)).toBeNull(); expect(peekMovieCollectionItems(other, 7)).toBeNull();
    await replaceVodItems(db, source, 'movie', []);
    expect(peekMovieCollections(db)).toBeNull(); expect(peekMovieCollectionItems(db, 7)).toBeNull();
    expect(await listMovieCollections(db)).toEqual([]);
    expect(await listMovieCollectionItems(db, 7)).toEqual([]);
  });

  it('kontrollerer ugentlig metadatafrist uden at laese filmkataloget', async () => {
    await saveMovieCollection(db, collection, 1000);
    const read = vi.spyOn(db, 'getAllAsync');
    expect(await movieCollectionsRefreshDue(db, 1000 + COLLECTION_MAX_AGE_MS - 1)).toBe(false);
    expect(await staleMovieCollectionIds(db, 1000 + COLLECTION_MAX_AGE_MS - 1)).toEqual([]);
    expect(await movieCollectionsRefreshDue(db, 1000 + COLLECTION_MAX_AGE_MS)).toBe(true);
    expect(await staleMovieCollectionIds(db, 1000 + COLLECTION_MAX_AGE_MS)).toEqual([7]);
    expect(read.mock.calls.some(([sql]) => sql.includes('vod_items'))).toBe(false);
  });

  it('bevarer hoejst tolv hydrerede samlingssider', async () => {
    await replaceVodItems(db, source, 'movie', [movie('first', 'First film', 2000)]);
    for (let id = 1; id <= 13; id += 1) await saveMovieCollection(db, { ...collection, id }, 1000);
    for (let id = 1; id <= 13; id += 1) await listMovieCollectionItems(db, id);
    expect(peekMovieCollectionItems(db, 1)).toBeNull();
    expect(peekMovieCollectionItems(db, 13)?.[0]?.key).toBe(key('first'));
  });
});
