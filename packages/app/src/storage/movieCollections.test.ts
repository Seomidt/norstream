import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import { addSource, deleteSource } from './sources.js';
import { replaceVodItems } from './vod.js';
import { invalidateQueryCache } from './queryCache.js';
import type { SqlDatabase } from './types.js';
import { collectionCandidates, listMovieCollectionItems, listMovieCollections, movieCollectionForItem, saveCollectionLookup, saveMovieCollection } from './movieCollections.js';
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
});
