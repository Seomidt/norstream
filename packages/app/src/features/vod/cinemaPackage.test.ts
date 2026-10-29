import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../../storage/schema.js';
import { addSource, deleteSource } from '../../storage/sources.js';
import { createTestDatabase } from '../../storage/testDb.js';
import type { SqlDatabase } from '../../storage/types.js';
import { invalidateQueryCache } from '../../storage/queryCache.js';
import { replaceVodItems } from '../../storage/vod.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';
import { cinemaPackageMatches } from './cinemaPackage.js';

const title = (id: number, name: string, year: number | null): TmdbTitle => ({
  id, title: name, year, kind: 'movie', posterUrl: null, thumbUrl: null, overview: '', rating: null,
});
let db: SqlDatabase;
let sourceId: string;
const movie = (id: string, name: string, year: number | null = null) => ({
  id, name, year, kind: 'movie' as const, posterUrl: null, rating: null, categoryId: null, added: null, containerExtension: 'mkv',
});
beforeEach(async () => {
  invalidateQueryCache();
  db = createTestDatabase(); await migrate(db);
  sourceId = (await addSource(db, { kind: 'xtream', name: 'Pakken', url: 'https://example.invalid' })).id;
});

describe('biografens maerke i egen pakke', () => {
  it('matcher eksakt titel og aar, men afviser forkert aar, delvis titel og ukendt aar', async () => {
    await replaceVodItems(db, sourceId, 'movie', [
      movie('dune', 'DK - Dune (2021) 4K'), movie('dunes', 'Dunes of Sand', 2026), movie('unknown', 'Ukendt'),
    ]);
    const found = await cinemaPackageMatches(db, [title(1, 'Dune', 2021), title(2, 'Dune', 1984), title(3, 'Dunes', 2026), title(4, 'Ukendt', 2026)]);
    expect([...found]).toEqual([[1, `${sourceId}:movie-dune`]]);
  });

  it('samme TMDB-id finder en oversat titel og et kendt andet id maa ikke matche paa navn', async () => {
    await replaceVodItems(db, sourceId, 'movie', [movie('translated', 'En dansk titel'), movie('other', 'Dune', 2021)]);
    await db.runAsync('INSERT INTO vod_posters(item_key,url,tried_ms,tmdb_id) VALUES(?,?,?,?)', [`${sourceId}:movie-translated`, null, 1, 100]);
    await db.runAsync('INSERT INTO vod_posters(item_key,url,tried_ms,tmdb_id) VALUES(?,?,?,?)', [`${sourceId}:movie-other`, null, 1, 999]);
    expect([...await cinemaPackageMatches(db, [title(100, 'English title', 2026), title(200, 'Dune', 2021)])])
      .toEqual([[100, `${sourceId}:movie-translated`]]);
  });

  it('matcher alle plakater med ét cachet katalogopslag og genindlaeser efter synk og kildesletning', async () => {
    await replaceVodItems(db, sourceId, 'movie', [movie('one', 'En', 2026)]);
    const read = vi.spyOn(db, 'getAllAsync');
    const titles = [title(1, 'En', 2026), title(2, 'To', 2026)];
    expect((await cinemaPackageMatches(db, titles)).size).toBe(1);
    await cinemaPackageMatches(db, [...titles, title(3, 'Tre', 2026)]);
    expect(read).toHaveBeenCalledTimes(1);
    await replaceVodItems(db, sourceId, 'movie', [movie('two', 'To', 2026)]);
    expect([...await cinemaPackageMatches(db, titles)]).toEqual([[2, `${sourceId}:movie-two`]]);
    await deleteSource(db, sourceId);
    expect((await cinemaPackageMatches(db, titles)).size).toBe(0);
  });

  it('blander aldrig kataloger mellem databaser og giver ikke et seriematch et filmmaerke', async () => {
    await replaceVodItems(db, sourceId, 'movie', [movie('one', 'En', 2026)]);
    await replaceVodItems(db, sourceId, 'series', [{ ...movie('series', 'Kun serie', 2026), kind: 'series' }]);
    const titles = [title(1, 'En', 2026), title(2, 'Kun serie', 2026)];
    expect((await cinemaPackageMatches(db, titles)).size).toBe(1);
    const other = createTestDatabase(); await migrate(other);
    expect((await cinemaPackageMatches(other, titles)).size).toBe(0);
  });

  it('nye TMDB-id fra plakatopslag bliver tilgaengelige efter cachefristen uden katalogsynk', async () => {
    vi.useFakeTimers();
    try {
      await replaceVodItems(db, sourceId, 'movie', [movie('translated', 'Dansk titel')]);
      const titles = [title(42, 'Original title', 2026)];
      expect((await cinemaPackageMatches(db, titles)).size).toBe(0);
      await db.runAsync('INSERT INTO vod_posters(item_key,url,tried_ms,tmdb_id) VALUES(?,?,?,?)', [`${sourceId}:movie-translated`, null, 1, 42]);
      vi.advanceTimersByTime(5 * 60_000);
      expect([...await cinemaPackageMatches(db, titles)]).toEqual([[42, `${sourceId}:movie-translated`]]);
    } finally { vi.useRealTimers(); }
  });
});
